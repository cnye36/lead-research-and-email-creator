import "dotenv/config";
import { DEFAULT_LEAD_SCORING_CONTEXT } from "./leadScoringDefaults.js";
import type { Config, SearchProvider } from "./types.js";

function require(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

const LINKUP_DEPTHS = ["fast", "standard", "deep"] as const;

const EXA_TYPES = [
  "neural",
  "fast",
  "auto",
  "deep-lite",
  "deep",
  "deep-reasoning",
  "instant",
] as const;

function isSearchProvider(value: string): value is SearchProvider {
  return value === "tavily" || value === "linkup" || value === "exa";
}

function parseSearchProvider(raw: string): SearchProvider {
  const v = raw.trim().toLowerCase();
  if (!isSearchProvider(v)) {
    throw new Error(
      `Invalid SEARCH_PROVIDER "${raw}". Use one of: tavily, linkup, exa`
    );
  }
  return v;
}

function parseLinkupDepth(raw: string): Config["linkupSearchDepth"] {
  const v = raw.trim().toLowerCase() as Config["linkupSearchDepth"];
  if (!LINKUP_DEPTHS.includes(v as (typeof LINKUP_DEPTHS)[number])) {
    throw new Error(
      `Invalid LINKUP_SEARCH_DEPTH "${raw}". Use one of: ${LINKUP_DEPTHS.join(", ")}`
    );
  }
  return v;
}

function parseExaSearchType(raw: string): Config["exaSearchType"] {
  const v = raw.trim().toLowerCase() as Config["exaSearchType"];
  if (!EXA_TYPES.includes(v as (typeof EXA_TYPES)[number])) {
    throw new Error(
      `Invalid EXA_SEARCH_TYPE "${raw}". Use one of: ${EXA_TYPES.join(", ")}`
    );
  }
  return v;
}

export interface LoadConfigOptions {
  /** CLI `--search-provider` overrides `SEARCH_PROVIDER`. */
  searchProvider?: string;
}

export function loadConfig(options?: LoadConfigOptions): Config {
  const fromEnv = optional("SEARCH_PROVIDER", "tavily");
  const searchProvider = parseSearchProvider(
    options?.searchProvider?.trim() || fromEnv
  );

  let tavilyApiKey: string | undefined;
  let linkupApiKey: string | undefined;
  let exaApiKey: string | undefined;

  if (searchProvider === "tavily") {
    tavilyApiKey = require("TAVILY_API_KEY");
  } else if (searchProvider === "linkup") {
    linkupApiKey = require("LINKUP_API_KEY");
  } else {
    exaApiKey = require("EXA_API_KEY");
  }

  return {
    openaiApiKey: require("OPENAI_API_KEY"),
    openaiModel: optional("OPENAI_MODEL", "gpt-5.4-mini"),
    searchProvider,
    tavilyApiKey,
    linkupApiKey,
    exaApiKey,
    linkupSearchDepth: parseLinkupDepth(optional("LINKUP_SEARCH_DEPTH", "standard")),
    exaSearchType: parseExaSearchType(optional("EXA_SEARCH_TYPE", "fast")),
    senderName: optional("SENDER_NAME", ""),
    senderCompany: optional("SENDER_COMPANY", ""),
    senderRole: optional("SENDER_ROLE", ""),
    productContext: optional("PRODUCT_CONTEXT", ""),
    leadScoringContext: optional("LEAD_SCORING_CONTEXT", DEFAULT_LEAD_SCORING_CONTEXT),
    concurrency: parseInt(optional("CONCURRENCY", "5"), 10),
    batchDelayMs: parseInt(optional("BATCH_DELAY_MS", "1000"), 10),
    maxRetries: parseInt(optional("MAX_RETRIES", "3"), 10),
  };
}

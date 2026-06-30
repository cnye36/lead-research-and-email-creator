import { tavily } from "@tavily/core";
import type { Config } from "./types.js";

const CONTEXT_MAX = 3000;

function capContext(text: string): string {
  return text.slice(0, CONTEXT_MAX);
}

async function searchTavily(
  apiKey: string,
  query: string,
  maxResults: number
): Promise<string> {
  const client = tavily({ apiKey });
  const result = await client.search(query, { maxResults });
  return result.results.map((r) => `[${r.title}] ${r.content}`).join("\n\n");
}

type LinkupDepth = "fast" | "standard" | "deep";

type LinkupTextResult = {
  type: "text";
  name: string;
  url: string;
  content: string;
};

type LinkupSearchResultsBody = {
  results?: Array<LinkupTextResult | { type: string }>;
};

async function searchLinkup(
  apiKey: string,
  query: string,
  depth: LinkupDepth,
  maxResults: number
): Promise<string> {
  const res = await fetch("https://api.linkup.so/v1/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      depth,
      outputType: "searchResults",
      maxResults,
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Linkup search failed (${res.status}): ${rawText.slice(0, 500)}`);
  }
  const data = JSON.parse(rawText) as LinkupSearchResultsBody;
  const parts: string[] = [];
  for (const item of data.results ?? []) {
    if (item.type === "text" && "name" in item && "content" in item) {
      const row = item as LinkupTextResult;
      parts.push(`[${row.name}] ${row.content}`);
    }
  }
  return parts.join("\n\n");
}

type ExaSearchType =
  | "neural"
  | "fast"
  | "auto"
  | "deep-lite"
  | "deep"
  | "deep-reasoning"
  | "instant";

type ExaResult = {
  title?: string;
  url?: string;
  highlights?: string[];
  text?: string;
  summary?: string;
};

type ExaSearchBody = {
  results?: ExaResult[];
};

async function searchExa(
  apiKey: string,
  query: string,
  searchType: ExaSearchType,
  numResults: number
): Promise<string> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      type: searchType,
      numResults,
      contents: { highlights: true },
    }),
  });
  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Exa search failed (${res.status}): ${rawText.slice(0, 500)}`);
  }
  const data = JSON.parse(rawText) as ExaSearchBody;
  const parts: string[] = [];
  for (const r of data.results ?? []) {
    const title = r.title ?? "untitled";
    const excerpt =
      r.highlights?.join("\n") ?? r.summary ?? r.text ?? "";
    if (excerpt) {
      parts.push(`[${title}] ${excerpt}`);
    } else if (r.url) {
      parts.push(`[${title}] ${r.url}`);
    }
  }
  return parts.join("\n\n");
}

export async function runWebSearch(
  query: string,
  config: Config,
  maxResults = 3
): Promise<string> {
  let text: string;
  switch (config.searchProvider) {
    case "tavily": {
      const key = config.tavilyApiKey;
      if (!key) throw new Error("Tavily API key missing (set TAVILY_API_KEY)");
      text = await searchTavily(key, query, maxResults);
      break;
    }
    case "linkup": {
      const key = config.linkupApiKey;
      if (!key) throw new Error("Linkup API key missing (set LINKUP_API_KEY)");
      text = await searchLinkup(key, query, config.linkupSearchDepth, maxResults);
      break;
    }
    case "exa": {
      const key = config.exaApiKey;
      if (!key) throw new Error("Exa API key missing (set EXA_API_KEY)");
      text = await searchExa(key, query, config.exaSearchType, maxResults);
      break;
    }
    default: {
      const _exhaustive: never = config.searchProvider;
      throw new Error(`Unknown search provider: ${_exhaustive}`);
    }
  }
  return capContext(text);
}

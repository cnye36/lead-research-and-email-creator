import OpenAI from "openai";
import type { Lead, SearchResults, LLMOutput, Config } from "./types.js";
import { normalizeLeadScore } from "./leadScorer.js";
import {
  buildRegenerateEmailsUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "./prompts.js";
import { runWebSearch } from "./webSearch.js";

// Replace smart quotes and other fancy Unicode punctuation with plain ASCII equivalents
// so the output CSV is safe regardless of how the downstream tool reads encoding.
function sanitize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'") // curly single quotes
    .replace(/[“”„‟]/g, '"') // curly double quotes
    .replace(/–/g, "-")                      // en dash
    .replace(/—/g, "--")                     // em dash
    .replace(/…/g, "...");                   // ellipsis
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  label: string
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isRateLimit =
        msg.includes("429") ||
        msg.toLowerCase().includes("rate limit") ||
        msg.toLowerCase().includes("excessive requests") ||
        msg.toLowerCase().includes("too many requests");
      const delay = isRateLimit
        ? Math.pow(2, attempt + 1) * 2000 + Math.random() * 1000
        : Math.pow(2, attempt) * 1000 + Math.random() * 500;

      if (attempt < maxRetries - 1) {
        console.warn(
          `  Retry ${attempt + 1}/${maxRetries - 1} for ${label} after ${Math.round(delay)}ms`
        );
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

export async function researchAndGenerateEmail(
  lead: Lead,
  config: Config,
  useSearch: boolean
): Promise<LLMOutput> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  let searchResults: SearchResults | null = null;

  if (useSearch) {
    const name = `${lead.firstName} ${lead.lastName}`.trim();
    const companyQuery = `${lead.company} company ${lead.industry ?? ""} recent news funding product`.trim();
    const contactQuery = `${name} ${lead.company} ${lead.title}`.trim();
    const p = config.searchProvider;

    const companySearch = await withRetry(
      () => runWebSearch(companyQuery, config),
      config.maxRetries,
      `${p}:company:${lead.company}`
    );
    const contactSearch = await withRetry(
      () => runWebSearch(contactQuery, config),
      config.maxRetries,
      `${p}:contact:${name}`
    );

    searchResults = { companySearch, contactSearch };
  }

  const systemPrompt = buildSystemPrompt({
    name: config.senderName,
    company: config.senderCompany,
    role: config.senderRole,
    productContext: config.productContext,
    leadScoringContext: config.leadScoringContext,
  });
  const userPrompt = buildUserPrompt(lead, searchResults);

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    config.maxRetries,
    `OpenAI:${lead.email}`
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<LLMOutput>;

  function draft(key: "email_1" | "email_2" | "email_3") {
    const d = parsed[key];
    return {
      subject: sanitize(d?.subject ?? ""),
      body: sanitize(d?.body ?? ""),
    };
  }

  return {
    research_summary: sanitize(parsed.research_summary ?? ""),
    mobile_phone: sanitize(parsed.mobile_phone ?? ""),
    lead_score: normalizeLeadScore(parsed.lead_score),
    email_1: draft("email_1"),
    email_2: draft("email_2"),
    email_3: draft("email_3"),
  };
}

/** LLM only: write the 3-email sequence from existing research text (no web search). */
export async function generateEmailsFromResearch(
  lead: Lead,
  config: Config,
  researchSummary: string
): Promise<Pick<LLMOutput, "email_1" | "email_2" | "email_3">> {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const systemPrompt = buildSystemPrompt(
    {
      name: config.senderName,
      company: config.senderCompany,
      role: config.senderRole,
      productContext: config.productContext,
      leadScoringContext: config.leadScoringContext,
    },
    { regenerateEmailsOnly: true }
  );
  const userPrompt = buildRegenerateEmailsUserPrompt(lead, researchSummary);

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      }),
    config.maxRetries,
    `OpenAI:regen:${lead.email || lead.company}`
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Partial<LLMOutput>;

  function draftEmail(key: "email_1" | "email_2" | "email_3") {
    const d = parsed[key];
    return {
      subject: sanitize(d?.subject ?? ""),
      body: sanitize(d?.body ?? ""),
    };
  }

  return {
    email_1: draftEmail("email_1"),
    email_2: draftEmail("email_2"),
    email_3: draftEmail("email_3"),
  };
}

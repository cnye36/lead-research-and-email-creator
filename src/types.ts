/** Web search backend when `--search` is enabled (see `SEARCH_PROVIDER` or `--search-provider`). */
export type SearchProvider = "tavily" | "linkup" | "exa";

export interface Lead {
  // Normalized fields used for LLM processing
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  company: string;
  companyDomain?: string;
  industry?: string;
  companySize?: string;
  city?: string;
  state?: string;
  country?: string;
  linkedinUrl?: string;
  phone?: string;
  technologies?: string;
  keywords?: string;
  annualRevenue?: string;

  // Original row data — preserves exact column names and values from the source file
  _raw: Record<string, string>;
  // 1-based row number in the source file (including header row), used for XLSX writes
  _rowIndex: number;
}

export interface SearchResults {
  companySearch: string;
  contactSearch: string;
}

export interface EmailDraft {
  subject: string;
  body: string;
}

export type LeadScoreTier = "hot" | "warm" | "neutral" | "cold" | "disqualified";

export interface LeadScore {
  /** 0–100 fit score for outbound prioritization. */
  score: number;
  tier: LeadScoreTier;
  /** 2–4 sentences: why this score, tied to ICP and research. */
  rationale: string;
}

export interface LLMOutput {
  research_summary: string;
  mobile_phone: string;
  /** Omitted when only regenerating emails; preserved from checkpoint when merging. */
  lead_score?: LeadScore;
  email_1: EmailDraft;
  email_2: EmailDraft;
  email_3: EmailDraft;
}

export interface ProcessedLead extends Lead {
  research_summary: string;
  mobile_phone: string;
  lead_score: string;
  lead_score_tier: string;
  lead_score_rationale: string;
  email_1_subject: string;
  email_1_body: string;
  email_2_subject: string;
  email_2_body: string;
  email_3_subject: string;
  email_3_body: string;
  status: "success" | "error";
  error?: string;
}

export interface Config {
  openaiApiKey: string;
  openaiModel: string;
  searchProvider: SearchProvider;
  /** Set when `searchProvider` is `tavily`. */
  tavilyApiKey?: string;
  /** Set when `searchProvider` is `linkup`. */
  linkupApiKey?: string;
  /** Set when `searchProvider` is `exa`. */
  exaApiKey?: string;
  /** Linkup `/v1/search` depth (`LINKUP_SEARCH_DEPTH`). */
  linkupSearchDepth: "fast" | "standard" | "deep";
  /** Exa `/search` type (`EXA_SEARCH_TYPE`). */
  exaSearchType:
    | "neural"
    | "fast"
    | "auto"
    | "deep-lite"
    | "deep"
    | "deep-reasoning"
    | "instant";
  senderName: string;
  senderCompany: string;
  senderRole: string;
  productContext: string;
  /** Who you want to reach and how to judge fit; used for lead scoring. */
  leadScoringContext: string;
  concurrency: number;
  batchDelayMs: number;
  maxRetries: number;
}

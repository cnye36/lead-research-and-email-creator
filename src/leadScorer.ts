import OpenAI from "openai";
import type { Config, Lead, LeadScore, LeadScoreTier, SearchResults } from "./types.js";
import { buildUserPrompt } from "./prompts.js";

const TIERS: LeadScoreTier[] = ["hot", "warm", "neutral", "cold", "disqualified"];

function tierForScore(score: number): LeadScoreTier {
  if (score >= 80) return "hot";
  if (score >= 60) return "warm";
  if (score >= 40) return "neutral";
  if (score >= 20) return "cold";
  return "disqualified";
}

export function normalizeLeadScore(raw: Partial<LeadScore> | undefined): LeadScore {
  const scoreRaw = raw?.score;
  const score =
    typeof scoreRaw === "number" && Number.isFinite(scoreRaw)
      ? Math.min(100, Math.max(0, Math.round(scoreRaw)))
      : 0;
  const tierRaw = String(raw?.tier ?? "").toLowerCase();
  const tier = TIERS.includes(tierRaw as LeadScoreTier)
    ? (tierRaw as LeadScoreTier)
    : tierForScore(score);
  const rationale = String(raw?.rationale ?? "").trim();
  return { score, tier, rationale };
}

function buildScoreSystemPrompt(config: Config): string {
  return `You are a B2B lead qualification analyst. Score how well a prospect fits the sender's ideal customer profile and outbound goals.

Sender:
- Name: ${config.senderName}
- Company: ${config.senderCompany}
- Role: ${config.senderRole}
- What they offer: ${config.productContext}

Lead scoring criteria:
${config.leadScoringContext}

Respond with valid JSON only:
{
  "lead_score": {
    "score": 0,
    "tier": "hot|warm|neutral|cold|disqualified",
    "rationale": "2-4 sentences tied to ICP and evidence"
  }
}

Rules:
- "score" is integer 0–100; tier must match: hot 80–100, warm 60–79, neutral 40–59, cold 20–39, disqualified 0–19.
- Use lead fields and any research provided. Do not invent facts.
- Score fit for selling AI agents/automation/consulting to SMBs and solopreneurs, not generic "could use software someday."`;
}

/** Score a lead from research text (and optional search snippets) without generating emails. */
export async function scoreLead(
  lead: Lead,
  config: Config,
  researchSummary: string,
  search: SearchResults | null,
  openai: OpenAI,
  maxRetries: number,
  withRetry: <T>(fn: () => Promise<T>, maxRetries: number, label: string) => Promise<T>
): Promise<LeadScore> {
  const leadBlock = buildUserPrompt(lead, search).replace(
    /^Research and write a personalized email for this lead\.?\n*/i,
    "Score this lead.\n"
  );

  const userPrompt = `${leadBlock}

COMPLETED RESEARCH SUMMARY:
${researchSummary}`;

  const response = await withRetry(
    () =>
      openai.chat.completions.create({
        model: config.openaiModel,
        messages: [
          { role: "system", content: buildScoreSystemPrompt(config) },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    maxRetries,
    `OpenAI:score:${lead.email || lead.company}`
  );

  const raw = response.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as { lead_score?: Partial<LeadScore> };
  return normalizeLeadScore(parsed.lead_score);
}

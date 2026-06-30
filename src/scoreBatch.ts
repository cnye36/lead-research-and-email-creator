import OpenAI from "openai";
import pLimit from "p-limit";
import type { Config, Lead, LLMOutput } from "./types.js";
import { scoreLead } from "./leadScorer.js";
import type { OutputWriter } from "./outputWriter.js";

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

export interface ScoreItem {
  lead: Lead;
  researchSummary: string;
}

interface ScoreBatchOptions {
  batchSize: number;
}

function readStoredEmails(lead: Lead): Pick<
  LLMOutput,
  "email_1" | "email_2" | "email_3"
> & { research_summary: string; mobile_phone: string } {
  function raw(col: string): string {
    const direct = lead._raw[col];
    if (direct != null && String(direct).trim() !== "") return String(direct).trim();
    const low = col.toLowerCase();
    for (const [k, v] of Object.entries(lead._raw)) {
      if (k.toLowerCase() === low && v != null && String(v).trim() !== "") {
        return String(v).trim();
      }
    }
    return "";
  }

  return {
    research_summary: raw("research_summary"),
    mobile_phone: raw("mobile_phone"),
    email_1: { subject: raw("email_1_subject"), body: raw("email_1_body") },
    email_2: { subject: raw("email_2_subject"), body: raw("email_2_body") },
    email_3: { subject: raw("email_3_subject"), body: raw("email_3_body") },
  };
}

export async function processScoreBatches(
  items: ScoreItem[],
  config: Config,
  writer: OutputWriter,
  options: ScoreBatchOptions
): Promise<void> {
  const { batchSize } = options;
  const limit = pLimit(config.concurrency);
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  const total = items.length;
  let completed = 0;
  let failed = 0;

  console.log(
    `Scoring ${total} leads | concurrency=${config.concurrency} | LLM only (no web search)`
  );

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} leads)`);

    await Promise.all(
      batch.map(({ lead, researchSummary }) =>
        limit(async () => {
          const label = `${lead.firstName} ${lead.lastName} <${lead.email}>`;
          try {
            process.stdout.write(`  Scoring ${label}... `);
            const leadScore = await scoreLead(
              lead,
              config,
              researchSummary,
              null,
              openai,
              config.maxRetries,
              withRetry
            );
            const stored = readStoredEmails(lead);
            const output: LLMOutput = {
              research_summary: stored.research_summary || researchSummary,
              mobile_phone: stored.mobile_phone,
              lead_score: leadScore,
              email_1: stored.email_1,
              email_2: stored.email_2,
              email_3: stored.email_3,
            };
            writer.addResult(lead, output);
            completed++;
            console.log(`done (${leadScore.score} ${leadScore.tier})`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            writer.addResult(lead, null, message);
            failed++;
            console.log(`FAILED: ${message}`);
          }
        })
      )
    );

    console.log(
      `Batch ${batchNum} complete — total saved: ${writer.getStats().processed} (${failed} errors)`
    );

    if (i + batchSize < items.length && config.batchDelayMs > 0) {
      console.log(`Waiting ${config.batchDelayMs}ms before next batch...`);
      await sleep(config.batchDelayMs);
    }
  }

  console.log(`\nDone. ${completed} succeeded, ${failed} failed out of ${total} leads.`);
}

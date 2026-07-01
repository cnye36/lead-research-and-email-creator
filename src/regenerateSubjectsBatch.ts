import pLimit from "p-limit";
import type { Lead, Config, LLMOutput, LeadScoreTier } from "./types.js";
import { generateSubjectsFromEmails } from "./researcher.js";
import { normalizeLeadScore } from "./leadScorer.js";
import type { OutputWriter } from "./outputWriter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RegenerateSubjectsItem {
  lead: Lead;
  researchSummary: string;
  mobilePhone: string;
  leadScore: { score: string; tier: string; rationale: string };
  emails: Pick<LLMOutput, "email_1" | "email_2" | "email_3">;
}

interface RegenerateSubjectsBatchOptions {
  batchSize: number;
  /** Called after each batch finishes (checkpoint already updated). Use to flush the workbook. */
  onBatchComplete?: () => void | Promise<void>;
}

export async function processRegenerateSubjectsBatches(
  items: RegenerateSubjectsItem[],
  config: Config,
  writer: OutputWriter,
  options: RegenerateSubjectsBatchOptions
): Promise<void> {
  const { batchSize } = options;
  const limit = pLimit(config.concurrency);

  const total = items.length;
  let completed = 0;
  let failed = 0;

  console.log(
    `Regenerating subject lines for ${total} leads | concurrency=${config.concurrency} | LLM only (bodies unchanged)`
  );

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} leads)`);

    await Promise.all(
      batch.map(({ lead, researchSummary, mobilePhone, leadScore, emails }) =>
        limit(async () => {
          const label = `${lead.firstName} ${lead.lastName} <${lead.email}>`;
          try {
            process.stdout.write(`  Regenerating subjects for ${label}... `);
            const subjects = await generateSubjectsFromEmails(
              lead,
              config,
              researchSummary,
              emails
            );
            const output: LLMOutput = {
              research_summary: researchSummary,
              mobile_phone: mobilePhone,
              lead_score: normalizeLeadScore({
                score: Number(leadScore.score),
                tier: leadScore.tier as LeadScoreTier,
                rationale: leadScore.rationale,
              }),
              email_1: { subject: subjects.email_1_subject, body: emails.email_1.body },
              email_2: { subject: subjects.email_2_subject, body: emails.email_2.body },
              email_3: { subject: subjects.email_3_subject, body: emails.email_3.body },
            };
            writer.addResult(lead, output);
            completed++;
            console.log("done");
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

    if (options.onBatchComplete) {
      await options.onBatchComplete();
    }

    if (i + batchSize < items.length && config.batchDelayMs > 0) {
      console.log(`Waiting ${config.batchDelayMs}ms before next batch...`);
      await sleep(config.batchDelayMs);
    }
  }

  console.log(`\nDone. ${completed} succeeded, ${failed} failed out of ${total} leads.`);
}

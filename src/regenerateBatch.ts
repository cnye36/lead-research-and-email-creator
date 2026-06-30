import pLimit from "p-limit";
import type { Lead, Config, LLMOutput } from "./types.js";
import { generateEmailsFromResearch } from "./researcher.js";
import type { OutputWriter } from "./outputWriter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface RegenerateItem {
  lead: Lead;
  researchSummary: string;
  mobilePhone: string;
}

interface RegenerateBatchOptions {
  batchSize: number;
  /** Called after each batch finishes (checkpoint already updated). Use to flush the workbook. */
  onBatchComplete?: () => void | Promise<void>;
}

export async function processRegenerateBatches(
  items: RegenerateItem[],
  config: Config,
  writer: OutputWriter,
  options: RegenerateBatchOptions
): Promise<void> {
  const { batchSize } = options;
  const limit = pLimit(config.concurrency);

  const total = items.length;
  let completed = 0;
  let failed = 0;

  console.log(
    `Regenerating emails for ${total} leads | concurrency=${config.concurrency} | LLM only (no web search)`
  );

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(items.length / batchSize);

    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} leads)`);

    await Promise.all(
      batch.map(({ lead, researchSummary, mobilePhone }) =>
        limit(async () => {
          const label = `${lead.firstName} ${lead.lastName} <${lead.email}>`;
          try {
            process.stdout.write(`  Regenerating ${label}... `);
            const emails = await generateEmailsFromResearch(lead, config, researchSummary);
            const output: LLMOutput = {
              research_summary: researchSummary,
              mobile_phone: mobilePhone,
              email_1: emails.email_1,
              email_2: emails.email_2,
              email_3: emails.email_3,
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

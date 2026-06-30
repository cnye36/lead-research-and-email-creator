import pLimit from "p-limit";
import type { Lead, Config } from "./types.js";
import { researchAndGenerateEmail } from "./researcher.js";
import type { OutputWriter } from "./outputWriter.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BatchOptions {
  useSearch: boolean;
  batchSize: number;
}

export async function processBatches(
  leads: Lead[],
  config: Config,
  writer: OutputWriter,
  options: BatchOptions
): Promise<void> {
  const { useSearch, batchSize } = options;
  const limit = pLimit(config.concurrency);

  const total = leads.length;
  let completed = 0;
  let failed = 0;

  console.log(
    `Processing ${total} leads | concurrency=${config.concurrency} | search=${useSearch}`
  );

  for (let i = 0; i < leads.length; i += batchSize) {
    const batch = leads.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(leads.length / batchSize);

    console.log(`\nBatch ${batchNum}/${totalBatches} (${batch.length} leads)`);

    await Promise.all(
      batch.map((lead) =>
        limit(async () => {
          const label = `${lead.firstName} ${lead.lastName} <${lead.email}>`;
          try {
            process.stdout.write(`  Processing ${label}... `);
            const output = await researchAndGenerateEmail(lead, config, useSearch);
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

    if (i + batchSize < leads.length && config.batchDelayMs > 0) {
      console.log(`Waiting ${config.batchDelayMs}ms before next batch...`);
      await sleep(config.batchDelayMs);
    }
  }

  console.log(`\nDone. ${completed} succeeded, ${failed} failed out of ${total} leads.`);
}

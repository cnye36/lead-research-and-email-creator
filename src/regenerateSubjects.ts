import path from "path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { parseFile } from "./leadParser.js";
import { OutputWriter } from "./outputWriter.js";
import { processRegenerateSubjectsBatches } from "./regenerateSubjectsBatch.js";
import type { Lead } from "./types.js";

function readRawColumn(lead: Lead, canonical: string): string {
  const direct = lead._raw[canonical];
  if (direct != null && String(direct).trim() !== "") return String(direct).trim();
  const low = canonical.toLowerCase();
  for (const [k, v] of Object.entries(lead._raw)) {
    if (k.toLowerCase() === low && v != null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return "";
}

const program = new Command();

program
  .name("regenerate-subjects")
  .description(
    "Re-run only subject line generation for an existing researched + written export. Email bodies, research, and lead score are left untouched."
  )
  .version("1.0.0")
  .requiredOption(
    "-i, --input <file>",
    "Input CSV or XLSX (already has email_1..3 subject/body columns)"
  )
  .option("-o, --output <file>", "Output file (defaults to input — overwrites subject columns in place)")
  .option(
    "-c, --checkpoint <file>",
    "Checkpoint for resume (separate from other scripts so rows are not skipped)",
    "checkpoint-regenerate-subjects.json"
  )
  .option(
    "--reprocess",
    "Clear checkpoint entries for leads in this file, then regenerate all of them"
  )
  .option("-b, --batch-size <n>", "Leads completed per batch before a pause", "10")
  .option(
    "--concurrency <n>",
    "Max parallel OpenAI calls (default: lower of CONCURRENCY env and 4, for gentler full-list runs)"
  )
  .option(
    "--batch-delay-ms <n>",
    "Pause in ms after each batch (default: higher of BATCH_DELAY_MS env and 1500)"
  )
  .parse(process.argv);

const opts = program.opts<{
  input: string;
  output?: string;
  checkpoint: string;
  reprocess: boolean;
  batchSize: string;
  concurrency?: string;
  batchDelayMs?: string;
}>();

async function main() {
  const config = loadConfig();

  const inputPath = path.resolve(opts.input);
  const outputPath = path.resolve(opts.output ?? opts.input);
  const checkpointPath = path.resolve(opts.checkpoint);
  const batchSize = parseInt(opts.batchSize, 10);

  const defaultConcurrency = Math.min(Math.max(1, config.concurrency), 4);
  const defaultBatchDelayMs = Math.max(0, config.batchDelayMs, 1500);

  let concurrency = defaultConcurrency;
  if (opts.concurrency !== undefined && String(opts.concurrency).trim() !== "") {
    const n = parseInt(opts.concurrency, 10);
    concurrency = Number.isFinite(n) ? Math.max(1, n) : defaultConcurrency;
  }

  let batchDelayMs = defaultBatchDelayMs;
  if (opts.batchDelayMs !== undefined && String(opts.batchDelayMs).trim() !== "") {
    const n = parseInt(opts.batchDelayMs, 10);
    batchDelayMs = Number.isFinite(n) ? Math.max(0, n) : defaultBatchDelayMs;
  }

  const regenConfig = { ...config, concurrency, batchDelayMs };

  console.log(`\nRegenerate subject lines only`);
  console.log(`Input:      ${inputPath}`);
  console.log(`Output:     ${outputPath}${outputPath === inputPath ? " (in-place)" : ""}`);
  console.log(`Checkpoint: ${checkpointPath}`);
  console.log(`Model:      ${config.openaiModel}`);
  console.log(`Batch size: ${batchSize} (leads per batch before pause)`);
  console.log(
    `Rate limits: concurrency=${regenConfig.concurrency}, pause between batches=${regenConfig.batchDelayMs}ms`
  );
  console.log();

  console.log("Parsing input file...");
  const allLeads = await parseFile(inputPath);
  console.log(`Found ${allLeads.length} leads`);

  const withEmails = allLeads
    .map((lead) => {
      const researchSummary = readRawColumn(lead, "research_summary");
      const mobilePhone = readRawColumn(lead, "mobile_phone");
      const leadScore = {
        score: readRawColumn(lead, "lead_score"),
        tier: readRawColumn(lead, "lead_score_tier"),
        rationale: readRawColumn(lead, "lead_score_rationale"),
      };
      const emails = {
        email_1: {
          subject: readRawColumn(lead, "email_1_subject"),
          body: readRawColumn(lead, "email_1_body"),
        },
        email_2: {
          subject: readRawColumn(lead, "email_2_subject"),
          body: readRawColumn(lead, "email_2_body"),
        },
        email_3: {
          subject: readRawColumn(lead, "email_3_subject"),
          body: readRawColumn(lead, "email_3_body"),
        },
      };
      return { lead, researchSummary, mobilePhone, leadScore, emails };
    })
    .filter((x) => x.emails.email_1.body && x.emails.email_2.body && x.emails.email_3.body);

  const skipped = allLeads.length - withEmails.length;
  if (skipped > 0) {
    console.warn(
      `Skipping ${skipped} lead(s) missing one or more email bodies (email_1/2/3_body).`
    );
  }

  const writer = new OutputWriter(checkpointPath);
  writer.loadCheckpoint();
  if (opts.reprocess) {
    writer.forgetLeads(withEmails.map((x) => x.lead));
  }

  const pending = withEmails.filter((x) => !writer.isProcessed(x.lead));

  /** XLSX/CSV is written here — not after every single lead (too slow). Checkpoint JSON updates after each lead. */
  let writeChain: Promise<void> = Promise.resolve();
  const flushWorkbook = (label: string): Promise<void> => {
    writeChain = writeChain.then(async () => {
      process.stdout.write(`Writing ${outputPath} [${label}]... `);
      await writer.writeFinal(allLeads, inputPath, outputPath, {
        preserveAppendedWhenNoSuccess: true,
      });
      console.log("ok");
    });
    return writeChain;
  };

  console.log(
    "Note: progress is also in the checkpoint JSON after each lead. The workbook is updated after each batch completes, and again at the end. Close the file in Excel before opening the updated copy, or use a different --output path."
  );
  console.log();

  const onSigInt = () => {
    void (async () => {
      console.error("\nInterrupted — saving workbook from checkpoint...");
      try {
        await flushWorkbook("interrupt");
      } catch {
        /* logged in chain */
      }
      process.exit(130);
    })();
  };
  process.once("SIGINT", onSigInt);

  try {
    if (pending.length === 0) {
      console.log("All leads already have regenerated subjects — writing output file.");
    } else {
      if (pending.length < withEmails.length) {
        console.log(
          `Skipping ${withEmails.length - pending.length} leads already completed successfully`
        );
        console.log(`Regenerating subjects for ${pending.length} remaining leads\n`);
      }
      await processRegenerateSubjectsBatches(pending, regenConfig, writer, {
        batchSize,
        onBatchComplete: () => flushWorkbook("after batch"),
      });
    }

    console.log(`\nFinal write to: ${outputPath}`);
    await flushWorkbook("final");
    console.log("Done.");
  } finally {
    process.removeListener("SIGINT", onSigInt);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

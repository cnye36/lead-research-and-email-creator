import path from "path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { parseFile } from "./leadParser.js";
import { OutputWriter } from "./outputWriter.js";
import { processRegenerateBatches } from "./regenerateBatch.js";
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

/** Prefer `research_summary`; fall back to split company/contact columns if present. */
function getExistingResearch(lead: Lead): string {
  const summary = readRawColumn(lead, "research_summary");
  if (summary) return summary;
  const company = readRawColumn(lead, "company_research");
  const contact = readRawColumn(lead, "contact_research");
  const combined = [company, contact].filter(Boolean).join("\n\n").trim();
  return combined;
}

const program = new Command();

program
  .name("regenerate-emails")
  .description(
    "Re-run only LLM email generation from existing research (no web search). Expects research_summary on each row."
  )
  .version("1.0.0")
  .requiredOption("-i, --input <file>", "Input CSV or XLSX (researched export with research_summary)")
  .option("-o, --output <file>", "Output file (defaults to input — overwrites appended columns in place)")
  .option(
    "-c, --checkpoint <file>",
    "Checkpoint for resume (separate from main script so rows are not skipped)",
    "checkpoint-regenerate-emails.json"
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

  console.log(`\nRegenerate emails (LLM only)`);
  console.log(`Input:      ${inputPath}`);
  console.log(`Output:     ${outputPath}${outputPath === inputPath ? " (in-place)" : ""}`);
  console.log(`Checkpoint: ${checkpointPath}`);
  console.log(`Model:      ${config.openaiModel}`);
  console.log(`Batch size: ${batchSize} (leads per batch before pause)`);
  console.log(
    `Rate limits: concurrency=${regenConfig.concurrency}, pause between batches=${regenConfig.batchDelayMs}ms`
  );
  if (!opts.concurrency && !opts.batchDelayMs) {
    console.log(
      "(Defaults cap concurrency at 4 and ensure at least 1500ms between batches; override with --concurrency / --batch-delay-ms or CONCURRENCY / BATCH_DELAY_MS in .env)"
    );
  }
  console.log();

  console.log("Parsing input file...");
  const allLeads = await parseFile(inputPath);
  console.log(`Found ${allLeads.length} leads`);

  const withResearch = allLeads
    .map((lead) => {
      const researchSummary = getExistingResearch(lead);
      const mobilePhone = readRawColumn(lead, "mobile_phone");
      return { lead, researchSummary, mobilePhone };
    })
    .filter((x) => x.researchSummary.length > 0);

  const skipped = allLeads.length - withResearch.length;
  if (skipped > 0) {
    console.warn(
      `Skipping ${skipped} lead(s) with no research_summary (and no company_research/contact_research fallback).`
    );
  }

  const writer = new OutputWriter(checkpointPath);
  writer.loadCheckpoint();
  if (opts.reprocess) {
    writer.forgetLeads(withResearch.map((x) => x.lead));
  }

  const pending = withResearch.filter((x) => !writer.isProcessed(x.lead));

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
      console.log("All leads with research already regenerated — writing output file.");
    } else {
      if (pending.length < withResearch.length) {
        console.log(
          `Skipping ${withResearch.length - pending.length} leads already completed successfully`
        );
        console.log(`Regenerating ${pending.length} remaining leads\n`);
      }
      await processRegenerateBatches(pending, regenConfig, writer, {
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

import path from "path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { parseFile } from "./leadParser.js";
import { OutputWriter } from "./outputWriter.js";
import { processScoreBatches } from "./scoreBatch.js";
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

function getExistingResearch(lead: Lead): string {
  const summary = readRawColumn(lead, "research_summary");
  if (summary) return summary;
  const company = readRawColumn(lead, "company_research");
  const contact = readRawColumn(lead, "contact_research");
  return [company, contact].filter(Boolean).join("\n\n").trim();
}

const program = new Command();

program
  .name("score-leads")
  .description(
    "Score leads from existing research_summary using your ICP (LEAD_SCORING_CONTEXT). Does not re-run web search or rewrite emails."
  )
  .version("1.0.0")
  .requiredOption("-i, --input <file>", "Input CSV or XLSX with research_summary")
  .option("-o, --output <file>", "Output file (defaults to input — updates score columns in place)")
  .option("-c, --checkpoint <file>", "Checkpoint for resume", "checkpoint-score-leads.json")
  .option("--reprocess", "Clear checkpoint entries for leads in this file, then re-score all of them")
  .option("-b, --batch-size <n>", "Leads per batch", "10")
  .parse(process.argv);

const opts = program.opts<{
  input: string;
  output?: string;
  checkpoint: string;
  reprocess: boolean;
  batchSize: string;
}>();

async function main() {
  const config = loadConfig();

  const inputPath = path.resolve(opts.input);
  const outputPath = path.resolve(opts.output ?? opts.input);
  const checkpointPath = path.resolve(opts.checkpoint);
  const batchSize = parseInt(opts.batchSize, 10);

  console.log(`\nScore leads (LLM only)`);
  console.log(`Input:      ${inputPath}`);
  console.log(`Output:     ${outputPath}${outputPath === inputPath ? " (in-place)" : ""}`);
  console.log(`Checkpoint: ${checkpointPath}`);
  console.log(`Model:      ${config.openaiModel}`);
  console.log(`Batch size: ${batchSize}`);
  console.log();

  console.log("Parsing input file...");
  const allLeads = await parseFile(inputPath);
  console.log(`Found ${allLeads.length} leads`);

  const withResearch = allLeads
    .map((lead) => ({ lead, researchSummary: getExistingResearch(lead) }))
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

  if (pending.length === 0) {
    console.log("All leads with research already scored — writing output file.");
  } else {
    if (pending.length < withResearch.length) {
      console.log(
        `Skipping ${withResearch.length - pending.length} leads already completed successfully`
      );
      console.log(`Scoring ${pending.length} remaining leads\n`);
    }
    await processScoreBatches(pending, config, writer, { batchSize });
  }

  console.log(`\nWriting output to: ${outputPath}`);
  await writer.writeFinal(allLeads, inputPath, outputPath, {
    preserveAppendedWhenNoSuccess: true,
  });
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

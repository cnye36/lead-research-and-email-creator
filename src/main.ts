import path from "path";
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { parseFile } from "./leadParser.js";
import { OutputWriter } from "./outputWriter.js";
import { processBatches } from "./batchProcessor.js";

const program = new Command();

program
  .name("lead-research")
  .description("Research leads and generate personalized emails using AI")
  .version("1.0.0")
  .requiredOption("-i, --input <file>", "Input CSV or XLSX file")
  .option("-o, --output <file>", "Output file (defaults to input file — appends columns in place)")
  .option("-c, --checkpoint <file>", "Checkpoint file for resuming", "checkpoint.json")
  .option(
    "--reprocess",
    "Re-run every lead in this input: remove their rows from the checkpoint first (same email or name+company key still counts as the same lead)"
  )
  .option("--no-search", "Skip web search (LLM only)")
  .option(
    "--search-provider <name>",
    "Web search backend: tavily | linkup | exa (overrides SEARCH_PROVIDER)"
  )
  .option("-b, --batch-size <n>", "Leads per batch", "10")
  .parse(process.argv);

const opts = program.opts<{
  input: string;
  output?: string;
  checkpoint: string;
  reprocess: boolean;
  search: boolean;
  searchProvider?: string;
  batchSize: string;
}>();

async function main() {
  const config = loadConfig(
    opts.searchProvider ? { searchProvider: opts.searchProvider } : undefined
  );

  const inputPath = path.resolve(opts.input);
  // Default output = input file (append columns in place)
  const outputPath = path.resolve(opts.output ?? opts.input);
  const checkpointPath = path.resolve(opts.checkpoint);
  const useSearch = opts.search;
  const batchSize = parseInt(opts.batchSize, 10);

  console.log(`\nLead Research Script`);
  console.log(`Input:      ${inputPath}`);
  console.log(`Output:     ${outputPath}${outputPath === inputPath ? " (in-place)" : ""}`);
  console.log(`Checkpoint: ${checkpointPath}`);
  console.log(`Model:      ${config.openaiModel}`);
  console.log(
    `Web search: ${useSearch ? `enabled (${config.searchProvider})` : "disabled"}`
  );
  console.log(`Batch size: ${batchSize}`);
  console.log();

  console.log("Parsing input file...");
  const allLeads = await parseFile(inputPath);
  console.log(`Found ${allLeads.length} leads`);

  const writer = new OutputWriter(checkpointPath);
  writer.loadCheckpoint();
  if (opts.reprocess) {
    writer.forgetLeads(allLeads);
  }

  const pending = allLeads.filter((l) => !writer.isProcessed(l));

  if (pending.length === 0) {
    console.log("All leads completed successfully — writing output file.");
  } else {
    if (pending.length < allLeads.length) {
      console.log(
        `Skipping ${allLeads.length - pending.length} leads already completed successfully`
      );
      console.log(`Processing ${pending.length} remaining leads\n`);
    }
    await processBatches(pending, config, writer, { useSearch, batchSize });
  }

  console.log(`\nWriting output to: ${outputPath}`);
  await writer.writeFinal(allLeads, inputPath, outputPath);
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});

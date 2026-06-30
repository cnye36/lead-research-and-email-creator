import fs from "fs";
import path from "path";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Lead, LLMOutput } from "./types.js";

interface StoredResult {
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

type CheckpointData = Record<string, StoredResult>;

export interface WriteFinalOptions {
  /**
   * When true, rows without a successful checkpoint entry keep prior appended-column
   * values from the source row (`_raw`). Use when re-running only some rows (e.g. regenerate emails).
   */
  preserveAppendedWhenNoSuccess?: boolean;
}

// These columns are always appended in this exact order, every run.
const APPENDED_COLS = [
  "research_summary",
  "mobile_phone",
  "lead_score",
  "lead_score_tier",
  "lead_score_rationale",
  "email_1_subject",
  "email_1_body",
  "email_2_subject",
  "email_2_body",
  "email_3_subject",
  "email_3_body",
  "status",
  "error",
] as const;

function leadKey(lead: Lead): string {
  if (lead.email) return lead.email.toLowerCase();
  return `${lead.firstName}_${lead.lastName}_${lead.company}`.toLowerCase();
}

/** Read a column from the original row; header match is case-insensitive. */
function normalizeHeader(header: string): string {
  return header.trim().toLowerCase();
}

function rawField(lead: Lead, canonical: string): string {
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

/** Case-insensitive match of header row cells to our canonical appended column names. */
function findAppendedColumnIndices(
  getHeader: (colNum: number) => string,
  lastCol: number
): Map<(typeof APPENDED_COLS)[number], number> {
  const indices = new Map<(typeof APPENDED_COLS)[number], number>();
  for (let colNum = 1; colNum <= lastCol; colNum++) {
    const header = getHeader(colNum);
    if (!header) continue;
    const norm = normalizeHeader(header);
    for (const canonical of APPENDED_COLS) {
      if (norm === normalizeHeader(canonical)) {
        // Prefer the rightmost match so re-runs update the latest column set if duplicates exist
        indices.set(canonical, colNum);
      }
    }
  }
  return indices;
}

function valueForAppendedColumn(
  lead: Lead,
  col: (typeof APPENDED_COLS)[number],
  result: StoredResult | undefined,
  preserveAppendedWhenNoSuccess: boolean
): string {
  if (!preserveAppendedWhenNoSuccess) {
    if (result?.status === "success") return String(result[col] ?? "");
    return String(result?.[col] ?? "");
  }
  if (result?.status === "success") return String(result[col] ?? "");
  return rawField(lead, col);
}

export class OutputWriter {
  private checkpointPath: string;
  private results: Map<string, StoredResult>;

  constructor(checkpointPath: string) {
    this.checkpointPath = checkpointPath;
    this.results = new Map();
  }

  loadCheckpoint(): void {
    if (!fs.existsSync(this.checkpointPath)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.checkpointPath, "utf8")) as CheckpointData;
      for (const [k, v] of Object.entries(data)) this.results.set(k, v);
      const ok = [...this.results.values()].filter((r) => r.status !== "error").length;
      const failed = this.results.size - ok;
      console.log(
        `Checkpoint: ${ok} succeeded, ${failed} failed — failures are re-queued for retry`
      );
    } catch {
      console.warn("Could not read checkpoint, starting fresh");
    }
  }

  /**
   * Remove stored results for these leads so they will be processed again.
   * Checkpoint file is updated when any entries were removed.
   */
  forgetLeads(leads: Lead[]): void {
    let removed = 0;
    for (const lead of leads) {
      if (this.results.delete(leadKey(lead))) removed += 1;
    }
    if (removed > 0) {
      this.saveCheckpoint();
      console.log(
        `--reprocess: cleared ${removed} checkpoint entr${removed === 1 ? "y" : "ies"} for leads in this input file.`
      );
    } else {
      console.log(
        "--reprocess: no matching checkpoint entries for leads in this file (nothing to clear)."
      );
    }
  }

  /** Skip only successful (or legacy) rows; `status: "error"` is retried on the next run. */
  isProcessed(lead: Lead): boolean {
    const r = this.results.get(leadKey(lead));
    if (r === undefined) return false;
    return r.status !== "error";
  }

  addResult(lead: Lead, output: LLMOutput | null, error?: string): void {
    const key = leadKey(lead);
    const prior = this.results.get(key);

    const scoreFields = (score?: LLMOutput["lead_score"]) => {
      const fromOutput = score
        ? {
            lead_score: String(score.score),
            lead_score_tier: score.tier,
            lead_score_rationale: score.rationale,
          }
        : null;
      if (fromOutput) return fromOutput;
      if (prior?.status === "success") {
        return {
          lead_score: prior.lead_score,
          lead_score_tier: prior.lead_score_tier,
          lead_score_rationale: prior.lead_score_rationale,
        };
      }
      return { lead_score: "", lead_score_tier: "", lead_score_rationale: "" };
    };

    const result: StoredResult = output
      ? {
          research_summary: output.research_summary,
          mobile_phone: output.mobile_phone,
          ...scoreFields(output.lead_score),
          email_1_subject: output.email_1.subject,
          email_1_body: output.email_1.body,
          email_2_subject: output.email_2.subject,
          email_2_body: output.email_2.body,
          email_3_subject: output.email_3.subject,
          email_3_body: output.email_3.body,
          status: "success",
        }
      : {
          research_summary: "",
          mobile_phone: "",
          lead_score: "",
          lead_score_tier: "",
          lead_score_rationale: "",
          email_1_subject: "", email_1_body: "",
          email_2_subject: "", email_2_body: "",
          email_3_subject: "", email_3_body: "",
          status: "error",
          error,
        };

    this.results.set(key, result);
    this.saveCheckpoint();
  }

  getStats(): { processed: number } {
    return { processed: this.results.size };
  }

  private saveCheckpoint(): void {
    fs.writeFileSync(
      this.checkpointPath,
      JSON.stringify(Object.fromEntries(this.results), null, 2)
    );
  }

  // inputPath is always the original source file — used to preserve original cell
  // values (hyperlinks, rich text) when writing XLSX output.
  async writeFinal(
    allLeads: Lead[],
    inputPath: string,
    outputPath: string,
    options?: WriteFinalOptions
  ): Promise<void> {
    const preserve = options?.preserveAppendedWhenNoSuccess === true;
    const ext = path.extname(inputPath).toLowerCase();
    if (ext === ".xlsx" || ext === ".xls") {
      await this.writeXlsx(allLeads, inputPath, outputPath, preserve);
    } else {
      this.writeCsv(allLeads, outputPath, preserve);
    }
  }

  private writeCsv(allLeads: Lead[], outputPath: string, preserve: boolean): void {
    const appendedLower = new Set(APPENDED_COLS.map((c) => c.toLowerCase()));
    const rows = allLeads.map((lead) => {
      const result = this.results.get(leadKey(lead));
      // Drop prior appended columns from _raw so re-runs do not duplicate headers
      const row: Record<string, string> = {};
      for (const [k, v] of Object.entries(lead._raw)) {
        if (!appendedLower.has(k.trim().toLowerCase())) {
          row[k] = v;
        }
      }
      for (const col of APPENDED_COLS) {
        row[col] = valueForAppendedColumn(lead, col, result, preserve);
      }
      return row;
    });
    fs.writeFileSync(outputPath, Papa.unparse(rows, { newline: "\n" }));
  }

  private async writeXlsx(
    allLeads: Lead[],
    inputPath: string,
    outputPath: string,
    preserve: boolean
  ): Promise<void> {
    // Load the original file so all existing cell values, hyperlinks, and
    // rich-text objects are preserved exactly as-is.
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(inputPath);

    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("No worksheets found in source file");

    const headerRow = sheet.getRow(1);
    let lastCol = 0;
    headerRow.eachCell((_cell, colNum) => {
      if (colNum > lastCol) lastCol = colNum;
    });

    const existingIndices = findAppendedColumnIndices(
      (colNum) => String(headerRow.getCell(colNum).value ?? "").trim(),
      lastCol
    );

    const colIndex = new Map<(typeof APPENDED_COLS)[number], number>();
    for (const col of APPENDED_COLS) {
      const existing = existingIndices.get(col);
      if (existing !== undefined) {
        colIndex.set(col, existing);
        continue;
      }
      lastCol += 1;
      headerRow.getCell(lastCol).value = col;
      colIndex.set(col, lastCol);
    }
    headerRow.commit();

    // Use the stored row index so we match the exact source row regardless of
    // any filtering that happened between parse and write.
    for (const lead of allLeads) {
      const row = sheet.getRow(lead._rowIndex);
      const result = this.results.get(leadKey(lead));
      for (const col of APPENDED_COLS) {
        const idx = colIndex.get(col);
        if (idx === undefined) continue;
        row.getCell(idx).value = valueForAppendedColumn(
          lead,
          col,
          result,
          preserve
        );
      }
      row.commit();
    }

    await workbook.xlsx.writeFile(outputPath);
  }
}

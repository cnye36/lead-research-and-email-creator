import fs from "fs";
import path from "path";
import Papa from "papaparse";
import ExcelJS from "exceljs";
import type { Lead } from "./types.js";

// Maps common Apollo (and generic) column names to internal field names
const COLUMN_MAP: Record<string, keyof Lead> = {
  "first name": "firstName",
  "firstname": "firstName",
  "first_name": "firstName",
  "last name": "lastName",
  "lastname": "lastName",
  "last_name": "lastName",
  "email": "email",
  "email address": "email",
  "work email": "email",
  "primary_email": "email",
  "title": "title",
  "job title": "title",
  "position": "title",
  "company": "company",
  "company name": "company",
  "company_name": "company",
  "company_name_for_emails": "company",
  "organization": "company",
  "company domain": "companyDomain",
  "domain": "companyDomain",
  "website": "companyDomain",
  "industry": "industry",
  "# employees": "companySize",
  "employees": "companySize",
  "company size": "companySize",
  "num employees": "companySize",
  "headcount": "companySize",
  "city": "city",
  "state": "state",
  "country": "country",
  "linkedin url": "linkedinUrl",
  "linkedin": "linkedinUrl",
  "person_linkedin_url": "linkedinUrl",
  "phone": "phone",
  "phone number": "phone",
  "mobile phone": "phone",
  "mobile_phone": "phone",
  "corporate_phone": "phone",
  "company_phone": "phone",
  "technologies": "technologies",
  "keywords": "keywords",
  "annual revenue": "annualRevenue",
  "revenue": "annualRevenue",
};

function normalizeKey(raw: string): string {
  return raw.trim().toLowerCase();
}

function mapRow(rawRow: Record<string, string>, rowIndex: number): Lead {
  const lead: Partial<Lead> = {};

  for (const [rawKey, value] of Object.entries(rawRow)) {
    const normalized = normalizeKey(rawKey);
    const mapped = COLUMN_MAP[normalized];
    if (mapped) {
      (lead as Record<string, unknown>)[mapped] = value?.trim() ?? "";
    }
  }

  lead.firstName ??= "";
  lead.lastName ??= "";
  lead.email ??= "";
  lead.title ??= "";
  lead.company ??= "";

  // Preserve original column names/values exactly for output
  lead._raw = Object.fromEntries(
    Object.entries(rawRow).map(([k, v]) => [k, v?.trim() ?? ""])
  );
  lead._rowIndex = rowIndex;

  return lead as Lead;
}

export async function parseFile(filePath: string): Promise<Lead[]> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv") return parseCsv(filePath);
  if (ext === ".xlsx" || ext === ".xls") return parseXlsx(filePath);

  throw new Error(`Unsupported file type: ${ext}. Use .csv or .xlsx`);
}

function parseCsv(filePath: string): Lead[] {
  const content = fs.readFileSync(filePath, "utf8");
  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    const fatal = result.errors.filter((e) => e.type === "FieldMismatch");
    if (fatal.length > 0) {
      console.warn(`CSV parse warnings: ${fatal.length} rows had field mismatches`);
    }
  }

  // Row 1 is the header; data starts at row 2
  return result.data
    .map((row, i) => mapRow(row, i + 2))
    .filter((l) => l.email || l.company);
}

async function parseXlsx(filePath: string): Promise<Lead[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("No worksheets found in Excel file");

  const rawRows: { data: Record<string, string>; rowIndex: number }[] = [];
  let headers: string[] = [];

  worksheet.eachRow((row, rowIndex) => {
    const values = row.values as (ExcelJS.CellValue | undefined)[];
    if (rowIndex === 1) {
      headers = values
        .slice(1)
        .map((v) => String(v ?? "").trim());
      return;
    }

    const obj: Record<string, string> = {};
    values.slice(1).forEach((val: ExcelJS.CellValue | undefined, i: number) => {
      if (headers[i]) {
        obj[headers[i]] = val != null ? String(val).trim() : "";
      }
    });
    rawRows.push({ data: obj, rowIndex });
  });

  return rawRows
    .map(({ data, rowIndex }) => mapRow(data, rowIndex))
    .filter((l) => l.email || l.company);
}

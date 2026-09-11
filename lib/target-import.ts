import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { z } from "zod";
import type { Account } from "@/lib/schemas";

export const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 500;
export const IMPORT_HEADERS = ["account_name", "website", "zoominfo_company_id", "vertical", "tier", "relationship_status", "suggested_entry_offer"] as const;
const positiveIntegerText = z.string().regex(/^[1-9]\d*$/, "Must be a positive integer").refine((value) => Number.isSafeInteger(Number(value)), "Integer is too large");
export function normalizedWebsite(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) throw new Error("Use an official company domain or HTTP(S) website");
  return `https://${hostname}/`;
}
export function accountDomain(value: string): string {
  try { return normalizedWebsite(value); } catch { return value.toLowerCase(); }
}
export const importRowSchema = z.object({
  rowNumber: z.number().int().min(2),
  account_name: z.string().trim().min(1, "Account name is required").max(300),
  website: z.string().trim().min(1, "Website is required").transform((value, ctx) => {
    try { return normalizedWebsite(value); } catch { ctx.addIssue({ code: "custom", message: "Use an official company domain or HTTP(S) website" }); return z.NEVER; }
  }),
  zoominfo_company_id: positiveIntegerText.optional(),
  vertical: z.string().trim().max(300).optional(),
  tier: positiveIntegerText.transform(Number).optional(),
  relationship_status: z.string().trim().max(300).optional(),
  suggested_entry_offer: z.string().trim().max(2000).optional(),
}).strict();
export type ImportRow = Omit<z.infer<typeof importRowSchema>, "tier"> & { tier?: number };
export type ImportIssue = { row: number; column: string; message: string };
export type ImportPreview = {
  rows: ImportRow[];
  classifications: Array<{ row: number; name: string; status: "new" | "reused" | "duplicate" | "invalid"; accountId?: string }>;
  errors: ImportIssue[];
  warnings: string[];
};

// Used both after file parsing and at commit. Never trust a client's preview result.
export function validateImportRows(input: unknown[], accounts: Account[]): ImportPreview {
  const preview: ImportPreview = { rows: [], classifications: [], errors: [], warnings: [] };
  if (!input.length || input.length > MAX_IMPORT_ROWS) preview.errors.push({ row: 0, column: "file", message: "Provide between 1 and 500 account rows" });
  const domains = new Set<string>();
  const providerIds = new Set<string>();
  const canonicalIds = new Set<string>();
  for (const [index, raw] of input.entries()) {
    const candidate = raw && typeof raw === "object" ? { ...raw } as Record<string, unknown> : {};
    if (typeof candidate.tier === "number") candidate.tier = String(candidate.tier);
    const parsed = importRowSchema.safeParse(candidate);
    const rowNumber = Number.isInteger(candidate.rowNumber) ? Number(candidate.rowNumber) : index + 2;
    if (!parsed.success) {
      preview.errors.push(...parsed.error.issues.map((issue) => ({ row: rowNumber, column: issue.path.join(".") || "row", message: issue.message })));
      preview.classifications.push({ row: rowNumber, name: String(candidate.account_name || ""), status: "invalid" });
      continue;
    }
    const row = parsed.data;
    for (const [column, value] of Object.entries(row)) {
      if (typeof value === "string" && /^[=+@]/.test(value)) preview.errors.push({ row: row.rowNumber, column, message: "Formula-like values are not supported; provide plain text" });
    }
    const byId = row.zoominfo_company_id ? accounts.filter((a) => a.providerIds?.zoominfoCompanyId === row.zoominfo_company_id) : [];
    const byDomain = accounts.filter((a) => accountDomain(a.website) === row.website);
    const matches = [...byId, ...byDomain];
    const canonical = new Set(matches.map((a) => a.canonicalCompanyId));
    const conflict = canonical.size > 1 || byId.some((a) => accountDomain(a.website) !== row.website) || byDomain.some((a) => row.zoominfo_company_id && a.providerIds?.zoominfoCompanyId && a.providerIds.zoominfoCompanyId !== row.zoominfo_company_id);
    const match = matches.find((a) => !a.duplicateOf) || matches[0];
    const duplicate = domains.has(row.website) || Boolean(row.zoominfo_company_id && providerIds.has(row.zoominfo_company_id)) || Boolean(match && canonicalIds.has(match.canonicalCompanyId));
    if (conflict || duplicate) preview.errors.push({ row: row.rowNumber, column: "website / zoominfo_company_id", message: conflict ? "Identifiers conflict with existing company records" : "Duplicate company in this file" });
    domains.add(row.website);
    if (row.zoominfo_company_id) providerIds.add(row.zoominfo_company_id);
    if (match) canonicalIds.add(match.canonicalCompanyId);
    preview.rows.push(row);
    preview.classifications.push({ row: row.rowNumber, name: row.account_name, status: conflict ? "invalid" : duplicate ? "duplicate" : match ? "reused" : "new", accountId: match?.id });
  }
  return preview;
}

export async function parseTargetFile(filename: string, buffer: Buffer, accounts: Account[]): Promise<ImportPreview> {
  if (buffer.length > MAX_IMPORT_BYTES) throw new Error("File exceeds the 4 MB limit");
  const extension = filename.toLowerCase().split(".").pop();
  if (extension !== "csv" && extension !== "xlsx") throw new Error("Choose a CSV or XLSX file");
  const workbook = new ExcelJS.Workbook();
  let sheet: ExcelJS.Worksheet | undefined;
  if (extension === "csv") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    sheet = await workbook.csv.read(Readable.from([text]), { map: (value: string) => value, parserOptions: { ignoreEmpty: false, maxRows: 10002 } });
  } else {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    sheet = workbook.worksheets[0];
  }
  if (!sheet || sheet.rowCount < 2) throw new Error("File must contain a header and at least one account");
  if (sheet.rowCount > 10001 || sheet.columnCount > 50) throw new Error("Worksheet exceeds the supported dimensions; remove unused rows and columns");
  const errors: ImportIssue[] = [];
  const headers: string[] = [];
  const headerRow = sheet.getRow(1);
  for (let column = 1; column <= sheet.columnCount; column++) {
    const value = headerRow.getCell(column).value;
    const header = typeof value === "string" ? value.replace(/^\uFEFF/, "").trim().toLowerCase() : "";
    headers.push(header);
    if (!IMPORT_HEADERS.includes(header as typeof IMPORT_HEADERS[number])) errors.push({ row: 1, column: String(column), message: `Unknown or empty header: ${header || "(blank)"}` });
    if (header && headers.indexOf(header) !== headers.length - 1) errors.push({ row: 1, column: header, message: "Duplicate header" });
  }
  for (const required of ["account_name", "website"]) if (!headers.includes(required)) errors.push({ row: 1, column: required, message: "Required header is missing" });
  const rows: Record<string, unknown>[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, unknown> = { rowNumber };
    let populated = false;
    headers.forEach((header, index) => {
      const value = row.getCell(index + 1).value;
      if (value == null || value === "") return;
      if (typeof value !== "string" && typeof value !== "number") { populated = true; errors.push({ row: rowNumber, column: header, message: "Use plain text or numbers; formulas and non-scalar cells are not supported" }); return; }
      const text = String(value).trim();
      if (!text) return;
      populated = true;
      if (/^[=+@]/.test(text)) { errors.push({ row: rowNumber, column: header, message: "Formula-like values are not supported; provide plain text" }); return; }
      if (text) record[header] = text;
    });
    if (populated) rows.push(record);
  });
  const preview = validateImportRows(rows, accounts);
  preview.errors.unshift(...errors);
  if (workbook.worksheets.length > 1) preview.warnings.push(`Only the first worksheet, "${sheet.name}", will be imported.`);
  return preview;
}

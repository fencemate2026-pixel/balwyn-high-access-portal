/**
 * Owner sites — CSV helpers (4 Nov 2026). Pure functions, no I/O, safe on server and browser.
 *
 * Export guards against spreadsheet formula injection: a cell that starts with = + - @ (or a
 * tab / carriage return) is prefixed with an apostrophe so Excel and Sheets read it as text.
 * Import reads RFC 4180 style CSV (quoted fields, doubled quotes, CRLF, BOM) and returns plain rows;
 * the server re-validates every row, so nothing here is trusted.
 */

/** One CSV cell, quoted when needed and neutralised against formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** Split CSV text into rows of cells. Blank lines are dropped. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const endCell = () => { row.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (row.some((c) => c.trim() !== "")) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") { if (text[i + 1] === "\n") i++; endRow(); }
    else cell += ch;
  }
  if (cell !== "" || row.length) endRow();
  return rows;
}

export type WhitelistCsvRow = { name: string; phone: string; unitLabel: string };

/**
 * Whitelist import: columns Name, Mobile (or Phone), Unit. A header row is optional.
 * Returns the rows to send plus a plain-English note for each line that was skipped.
 * A leading apostrophe added by {@link csvCell} on export is removed on re-import.
 */
export function parseWhitelistCsv(text: string, maxRows = 500): { rows: WhitelistCsvRow[]; problems: string[] } {
  const all = parseCsv(text);
  const problems: string[] = [];
  if (!all.length) return { rows: [], problems: ["The file is empty."] };
  const head = all[0].map((c) => c.trim().toLowerCase());
  const hasHeader = head.includes("name") && (head.includes("mobile") || head.includes("phone"));
  const col = (names: string[], fallback: number) => { const i = head.findIndex((h) => names.includes(h)); return hasHeader ? i : fallback; };
  const iName = col(["name"], 0), iPhone = col(["mobile", "phone"], 1), iUnit = col(["unit", "unit label"], 2);
  const clean = (v: string | undefined) => (v ?? "").trim().replace(/^'(?=[=+\-@])/, "");
  const rows: WhitelistCsvRow[] = [];
  const seen = new Set<string>();
  (hasHeader ? all.slice(1) : all).forEach((r, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const name = clean(r[iName]), phone = clean(r[iPhone]), unitLabel = iUnit >= 0 ? clean(r[iUnit]) : "";
    if (!name || !phone) { problems.push(`Line ${line}: name and mobile are both required.`); return; }
    const key = phone.replace(/\D/g, "");
    if (seen.has(key)) { problems.push(`Line ${line}: ${name} repeats a number already in the file.`); return; }
    seen.add(key);
    if (rows.length >= maxRows) { if (!problems.some((p) => p.startsWith("Only the first"))) problems.push(`Only the first ${maxRows} rows are used.`); return; }
    rows.push({ name, phone, unitLabel });
  });
  return { rows, problems };
}

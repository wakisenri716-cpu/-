// Minimal CSV builder: quotes any field containing a comma, quote, or
// newline, and prepends a UTF-8 BOM so Excel on Windows (the likely
// consumer for accounting exports) doesn't mangle Japanese text.
function escapeCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function buildCsv(rows: (string | number)[][]): string {
  const body = rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
  return `﻿${body}\r\n`;
}

export function csvResponse(filename: string, rows: (string | number)[][]): Response {
  // filename= must stay ASCII per RFC 6266; non-ASCII names (Japanese
  // account names) go in filename*= instead, which browsers prefer when
  // present, with a plain ASCII fallback for the few that don't support it.
  const asciiFallback = filename.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(filename);
  return new Response(buildCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`,
    },
  });
}

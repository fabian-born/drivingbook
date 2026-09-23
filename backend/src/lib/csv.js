// ============================================================
// CSV-Hilfen
// ============================================================

// Textfeld für CSV: in Anführungszeichen, " verdoppelt; führende
// Formelzeichen werden neutralisiert (Excel-Formel-Injection)
export function csvField(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

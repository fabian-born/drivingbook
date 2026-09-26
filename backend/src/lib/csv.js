// ============================================================
// CSV helpers
// ============================================================

// Text field for CSV: quoted, " doubled; leading formula
// characters are neutralized (Excel formula injection)
export function csvField(value) {
  let text = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

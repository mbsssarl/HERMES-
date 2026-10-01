/** Normalizes a product/article name for fuzzy matching: lowercase, no accents, no punctuation, single spaces. */
export function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes a product code/IMPA for comparison: keeps only letters and digits, uppercase. Formatting
 * (dots, dashes, slashes, spaces) is ignored, so "23.30-34", "23/30/34" and "233034" all compare equal -
 * the same code typed with different punctuation in different documents.
 */
export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

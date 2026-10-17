import { findHeaderRowIndex } from "./columnMapping";
import type { RawTable } from "./excel";

/**
 * Transforme un texte brut (couche texte d'un PDF, document Word sans tableau...) en tableau :
 * repère la ligne d'en-tête la plus plausible (les vraies demandes portent un en-tête de société / navire /
 * référence avant le tableau d'articles), puis découpe chaque ligne en colonnes sur les tabulations ou les
 * suites de 2 espaces ou plus. Retourne null si aucun en-tête n'est reconnu.
 */
export function tableFromText(text: string): RawTable | null {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerIndex = findHeaderRowIndex(lines.map((line) => [line]));
  if (headerIndex === -1) return null;

  const splitColumns = (line: string): string[] =>
    line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);

  return {
    headerRow: splitColumns(lines[headerIndex]),
    dataRows: lines.slice(headerIndex + 1).map(splitColumns),
    preambleRows: lines.slice(0, headerIndex).map(splitColumns),
  };
}

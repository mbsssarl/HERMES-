"use node";

import { findHeaderRowIndex } from "./columnMapping";
import type { RawTable } from "./excel";

/**
 * Best-effort table extraction from a PDF's text layer: finds the most
 * plausible header line (real enquiry PDFs, like Excel ones, usually carry
 * a letterhead/vessel/reference block before the item table), then splits
 * every line into columns on runs of 2+ spaces (the layout PDF table
 * extractors typically produce). This module is intentionally isolated
 * behind this single function so it can be swapped for a more advanced (or
 * OCR-backed) engine later without touching the rest of the pipeline.
 */
export async function extractPdfTable(buffer: Buffer): Promise<RawTable> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  let text: string;
  try {
    text = (await parser.getText()).text ?? "";
  } finally {
    await parser.destroy();
  }

  if (text.trim().length < 20) {
    throw new Error(
      "Aucun texte exploitable trouvé dans ce PDF (probablement un document scanné). " +
        "La saisie manuelle des lignes est nécessaire pour ce document.",
    );
  }

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerIndex = findHeaderRowIndex(lines.map((line) => [line]));
  if (headerIndex === -1) {
    throw new Error(
      "Impossible d'identifier l'en-tête du tableau dans ce PDF. Vérifiez le document ou saisissez les lignes manuellement.",
    );
  }

  const splitColumns = (line: string): string[] =>
    line.split(/\s{2,}/).map((c) => c.trim()).filter((c) => c.length > 0);

  const headerRow = splitColumns(lines[headerIndex]);
  const dataRows = lines.slice(headerIndex + 1).map(splitColumns);
  const preambleRows = lines.slice(0, headerIndex).map(splitColumns);

  return { headerRow, dataRows, preambleRows };
}

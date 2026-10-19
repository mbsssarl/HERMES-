"use node";

import "./domPolyfill";
import type { RawTable } from "./excel";
import { extractPdfTableByLayout } from "./pdfLayout";
import { tableFromText } from "./tableFromText";

/**
 * Extraction d'un PDF : lecture selon la position du texte, puis texte brut en repli. Un PDF scanné (sans couche
 * texte) n'est pas lisible.
 */
export async function extractPdfTable(buffer: Buffer): Promise<RawTable> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  let text = "";
  try {
    // 1) Lecture selon la position du texte (formulaires à colonnes), 2) texte brut en repli.
    try {
      const doc = await (parser as unknown as { load(): Promise<Parameters<typeof extractPdfTableByLayout>[0]> }).load();
      const byLayout = await extractPdfTableByLayout(doc);
      if (byLayout) return byLayout;
    } catch {
      // lecture par position impossible : on retombe sur le texte brut
    }
    text = (await parser.getText()).text ?? "";
  } catch {
    // PDF dont le texte est illisible : traité plus bas comme un document sans texte.
  } finally {
    await parser.destroy().catch(() => {});
  }

  if (text.trim().length >= 20) {
    const table = tableFromText(text);
    if (table && table.dataRows.length > 0) return table;
  }
  if (text.trim().length < 20) {
    throw new Error(
      "Aucun texte exploitable trouvé dans ce PDF (probablement un document scanné). " +
        "La saisie manuelle des lignes est nécessaire pour ce document.",
    );
  }
  throw new Error(
    "Impossible d'identifier l'en-tête du tableau dans ce PDF. Vérifiez le document ou saisissez les lignes manuellement.",
  );
}

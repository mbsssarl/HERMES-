"use node";

import type { RawTable } from "./excel";
import { tableFromText } from "./tableFromText";

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

function tableFromHtml(html: string): RawTable | null {
  // Plusieurs tableaux possibles (ex. petit tableau « Navire / Date » puis tableau des articles) : on prend le plus long.
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => ({ html: m[0], index: m.index ?? 0 }));
  let best: { rows: string[][]; index: number } | null = null;
  for (const t of tables) {
    const rows = [...t.html.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((rowMatch) =>
      [...rowMatch[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((cellMatch) => stripTags(cellMatch[0])),
    );
    if (!best || rows.length > best.rows.length) best = { rows, index: t.index };
  }
  if (!best || best.rows.length < 2) return null;
  // En-tête = première ligne comportant au moins 2 cellules renseignées (les lignes vides / fusionnées sont ignorées).
  const headerAt = best.rows.findIndex((r) => r.filter((c) => c.length > 0).length >= 2);
  if (headerAt < 0 || headerAt === best.rows.length - 1) return null;
  // Texte qui précède le tableau (y compris les petits tableaux d'en-tête) : société / navire / référence.
  const before = html.slice(0, best.index);
  const preambleRows: string[][] = [];
  for (const chunk of before.split(/<\/tr>/i)) {
    const parts = /<t[dh][\s>]/i.test(chunk) ? [chunk] : chunk.split(/<\/p>|<br\s*\/?>|<\/h\d>/i);
    for (const part of parts) {
      const cells = part.split(/<\/t[dh]>/i).map(stripTags).filter((c) => c.length > 0);
      if (cells.length > 0) preambleRows.push(cells);
    }
  }
  return { headerRow: best.rows[headerAt], dataRows: best.rows.slice(headerAt + 1), preambleRows };
}

/** Word moderne (.docx) : premier tableau du document, ou à défaut le texte des paragraphes. */
export async function extractWordTable(buffer: Buffer): Promise<RawTable> {
  // Une fois empaqueté, le module CommonJS arrive sous « default » : sans cela, convertToHtml est introuvable.
  const imported = await import("mammoth");
  const mammoth = imported.default ?? imported;
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const fromHtml = tableFromHtml(html);
  if (fromHtml) return fromHtml;

  const { value: text } = await mammoth.extractRawText({ buffer });
  const fromText = tableFromText(text);
  if (fromText && fromText.dataRows.length > 0) return fromText;
  throw new Error("Aucun tableau d'articles trouvé dans ce document Word.");
}


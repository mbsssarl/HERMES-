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
  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return null;
  const rowMatches = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  if (rowMatches.length < 2) return null;
  const rows = rowMatches.map((rowMatch) =>
    [...rowMatch[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)].map((cellMatch) => stripTags(cellMatch[0])),
  );
  // Texte qui précède le tableau : en-tête de société / navire / référence.
  const before = html.slice(0, html.search(/<table/i));
  const preambleRows = before
    .split(/<\/p>|<br\s*\/?>|<\/h\d>/i)
    .map(stripTags)
    .filter((l) => l.length > 0)
    .map((l) => [l]);
  return { headerRow: rows[0], dataRows: rows.slice(1), preambleRows };
}

/** Word moderne (.docx) : premier tableau du document, ou à défaut le texte des paragraphes. */
export async function extractWordTable(buffer: Buffer): Promise<RawTable> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });
  const fromHtml = tableFromHtml(html);
  if (fromHtml) return fromHtml;

  const { value: text } = await mammoth.extractRawText({ buffer });
  const fromText = tableFromText(text);
  if (fromText && fromText.dataRows.length > 0) return fromText;
  throw new Error("Aucun tableau d'articles trouvé dans ce document Word.");
}


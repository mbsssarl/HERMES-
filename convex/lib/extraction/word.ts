"use node";

import type { RawTable } from "./excel";

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();
}

export async function extractWordTable(buffer: Buffer): Promise<RawTable> {
  const mammoth = await import("mammoth");
  const { value: html } = await mammoth.convertToHtml({ buffer });

  const tableMatch = html.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) {
    throw new Error("Aucun tableau trouvé dans ce document Word.");
  }

  const rowMatches = [...tableMatch[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)];
  if (rowMatches.length < 2) {
    throw new Error("Le tableau du document Word ne contient pas assez de lignes.");
  }

  const rows = rowMatches.map((rowMatch) => {
    const cellMatches = [...rowMatch[0].matchAll(/<t[dh][\s\S]*?<\/t[dh]>/gi)];
    return cellMatches.map((cellMatch) => stripTags(cellMatch[0]));
  });

  const headerRow = rows[0];
  const dataRows = rows.slice(1);
  // This extractor only looks inside the <table> element, so there's no
  // captured letterhead/vessel text to mine for metadata - no preamble.
  return { headerRow, dataRows, preambleRows: [] };
}

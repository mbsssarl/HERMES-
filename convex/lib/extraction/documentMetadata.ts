type CellValue = string | number | null | undefined;

export interface DocumentMetadata {
  vessel?: string;
  supplyPlace?: string;
  clientOrderNumber?: string;
  // Rest of the header block (stored in orders.documentInfo)
  issuer?: string;
  instructions?: string;
  enquiryDate?: string;
  enquiryTo?: string;
  replyBy?: string;
  imoNo?: string;
  country?: string;
  category?: string;
  department?: string;
  vendorRef?: string;
  paymentDays?: string;
  currency?: string;
}

/**
 * Real enquiry documents carry a "Label: Value" preamble block (vessel,
 * port, enquiry reference...) before the item table - this scans exactly
 * that block (the rows the header-detection logic skipped over) to
 * pre-fill order fields the user hasn't already set. Best-effort: any
 * field not found is simply left undefined, never guessed.
 */
const LABEL_PATTERNS: { field: Exclude<keyof DocumentMetadata, "issuer" | "instructions">; labels: string[] }[] = [
  { field: "vessel", labels: ["vessel", "navire", "vessel name"] },
  { field: "supplyPlace", labels: ["port", "port of delivery", "delivery port", "supply place"] },
  {
    field: "clientOrderNumber",
    labels: ["enquiry ref. no", "enquiry ref no", "enquiry reference", "ref no", "reference no", "po no", "po number"],
  },
  { field: "enquiryDate", labels: ["date"] },
  { field: "enquiryTo", labels: ["enquiry to"] },
  { field: "replyBy", labels: ["reply by"] },
  { field: "imoNo", labels: ["imo no", "imo", "imo number"] },
  { field: "country", labels: ["country"] },
  { field: "category", labels: ["category"] },
  { field: "department", labels: ["department"] },
  { field: "vendorRef", labels: ["vendor ref. no", "vendor ref no", "vendor ref", "vendor reference"] },
  { field: "paymentDays", labels: ["payment days", "payment terms"] },
  { field: "currency", labels: ["quot. currency", "quot currency", "quotation currency", "currency"] },
];

function cellLabel(cell: CellValue): string {
  if (cell === null || cell === undefined) return "";
  return String(cell)
    .trim()
    .toLowerCase()
    .replace(/:\s*$/, "");
}

function cellText(cell: CellValue): string {
  return cell === null || cell === undefined ? "" : String(cell).trim();
}

export function extractDocumentMetadata(preambleRows: CellValue[][]): DocumentMetadata {
  const metadata: DocumentMetadata = {};

  // Free-text rows (letterhead, reply instructions): a single text repeated across merged cells,
  // not a "Label: value" pair. The first is the sender block, the next one the instructions.
  const freeTexts: string[] = [];
  for (const row of preambleRows) {
    const texts = row.map(cellText).filter(Boolean);
    if (texts.length === 0) continue;
    const distinct = new Set(texts);
    if (distinct.size === 1 && !texts[0].endsWith(":")) freeTexts.push(texts[0]);
  }
  if (freeTexts[0]) metadata.issuer = freeTexts[0];
  if (freeTexts[1]) metadata.instructions = freeTexts[1];

  for (const row of preambleRows) {
    for (let i = 0; i < row.length; i++) {
      const label = cellLabel(row[i]);
      if (!label) continue;

      const pattern = LABEL_PATTERNS.find((p) => !metadata[p.field] && p.labels.includes(label));
      if (!pattern) continue;

      // The value sits in the next non-empty cell after the label - real
      // templates often repeat it across a few merged cells, so the first
      // non-empty one found is the one we want. A following "Other label:" cell means
      // this label's value was left blank.
      for (let j = i + 1; j < row.length; j++) {
        const raw = row[j];
        if (raw === null || raw === undefined) continue;
        const str = String(raw).trim();
        if (!str) continue;
        if (str.endsWith(":")) break;
        metadata[pattern.field] = str;
        break;
      }
    }
  }

  return metadata;
}

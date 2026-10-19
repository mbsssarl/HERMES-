/**
 * Types de documents acceptés. Le type MIME envoyé par le navigateur est peu fiable (parfois vide,
 * « application/octet-stream » selon le poste) : on se fie d'abord au contenu du fichier, puis à l'extension.
 * Ce module n'utilise aucune API Node : il est importable depuis les mutations comme depuis les actions.
 */
export type FileKind = "pdf" | "xlsx" | "xls" | "docx";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const EXTENSION_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  xlsx: "xlsx",
  xls: "xls",
  docx: "docx",
};

/** Valeur pour l'attribut `accept` des champs de dépôt de fichier. */
export const ACCEPT_ATTRIBUTE = Object.keys(EXTENSION_KIND).map((ext) => `.${ext}`).join(",");

export const UNSUPPORTED_MESSAGE =
  "Type de fichier non pris en charge (PDF, Excel .xlsx/.xls ou Word .docx).";

export function kindFromFileName(fileName: string): FileKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return EXTENSION_KIND[ext] ?? null;
}

function kindFromMime(mimeType: string): FileKind | null {
  const mime = mimeType.toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (mime === XLSX_MIME) return "xlsx";
  if (mime === "application/vnd.ms-excel") return "xls";
  if (mime.includes("wordprocessingml")) return "docx";
  return null;
}

/** Contrôle à l'envoi (sans accès au contenu) : le fichier doit au moins ressembler à un type connu. */
export function isSupportedUpload(fileName: string, mimeType: string): boolean {
  return kindFromFileName(fileName) !== null || kindFromMime(mimeType) !== null;
}

/** Type MIME normalisé à enregistrer avec le fichier (celui du navigateur peut être vide ou faux). */
export function normalizedMimeType(fileName: string, mimeType: string): string {
  const kind = kindFromFileName(fileName) ?? kindFromMime(mimeType);
  switch (kind) {
    case "pdf": return "application/pdf";
    case "xlsx": return XLSX_MIME;
    case "xls": return "application/vnd.ms-excel";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return mimeType || "application/octet-stream";
  }
}

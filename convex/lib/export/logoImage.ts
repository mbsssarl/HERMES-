export interface ExportLogo {
  base64: string;
  extension: "png" | "jpeg";
  width: number;
  height: number;
}

/** Dimensions d'un PNG (en-tête IHDR) ou d'un JPEG (premier marqueur SOF) ; null si le format n'est pas reconnu. */
function readImage(bytes: Uint8Array): { extension: "png" | "jpeg"; width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { extension: "png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { extension: "jpeg", height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
      }
      i += 2 + view.getUint16(i + 2);
    }
  }
  return null;
}

/**
 * Logo de l'entreprise pour le fichier Excel. Excel n'affiche ici que du PNG ou du JPEG : tout autre format (SVG,
 * WebP), un logo illisible ou absent donne null, et l'export utilise alors le logo neutre par défaut.
 */
export async function fetchCompanyLogo(logoUrl: string | null): Promise<ExportLogo | null> {
  if (!logoUrl) return null;
  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    const info = readImage(bytes);
    if (!info || info.width <= 0 || info.height <= 0) return null;
    return { base64: Buffer.from(bytes).toString("base64"), ...info };
  } catch {
    return null;
  }
}

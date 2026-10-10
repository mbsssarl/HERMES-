/**
 * Reconnaît une ligne qui n'est pas un article mais un intitulé de section du fichier du client
 * (ex. « EQ/SCF/LHC/0017/PROVISIONS » sur un bandeau rouge) : du texte seul, sans code, sans quantité, sans unité
 * ni prix. Ces lignes sont quand même importées, mais décochées, pour qu'elles ne soient pas exportées par erreur.
 */
export function looksLikeSectionHeader(raw: {
  rawCode?: string;
  rawDescription: string;
  rawQuantity?: number;
  rawUnit?: string;
  unitPrice?: number;
}): boolean {
  if (raw.rawCode?.trim()) return false;
  if (raw.rawQuantity !== undefined && raw.rawQuantity > 0) return false;
  if (raw.rawUnit?.trim()) return false;
  if (raw.unitPrice !== undefined) return false;
  return raw.rawDescription.trim().length > 0;
}

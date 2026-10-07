import type { QuotationStatus, MatchStatus } from '../types';

/** Une région de cotation = un pays + une ville (un même pays peut en avoir plusieurs) : « Cote d'Ivoire - Abidjan ». */
export function regionLabel(c: { name: string; city?: string | null }): string {
  return c.city ? `${c.name} - ${c.city}` : c.name;
}

export const STATUS_LABELS: Record<QuotationStatus, string> = {
  DRAFT: 'Brouillon',
  PROCESSING: 'En traitement',
  AWAITING_SUPPLIER: 'Attente fournisseur',
  PO: 'PO reçu',
  REVIEW_REQUIRED: 'À vérifier',
  READY: 'Prêt',
  EXPORTED: 'Exporté',
  SENT: 'Envoyé',
  CANCELLED: 'Archivé',
  DELETED: 'Supprimé',
};

export const STATUS_COLORS: Record<QuotationStatus, string> = {
  DRAFT: 'var(--badge-neutral)',
  PROCESSING: 'var(--badge-info)',
  AWAITING_SUPPLIER: 'var(--badge-warning)',
  PO: 'var(--badge-success)',
  REVIEW_REQUIRED: 'var(--badge-warning)',
  READY: 'var(--badge-success)',
  EXPORTED: 'var(--badge-accent)',
  SENT: 'var(--badge-accent)',
  CANCELLED: 'var(--badge-neutral)',
  DELETED: 'var(--badge-error)',
};

export const MATCH_LABELS: Record<MatchStatus, string> = {
  MATCHED: 'Reconnu',
  REVIEW: 'À confirmer',
  NOT_FOUND: 'Inconnu',
};

export const MATCH_COLORS: Record<MatchStatus, string> = {
  MATCHED: 'var(--badge-success)',
  REVIEW: 'var(--badge-warning)',
  NOT_FOUND: 'var(--badge-error)',
};

export function formatPrice(value: number | null | undefined, currency = 'EUR'): string {
  if (value === null || value === undefined) return '-';
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString('fr-FR')} ${currency}`;
  }
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** Montant en chiffres seulement (sans devise), 2 décimales : 5 825,70 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

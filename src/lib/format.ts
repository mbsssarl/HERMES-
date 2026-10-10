import type { QuotationStatus, MatchStatus } from '../types';
import { locale, t } from './i18n';

/** Une région de cotation = un pays + une ville (un même pays peut en avoir plusieurs) : « Cote d'Ivoire - Abidjan ». */
export function regionLabel(c: { name: string; city?: string | null }): string {
  return c.city ? `${c.name} · ${c.city}` : c.name;
}

const STATUS_LABELS_FR: Record<QuotationStatus, string> = {
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

/** Libellés de statut dans la langue courante (lus à l'affichage, donc toujours à jour). */
export const STATUS_LABELS = new Proxy(STATUS_LABELS_FR, {
  get: (_target, key) => t(`status.${String(key)}` as Parameters<typeof t>[0]),
}) as Record<QuotationStatus, string>;

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
    return new Intl.NumberFormat(locale(), { style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString(locale())} ${currency}`;
  }
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

/** Montant en chiffres seulement (sans devise), 2 décimales : 5 825,70 */
export function formatAmount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-';
  return new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

/**
 * Met une majuscule à la première lettre de chaque mot (« akira international » devient « Akira International »).
 * Le reste du mot est laissé tel que saisi : un sigle écrit en majuscules (« ABC », « LTD ») reste intact.
 */
export function capitalizeWords(text: string): string {
  return text.replace(/(^|[\s\-'’(\/.])(\p{Ll})/gu, (_m, sep: string, letter: string) => sep + letter.toLocaleUpperCase());
}

/** Initiales (2 lettres max) pour la pastille d'un client. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

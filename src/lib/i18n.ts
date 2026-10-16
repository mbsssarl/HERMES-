import React from 'react';

export type Language = 'fr' | 'en';

const KEY = 'language';

function readStored(): Language {
  try { return localStorage.getItem(KEY) === 'en' ? 'en' : 'fr'; } catch { return 'fr'; }
}

let current: Language = readStored();
const listeners = new Set<() => void>();

export function getLanguage(): Language {
  return current;
}

/** Change la langue de l'interface : mémorisée sur ce poste, et toute l'application se redessine. */
export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  try { localStorage.setItem(KEY, language); } catch { /* stockage indisponible */ }
  document.documentElement.lang = language;
  listeners.forEach((l) => l());
}

export function storedLanguage(): Language {
  return readStored();
}

/** Langue courante ; le composant qui l'appelle se redessine quand elle change. */
export function useLanguage(): Language {
  return React.useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    getLanguage,
  );
}

/** Code de langue pour les formats de dates et de nombres. */
export function locale(): string {
  return current === 'en' ? 'en-GB' : 'fr-FR';
}

// Le français est la langue de référence : une clé absente en anglais s'affiche en français.
const fr = {
  'nav.dashboard': 'Tableau de bord',
  'nav.quotations': 'Quotations',
  'nav.products': 'Produits & prix',
  'nav.settings': 'Réglages',
  'nav.admin': 'Admin',
  'nav.logout': 'Déconnexion',
  'nav.logoutTitle': 'Se déconnecter ?',
  'nav.logoutBody': 'Vous devrez saisir à nouveau vos identifiants pour revenir.',
  'nav.logoutConfirm': 'Se déconnecter',
  'nav.adminSpace': 'Espace admin',
  'nav.userSpace': 'Espace utilisateur',
  'nav.updatedTitle': '{n} quotation(s) mise(s) à jour suite à un ajout au catalogue',

  'common.loading': 'Chargement…',
  'common.reference': 'Référence',
  'common.client': 'Client',
  'common.region': 'Région',
  'common.status': 'Statut',
  'common.total': 'Total',
  'common.date': 'Date',
  'common.newQuotation': 'Nouvelle quotation',
  'common.noQuotation': 'Aucune quotation',

  'status.DRAFT': 'Brouillon',
  'status.PROCESSING': 'En traitement',
  'status.AWAITING_SUPPLIER': 'Attente fournisseur',
  'status.PO': 'PO reçu',
  'status.REVIEW_REQUIRED': 'À vérifier',
  'status.READY': 'Prêt',
  'status.EXPORTED': 'Exporté',
  'status.SENT': 'Envoyé',
  'status.CANCELLED': 'Archivé',
  'status.DELETED': 'Supprimé',

  'dashboard.title': 'Tableau de bord',
  'dashboard.today': 'Quotations du jour',
  'dashboard.inTotal': '{n} au total',
  'dashboard.toCheck': 'À vérifier',
  'dashboard.linesToProcess': '{n} ligne(s) à traiter',
  'dashboard.poReceived': 'PO reçus',
  'dashboard.approved': 'Approuvées par le client',
  'dashboard.poValue': 'Valeur des PO',
  'dashboard.poTotal': 'Total des PO reçus',
  'dashboard.recent': 'Quotations récentes',
  'dashboard.seeAll': 'Voir toutes les quotations',
  'dashboard.seeAllCount': 'Voir toutes les quotations ({n})',
  'dashboard.empty': 'Commencez par importer une demande client.',

  'list.emptyFilter': 'Aucune quotation ne correspond à ce filtre.',
  'list.filterAll': 'Tout',
  'list.trash': 'Corbeille',
  'list.emptyTrash': 'Vider la corbeille',
  'list.purgeTitle': 'Vider la corbeille ?',
  'list.purgeBody': '{n} quotation(s) seront supprimées définitivement, avec leurs lignes, fichiers et historique d’envoi. Cette action est irréversible.',
  'list.purgeConfirm': 'Supprimer définitivement',
  'list.purging': 'Suppression…',
  'list.purged': '{n} quotation(s) supprimée(s) définitivement.',
  'common.cancel': 'Annuler',

  'settings.title': 'Réglages',
  'settings.password': 'Mot de passe',
  'settings.passwordCurrent': 'Mot de passe actuel',
  'settings.passwordNew': 'Nouveau mot de passe',
  'settings.passwordMin': '8 caractères minimum',
  'settings.passwordConfirm': 'Confirmer le nouveau mot de passe',
  'settings.passwordSubmit': 'Mettre à jour le mot de passe',
  'settings.saving': 'Enregistrement…',
  'settings.passwordMismatch': 'Les mots de passe ne correspondent pas.',
  'settings.passwordUpdated': 'Mot de passe mis à jour.',
  'settings.appearance': 'Apparence',
  'settings.appearanceHint': 'Le thème choisi est enregistré sur votre compte et s’applique sur tous vos appareils.',
  'settings.light': 'Clair',
  'settings.dark': 'Sombre',
  'settings.language': 'Langue',
  'settings.languageHint': 'La langue choisie est enregistrée sur votre compte et s’applique sur tous vos appareils.',
  'settings.french': 'Français',
  'settings.english': 'English',
} as const;

export type TextKey = keyof typeof fr;

const en: Partial<Record<TextKey, string>> = {
  'nav.dashboard': 'Dashboard',
  'nav.products': 'Products & prices',
  'nav.settings': 'Settings',
  'nav.logout': 'Sign out',
  'nav.logoutTitle': 'Sign out?',
  'nav.logoutBody': 'You will need to enter your credentials again to come back.',
  'nav.logoutConfirm': 'Sign out',
  'nav.adminSpace': 'Admin area',
  'nav.userSpace': 'User area',
  'nav.updatedTitle': '{n} quotation(s) updated after a catalogue addition',

  'common.loading': 'Loading…',
  'common.reference': 'Reference',
  'common.region': 'Region',
  'common.status': 'Status',
  'common.newQuotation': 'New quotation',
  'common.noQuotation': 'No quotations',

  'status.DRAFT': 'Draft',
  'status.PROCESSING': 'Processing',
  'status.AWAITING_SUPPLIER': 'Awaiting supplier',
  'status.PO': 'PO received',
  'status.REVIEW_REQUIRED': 'To review',
  'status.READY': 'Ready',
  'status.EXPORTED': 'Exported',
  'status.SENT': 'Sent',
  'status.CANCELLED': 'Archived',
  'status.DELETED': 'Deleted',

  'dashboard.title': 'Dashboard',
  'dashboard.today': 'Quotations today',
  'dashboard.inTotal': '{n} in total',
  'dashboard.toCheck': 'To check',
  'dashboard.linesToProcess': '{n} line(s) to process',
  'dashboard.poReceived': 'POs received',
  'dashboard.approved': 'Approved by the client',
  'dashboard.poValue': 'PO value',
  'dashboard.poTotal': 'Total of POs received',
  'dashboard.recent': 'Recent quotations',
  'dashboard.seeAll': 'View all quotations',
  'dashboard.seeAllCount': 'View all quotations ({n})',
  'dashboard.empty': 'Start by importing a client request.',

  'list.emptyFilter': 'No quotation matches this filter.',
  'list.filterAll': 'All',
  'list.trash': 'Trash',
  'list.emptyTrash': 'Empty trash',
  'list.purgeTitle': 'Empty the trash?',
  'list.purgeBody': '{n} quotation(s) will be permanently deleted, with their lines, files and sending history. This cannot be undone.',
  'list.purgeConfirm': 'Delete permanently',
  'list.purging': 'Deleting…',
  'list.purged': '{n} quotation(s) permanently deleted.',
  'common.cancel': 'Cancel',

  'settings.title': 'Settings',
  'settings.password': 'Password',
  'settings.passwordCurrent': 'Current password',
  'settings.passwordNew': 'New password',
  'settings.passwordMin': '8 characters minimum',
  'settings.passwordConfirm': 'Confirm new password',
  'settings.passwordSubmit': 'Update password',
  'settings.saving': 'Saving…',
  'settings.passwordMismatch': 'Passwords do not match.',
  'settings.passwordUpdated': 'Password updated.',
  'settings.appearance': 'Appearance',
  'settings.appearanceHint': 'The chosen theme is saved on your account and applies on all your devices.',
  'settings.light': 'Light',
  'settings.dark': 'Dark',
  'settings.language': 'Language',
  'settings.languageHint': 'The chosen language is saved on your account and applies on all your devices.',
};

export function t(key: TextKey, vars?: Record<string, string | number>): string {
  let text: string = (current === 'en' ? en[key] : undefined) ?? fr[key];
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replace(`{${k}}`, String(v));
  return text;
}

/** Fonction de traduction ; le composant se redessine au changement de langue. */
export function useT(): typeof t {
  useLanguage();
  return t;
}

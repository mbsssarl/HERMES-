import React from 'react';
import { useQuery } from 'convex/react';
import { api } from './convex';
import { applyAccent } from './accent';

export const DEFAULT_LOGO = '/logo-mbss.webp';
const DEFAULT_NAME = 'M.B.S.S Sarl';
const CACHE_KEY = 'branding';

export interface Branding {
  name: string;
  /** Logo à afficher (celui de l'entreprise, ou le logo par défaut). */
  logoUrl: string;
  /** Le nom a été personnalisé (sinon c'est le nom par défaut, avec sa signature). */
  customName: boolean;
  /** Couleur principale de l'entreprise (#rrggbb), ou null pour la couleur par défaut. */
  accentColor: string | null;
}

function readCache(): Branding | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Branding) : null;
  } catch {
    return null;
  }
}

/**
 * Nom et logo de l'entreprise (réglés dans Admin). La dernière valeur connue est gardée sur ce poste pour que la
 * page ne s'affiche pas d'abord avec les valeurs par défaut le temps du chargement.
 */
export function useBranding(): Branding {
  const data = useQuery(api.branding.get, {});
  const live = React.useMemo<Branding | null>(
    () => (data ? { name: data.name, logoUrl: data.logoUrl ?? DEFAULT_LOGO, customName: data.customName, accentColor: data.accentColor } : null),
    [data],
  );

  React.useEffect(() => {
    if (!live) return;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(live)); } catch { /* stockage indisponible */ }
    document.title = `${live.name} · Gestion des quotations`;
    applyAccent(live.accentColor);
  }, [live]);

  return live ?? readCache() ?? { name: DEFAULT_NAME, logoUrl: DEFAULT_LOGO, customName: false, accentColor: null };
}

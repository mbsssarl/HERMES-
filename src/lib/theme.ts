export type Theme = 'light' | 'dark';

const KEY = 'theme';

/** Applique le thème à toute l'interface (attribut `data-theme` sur <html>) et le garde en cache local. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch { /* stockage indisponible */ }
}

/** Thème mémorisé sur ce poste (utilisé avant la connexion, pour éviter un flash clair). */
export function storedTheme(): Theme {
  try { return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'; } catch { return 'light'; }
}

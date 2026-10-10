const KEY = 'accent';

export const DEFAULT_ACCENT = '#3b5bdb';

/** Teintes proposées ; n'importe quelle autre couleur peut être choisie avec le sélecteur. */
export const ACCENT_PRESETS: { id: string; label: string; hex: string }[] = [
  { id: 'indigo', label: 'Indigo', hex: DEFAULT_ACCENT },
  { id: 'blue', label: 'Bleu', hex: '#1c7ed6' },
  { id: 'teal', label: 'Turquoise', hex: '#0c8f7e' },
  { id: 'green', label: 'Vert', hex: '#2f9e44' },
  { id: 'violet', label: 'Violet', hex: '#7048e8' },
  { id: 'rose', label: 'Rose', hex: '#d6336c' },
  { id: 'orange', label: 'Orange', hex: '#d9480f' },
  { id: 'slate', label: 'Ardoise', hex: '#475a7e' },
];

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Les deux déclinaisons de la couleur principale (mode clair, mode sombre), luminosité bornée pour la lisibilité. */
export function accentVars(hex: string): { light: string; dark: string } {
  const [h, s, l] = hexToHsl(/^#[0-9a-fA-F]{6}$/.test(hex) ? hex : DEFAULT_ACCENT);
  const sat = clamp(s, 0.35, 0.95);
  return { light: hslToHex(h, sat, clamp(l, 0.34, 0.5)), dark: hslToHex(h, sat, clamp(l + 0.12, 0.6, 0.72)) };
}

/**
 * Applique la couleur principale : la teinte choisie est conservée, mais la luminosité est bornée pour que le texte
 * blanc des boutons et du menu reste lisible (version claire foncée en mode clair, plus claire en mode sombre).
 * Tout le reste (menu, dégradés, halos, étiquettes) est dérivé de ces deux variables dans la feuille de style.
 */
export function applyAccent(hex: string | null | undefined): void {
  const root = document.documentElement;
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex) || hex.toLowerCase() === DEFAULT_ACCENT) {
    root.style.removeProperty('--accent-light');
    root.style.removeProperty('--accent-dark');
    try { localStorage.removeItem(KEY); } catch { /* stockage indisponible */ }
    return;
  }
  const { light, dark } = accentVars(hex);
  root.style.setProperty('--accent-light', light);
  root.style.setProperty('--accent-dark', dark);
  try { localStorage.setItem(KEY, hex.toLowerCase()); } catch { /* stockage indisponible */ }
}

/** Couleur mémorisée sur ce poste (avant la connexion, pour éviter un flash de la couleur par défaut). */
export function storedAccent(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

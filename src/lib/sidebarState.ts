import React from 'react';

// MENU REPLIABLE (hamburger) : état partagé par le menu des utilisateurs (App.tsx) et celui du super admin (Platform.tsx).
//  - « collapsed » : sur ordinateur, le menu est réduit à une colonne d'icônes. Choix MÉMORISÉ sur l'appareil (localStorage),
//    rien n'est enregistré en base : chaque personne retrouve son choix sur son poste.
//  - « open »      : sur tablette et téléphone, le menu est un tiroir ouvert par-dessus le contenu. Jamais mémorisé :
//    il est fermé à chaque visite.

const KEY = 'hermes.menu.collapsed';
const DESKTOP = '(min-width: 1025px)';

const readCollapsed = (): boolean => {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; } // stockage indisponible : menu déplié
};
const writeCollapsed = (value: boolean) => {
  try { localStorage.setItem(KEY, value ? '1' : '0'); } catch { /* stockage indisponible : le choix ne sera pas gardé */ }
};

export interface SidebarState {
  collapsed: boolean;
  open: boolean;
  toggleCollapsed: () => void;
  openMenu: () => void;
  closeMenu: () => void;
  /** Classes à mettre sur le conteneur `.app` : le CSS en déduit l'affichage (colonne d'icônes ou tiroir). */
  shellClass: string;
}

export function useSidebar(): SidebarState {
  const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsed);
  const [open, setOpen] = React.useState(false);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((prev) => {
      writeCollapsed(!prev);
      return !prev;
    });
  }, []);
  const openMenu = React.useCallback(() => setOpen(true), []);
  const closeMenu = React.useCallback(() => setOpen(false), []);

  // Tiroir ouvert : la touche Échap le ferme.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Si l'écran s'agrandit (tablette tournée, fenêtre élargie), le tiroir n'a plus lieu d'être : on le ferme.
  React.useEffect(() => {
    const media = window.matchMedia(DESKTOP);
    const onChange = () => { if (media.matches) setOpen(false); };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const shellClass = `app${collapsed ? ' menu-collapsed' : ''}${open ? ' menu-open' : ''}`;
  return { collapsed, open, toggleCollapsed, openMenu, closeMenu, shellClass };
}

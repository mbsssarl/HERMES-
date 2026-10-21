import { Menu, X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { useBranding } from '../lib/branding';

// MENU REPLIABLE (hamburger) : petits composants partagés par le menu des utilisateurs (Sidebar.tsx) et celui du super admin
// (Platform.tsx), pour que les deux se comportent exactement pareil. L'affichage (colonne d'icônes, tiroir) est géré par le
// CSS (styles.css, section « Menu repliable ») à partir des classes posées par useSidebar (lib/sidebarState.ts).

/** Barre fine en haut de l'écran sur tablette et téléphone (cachée sur ordinateur) : hamburger + identité de l'entreprise. */
export function MenuBar({ open, onOpen }: { open: boolean; onOpen: () => void }) {
  const t = useT();
  const brand = useBranding();
  return (
    <header className="menu-bar">
      <button
        type="button"
        className="menu-btn"
        onClick={onOpen}
        aria-label={t('nav.openMenu')}
        aria-expanded={open}
        aria-controls="app-sidebar"
      >
        <Menu size={22} />
      </button>
      <img className="menu-bar-logo" src={brand.logoUrl} alt="" />
      <span className="menu-bar-name">{brand.name}</span>
    </header>
  );
}

/**
 * Boutons placés dans le menu : le hamburger qui replie / déplie la colonne d'icônes (ordinateur) et la croix qui ferme
 * le tiroir (tablette, téléphone). Le CSS n'en montre qu'un à la fois.
 */
export function SidebarToggles({
  collapsed,
  onToggleCollapsed,
  onClose,
}: {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const label = t(collapsed ? 'nav.expandMenu' : 'nav.collapseMenu');
  return (
    <>
      <button
        type="button"
        className="menu-btn sidebar-toggle"
        onClick={onToggleCollapsed}
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls="app-sidebar"
        title={label}
      >
        <Menu size={20} />
      </button>
      <button type="button" className="menu-btn sidebar-close" onClick={onClose} aria-label={t('nav.closeMenu')}>
        <X size={20} />
      </button>
    </>
  );
}

/** Fond sombre derrière le tiroir ouvert : un clic dessus le ferme. Invisible sur ordinateur. */
export function MenuBackdrop({ onClose }: { onClose: () => void }) {
  return <div className="menu-backdrop" onClick={onClose} aria-hidden="true" />;
}

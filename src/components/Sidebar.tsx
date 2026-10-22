import React from 'react';
import { FileText, Package, LayoutDashboard, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { AppUser } from '../types';
import { setLanguage, useT } from '../lib/i18n';
import { applyTheme } from '../lib/theme';
import { useBranding } from '../lib/branding';
import { Modal } from './ui';
import { MenuBackdrop, SidebarToggles } from './MenuBar';

export type View = 'dashboard' | 'quotations' | 'new' | 'detail' | 'products' | 'settings' | 'admin';

export function Sidebar({
  current,
  onNavigate,
  pendingCount,
  updatedCount,
  me,
  collapsed,
  onToggleCollapsed,
  onClose,
}: {
  current: View;
  onNavigate: (v: View) => void;
  pendingCount: number;
  /** Quotations mises à jour automatiquement (ajout au catalogue) et pas encore rouvertes par cet utilisateur. */
  updatedCount: number;
  me: AppUser;
  /** MENU REPLIABLE : menu réduit à une colonne d'icônes (ordinateur), replier / déplier, et fermeture du tiroir (tablette, téléphone). */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
}) {
  const { signOut } = useAuthActions();
  const t = useT();
  const brand = useBranding();
  const [confirmLogout, setConfirmLogout] = React.useState(false);
  const items: Array<{ id: View; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'dashboard', label: t('nav.dashboard'), icon: <LayoutDashboard size={18} /> },
    { id: 'quotations', label: t('nav.quotations'), icon: <FileText size={18} />, count: pendingCount },
    ...(me.role === 'admin' ? [{ id: 'products' as View, label: t('nav.products'), icon: <Package size={18} /> }] : []),
    { id: 'settings', label: t('nav.settings'), icon: <SettingsIcon size={18} /> },
    ...(me.role === 'admin' ? [{ id: 'admin' as View, label: t('nav.admin'), icon: <ShieldCheck size={18} /> }] : []),
  ];

  return (
    <>
    {/* Fond sombre du tiroir (tablette, téléphone) : un clic dessus ferme le menu */}
    <MenuBackdrop onClose={onClose} />
    <aside className="sidebar" id="app-sidebar">
      {/* En-tête : identité de l'entreprise + hamburger (replier / déplier) ou croix (fermer le tiroir) */}
      <div className="sidebar-head">
        <div className="brand">
          <div className="brand-logo">
            <img src={brand.logoUrl} alt={brand.name} />
          </div>
          <div className="brand-text">
            <div className="brand-name" title={brand.name}>{brand.name}</div>
            <div className="brand-sub">{me.role === 'admin' ? t('nav.adminSpace') : t('nav.userSpace')}</div>
          </div>
        </div>
        <SidebarToggles collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} onClose={onClose} />
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          className={`nav-item ${current === it.id ? 'active' : ''}`}
          // Le nom reste lisible au survol quand le menu est réduit à ses icônes ; le tiroir se ferme après le choix d'une page
          title={it.label}
          aria-label={it.label}
          onClick={() => { onNavigate(it.id); onClose(); }}
        >
          {it.icon}
          <span className="nav-label">{it.label}</span>
          {it.count !== undefined && it.count > 0 && <span className="count">{it.count}</span>}
          {it.id === 'quotations' && updatedCount > 0 && (
            <span className="nav-dot" title={t('nav.updatedTitle', { n: updatedCount })}>{updatedCount}</span>
          )}
        </button>
      ))}
      <div className="sidebar-foot">
        <div className="who">{me.email}</div>
        <button className="nav-item" title={t('nav.logout')} aria-label={t('nav.logout')} onClick={() => setConfirmLogout(true)}>
          <LogOut size={18} /> <span className="nav-label">{t('nav.logout')}</span>
        </button>
      </div>
    </aside>
    {confirmLogout && (
      <Modal
        title={t('nav.logoutTitle')}
        onClose={() => setConfirmLogout(false)}
        footer={<>
          <button className="btn" onClick={() => setConfirmLogout(false)}>{t('common.cancel')}</button>
          <button
            className="btn btn-primary"
            onClick={() => {
              applyTheme('light');
              setLanguage('fr');
              void signOut();
            }}
          >
            {t('nav.logoutConfirm')}
          </button>
        </>}
      >
        <p>{t('nav.logoutBody')}</p>
      </Modal>
    )}
    </>
  );
}

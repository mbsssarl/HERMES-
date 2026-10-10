import React from 'react';
import { FileText, Package, LayoutDashboard, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { AppUser } from '../types';
import { useT } from '../lib/i18n';
import { useBranding } from '../lib/branding';
import { Modal } from './ui';

export type View = 'dashboard' | 'quotations' | 'new' | 'detail' | 'products' | 'settings' | 'admin';

export function Sidebar({
  current,
  onNavigate,
  pendingCount,
  updatedCount,
  me,
}: {
  current: View;
  onNavigate: (v: View) => void;
  pendingCount: number;
  /** Quotations mises à jour automatiquement (ajout au catalogue) et pas encore rouvertes par cet utilisateur. */
  updatedCount: number;
  me: AppUser;
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
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <img src={brand.logoUrl} alt={brand.name} />
        </div>
        <div className="brand-text">
          <div className="brand-name" title={brand.name}>{brand.name}</div>
          <div className="brand-sub">{me.role === 'admin' ? t('nav.adminSpace') : t('nav.userSpace')}</div>
        </div>
      </div>
      {items.map((it) => (
        <button
          key={it.id}
          className={`nav-item ${current === it.id ? 'active' : ''}`}
          onClick={() => onNavigate(it.id)}
        >
          {it.icon}
          {it.label}
          {it.count !== undefined && it.count > 0 && <span className="count">{it.count}</span>}
          {it.id === 'quotations' && updatedCount > 0 && (
            <span className="nav-dot" title={t('nav.updatedTitle', { n: updatedCount })}>{updatedCount}</span>
          )}
        </button>
      ))}
      <div className="sidebar-foot">
        <div className="who">{me.email}</div>
        <button className="nav-item" onClick={() => setConfirmLogout(true)}>
          <LogOut size={18} /> {t('nav.logout')}
        </button>
      </div>
    </aside>
    {confirmLogout && (
      <Modal
        title={t('nav.logoutTitle')}
        onClose={() => setConfirmLogout(false)}
        footer={<>
          <button className="btn" onClick={() => setConfirmLogout(false)}>{t('common.cancel')}</button>
          <button className="btn btn-primary" onClick={() => void signOut()}>{t('nav.logoutConfirm')}</button>
        </>}
      >
        <p>{t('nav.logoutBody')}</p>
      </Modal>
    )}
    </>
  );
}

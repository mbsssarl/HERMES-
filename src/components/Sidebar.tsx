import React from 'react';
import { FileText, Package, LayoutDashboard, LogOut, Settings as SettingsIcon, ShieldCheck } from 'lucide-react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { AppUser } from '../types';

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
  const items: Array<{ id: View; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard size={18} /> },
    { id: 'quotations', label: 'Quotations', icon: <FileText size={18} />, count: pendingCount },
    ...(me.role === 'admin' ? [{ id: 'products' as View, label: 'Produits & prix', icon: <Package size={18} /> }] : []),
    { id: 'settings', label: 'Réglages', icon: <SettingsIcon size={18} /> },
    ...(me.role === 'admin' ? [{ id: 'admin' as View, label: 'Admin', icon: <ShieldCheck size={18} /> }] : []),
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <img src="/logo-mbss.webp" alt="M.B.S.S Sarl" />
        </div>
        <div className="brand-name">MBSS ERP</div>
        <div className="brand-sub">{me.role === 'admin' ? 'Espace admin' : 'Espace utilisateur'}</div>
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
            <span className="nav-dot" title={`${updatedCount} quotation(s) mise(s) à jour suite à un ajout au catalogue`}>{updatedCount}</span>
          )}
        </button>
      ))}
      <div className="sidebar-foot">
        <div className="who">{me.email}</div>
        <button className="nav-item" onClick={() => void signOut()}>
          <LogOut size={18} /> Déconnexion
        </button>
      </div>
    </aside>
  );
}

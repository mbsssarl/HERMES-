import React from 'react';
import { FileText, Package, Globe, LayoutDashboard, Upload, LogOut } from 'lucide-react';
import { useAuthActions } from '@convex-dev/auth/react';
import type { AppUser } from '../types';

export type View = 'dashboard' | 'quotations' | 'new' | 'detail' | 'products' | 'countries';

export function Sidebar({
  current,
  onNavigate,
  pendingCount,
  me,
}: {
  current: View;
  onNavigate: (v: View) => void;
  pendingCount: number;
  me: AppUser;
}) {
  const { signOut } = useAuthActions();
  const items: Array<{ id: View; label: string; icon: React.ReactNode; count?: number }> = [
    { id: 'dashboard', label: 'Tableau de bord', icon: <LayoutDashboard size={18} /> },
    { id: 'quotations', label: 'Quotations', icon: <FileText size={18} />, count: pendingCount },
    { id: 'new', label: 'Nouvelle quotation', icon: <Upload size={18} /> },
    { id: 'products', label: 'Produits & prix', icon: <Package size={18} /> },
    { id: 'countries', label: 'Pays', icon: <Globe size={18} /> },
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

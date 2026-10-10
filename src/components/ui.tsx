import React from 'react';

export function Badge({ label, color, dot = true }: { label: string; color: string; dot?: boolean }) {
  return (
    <span className="badge" style={{ background: color }}>
      {dot && <span className="dot" />}
      {label}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  /** Boutons affichés à droite du titre, avant la croix. */
  actions?: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {actions}
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Fermer">✕</button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Bloc gris animé qui tient la place d'un contenu en cours de chargement. */
export function Skeleton({ w, h = 14, r, style }: { w?: number | string; h?: number | string; r?: number | string; style?: React.CSSProperties }) {
  return <span className="skeleton" style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} />;
}

/** Tableau fantôme : en-tête et lignes de largeurs variées, pour ne pas faire un effet de grille régulière. */
export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  const widths = ['28%', '62%', '40%', '52%', '34%', '46%'];
  return (
    <div className="skeleton-table" aria-hidden>
      <div className="skeleton-row head">
        {Array.from({ length: cols }, (_, c) => <Skeleton key={c} h={10} w="45%" />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div className="skeleton-row" key={r}>
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} w={widths[(r * 2 + c * 3) % widths.length]} />)}
        </div>
      ))}
    </div>
  );
}

/** Page fantôme : titre, trois cartes de chiffres, puis un tableau. */
export function PageSkeleton() {
  return (
    <div aria-hidden>
      <div style={{ marginBottom: 32 }}>
        <Skeleton w={260} h={30} r={10} />
        <Skeleton w={380} h={14} style={{ marginTop: 14 }} />
      </div>
      <div className="stats-grid">
        {[0, 1, 2, 3].map((k) => (
          <div className="stat-card" key={k}>
            <Skeleton w="50%" h={12} />
            <Skeleton w="65%" h={30} r={10} style={{ margin: '6px 0 2px' }} />
            <Skeleton w="35%" h={10} />
          </div>
        ))}
      </div>
      <div className="card"><TableSkeleton rows={6} cols={5} /></div>
    </div>
  );
}

/** Application complète fantôme (menu + page), affichée pendant la connexion et le chargement du profil. */
export function AppSkeleton() {
  return (
    <div className="app" role="status" aria-label="Chargement">
      <aside className="sidebar" aria-hidden>
        <div className="brand">
          <Skeleton w={46} h={46} r={14} />
          <div style={{ flex: 1 }}><Skeleton w="70%" h={14} /><Skeleton w="45%" h={10} style={{ marginTop: 8 }} /></div>
        </div>
        {[0, 1, 2, 3].map((k) => <div key={k} style={{ padding: '12px 14px' }}><Skeleton w={`${60 + (k % 3) * 12}%`} h={14} /></div>)}
      </aside>
      <main className="main"><PageSkeleton /></main>
    </div>
  );
}

export function StateBox({
  loading,
  title,
  subtitle,
  variant = 'page',
}: {
  loading?: boolean;
  title: string;
  subtitle?: string;
  /** Forme du squelette affiché pendant le chargement : page entière, tableau seul, ou application complète. */
  variant?: 'page' | 'table' | 'app';
}) {
  if (loading) {
    if (variant === 'app') return <AppSkeleton />;
    return (
      <div role="status" aria-label={title}>
        {variant === 'table' ? <TableSkeleton /> : <PageSkeleton />}
        {subtitle && <p className="text-muted" style={{ textAlign: 'center', fontSize: 13, padding: '12px 24px 20px' }}>{subtitle}</p>}
      </div>
    );
  }
  return (
    <div className="state-box">
      <h3>{title}</h3>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

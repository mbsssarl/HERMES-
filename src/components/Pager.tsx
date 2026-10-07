import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE = 100;

/**
 * Pagination d'affichage côté écran : dessiner des milliers de lignes éditables d'un coup rend la page
 * lente. Les données restent toutes chargées (recherche, filtres, sélection globale inchangés) ; seul le
 * nombre de lignes dessinées est borné. Revient à la page 1 quand `resetKey` change (filtre, recherche...).
 */
export function usePage<T>(items: T[], resetKey: string, pageSize = PAGE_SIZE) {
  const [page, setPage] = React.useState(0);
  React.useEffect(() => { setPage(0); }, [resetKey]);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages - 1);
  const slice = React.useMemo(() => items.slice(current * pageSize, (current + 1) * pageSize), [items, current, pageSize]);
  return { slice, offset: current * pageSize, page: current, pages, setPage, total: items.length, pageSize };
}

export function Pager({ page, pages, total, pageSize, setPage }: { page: number; pages: number; total: number; pageSize: number; setPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="card-pad" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderTop: '1px solid var(--color-border)', fontSize: 13 }}>
      <span className="text-muted">{from}-{to} sur {total} lignes</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="btn btn-sm" onClick={() => setPage(page - 1)} disabled={page === 0} aria-label="Page précédente"><ChevronLeft size={14} /></button>
        <span>Page {page + 1} / {pages}</span>
        <button className="btn btn-sm" onClick={() => setPage(page + 1)} disabled={page >= pages - 1} aria-label="Page suivante"><ChevronRight size={14} /></button>
      </div>
    </div>
  );
}

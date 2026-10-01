import { RefreshCw } from 'lucide-react';
import type { QuotationWithRelations } from '../types';
import { formatDate } from '../lib/format';

/** Badge « mise à jour » : la quotation a été rematchée après un ajout au catalogue et n'a pas été rouverte depuis. */
export function UpdateBadge({ update }: { update: QuotationWithRelations['catalog_update'] }) {
  if (!update) return null;
  const when = formatDate(new Date(update.at).toISOString());
  const title = `${update.lines} ligne(s) reconnue(s) ou chiffrée(s) suite à un ajout au catalogue${update.by ? ` par ${update.by}` : ''}, le ${when}`;
  return (
    <span className="tag tag-update" title={title} style={{ marginLeft: 8 }}>
      <RefreshCw size={12} /> Mise à jour · {update.lines}
    </span>
  );
}

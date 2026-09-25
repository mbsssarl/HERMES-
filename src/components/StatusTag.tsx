import { Archive, CheckCircle2, Trash2, CircleDashed, Eye, Hourglass, Loader, Send, type LucideIcon } from 'lucide-react';
import type { QuotationStatus } from '../types';
import { STATUS_LABELS } from '../lib/format';

const STATUS_STYLE: Record<QuotationStatus, { cls: string; icon: LucideIcon }> = {
  DRAFT: { cls: 'tag-same', icon: CircleDashed },
  PROCESSING: { cls: 'tag-update', icon: Loader },
  AWAITING_SUPPLIER: { cls: 'tag-warn', icon: Hourglass },
  PO: { cls: 'tag-new', icon: CheckCircle2 },
  REVIEW_REQUIRED: { cls: 'tag-warn', icon: Eye },
  READY: { cls: 'tag-new', icon: CheckCircle2 },
  EXPORTED: { cls: 'tag-new', icon: CheckCircle2 },
  SENT: { cls: 'tag-update', icon: Send },
  CANCELLED: { cls: 'tag-same', icon: Archive },
  DELETED: { cls: 'tag-error', icon: Trash2 },
};

/** Statut d'une quotation, dans le même style discret que les autres étiquettes (icône + fine bordure). */
export function StatusTag({ status }: { status: QuotationStatus }) {
  const { cls, icon: Icon } = STATUS_STYLE[status];
  return (
    <span className={`tag ${cls}`}>
      <Icon size={13} /> {STATUS_LABELS[status]}
    </span>
  );
}

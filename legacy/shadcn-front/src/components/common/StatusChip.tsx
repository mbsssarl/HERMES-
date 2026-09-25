import { Badge, type badgeVariants } from "@/components/ui/badge";
import type { VariantProps } from "class-variance-authority";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const ORDER_STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  draft: { label: "Brouillon", variant: "outline" },
  processing: { label: "En traitement", variant: "secondary" },
  awaiting_supplier: { label: "Attente fournisseur", variant: "warning" },
  completed: { label: "Terminé", variant: "success" },
  sent: { label: "Envoyée", variant: "default" },
  archived: { label: "Archivée", variant: "outline" },
};

const MATCH_STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  matched_impa: { label: "Matché (IMPA)", variant: "success" },
  matched_name: { label: "Matché (nom)", variant: "secondary" },
  manual: { label: "Matché (manuel)", variant: "secondary" },
  ambiguous: { label: "À confirmer", variant: "warning" },
  unmatched: { label: "Non répertorié", variant: "destructive" },
};

export function OrderStatusChip({ status }: { status: string }) {
  const config = ORDER_STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

export function MatchStatusChip({ status }: { status: string }) {
  const config = MATCH_STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}

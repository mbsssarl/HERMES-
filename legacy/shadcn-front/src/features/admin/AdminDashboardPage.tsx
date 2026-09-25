import { useQuery } from "convex/react";
import { Banknote, Receipt, Send, Users } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { PageHeader } from "@/components/common/PageHeader";
import { StatCard } from "@/components/common/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  processing: "En traitement",
  awaiting_supplier: "Attente fournisseur",
  completed: "Terminé",
  sent: "Envoyée",
  archived: "Archivée",
};

export function AdminDashboardPage() {
  const stats = useQuery(api.admin.getDashboardStats, {});

  if (stats === undefined) return <FullPageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader title="Tableau de bord" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Utilisateurs actifs" value={`${stats.users.active} / ${stats.users.total}`} icon={Users} color="info" />
        <StatCard label="Commandes totales" value={stats.orders.total} icon={Receipt} color="primary" />
        <StatCard label="Commandes envoyées" value={stats.orders.byStatus.sent ?? 0} icon={Send} color="success" />
        <StatCard label="Chiffre d'affaires (envoyées)" value={stats.totalRevenue.toFixed(2)} icon={Banknote} color="warning" />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Commandes par statut</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(stats.orders.byStatus).map(([status, count]) => (
              <div key={status} className="flex justify-between text-sm">
                <span>{STATUS_LABELS[status] ?? status}</span>
                <span className="font-semibold">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Activité récente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.recentActivity.map((log) => (
              <div key={log._id} className="flex justify-between text-sm">
                <span>{log.action}</span>
                <span className="text-muted-foreground text-xs">{new Date(log.createdAt).toLocaleString("fr-FR")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

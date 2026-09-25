import { useQuery } from "convex/react";
import { Plus, Receipt, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "../../../convex/_generated/api";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { OrderStatusChip } from "@/components/common/StatusChip";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NewOrderDialog } from "./NewOrderDialog";

const STATUS_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  { value: "draft", label: "Brouillon" },
  { value: "processing", label: "En traitement" },
  { value: "awaiting_supplier", label: "Attente fournisseur" },
  { value: "completed", label: "Terminé" },
  { value: "sent", label: "Envoyée" },
  { value: "archived", label: "Archivée" },
];

export function OrdersListPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const orders = useQuery(api.orders.list, {
    search: search || undefined,
    status: (status === "all" ? undefined : status) as never,
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Commandes"
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> Nouvelle commande
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative sm:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input
            placeholder="Rechercher une référence..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-52">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card className="py-0">
        {orders === undefined ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<Receipt />}
            title="Aucune commande"
            description="Créez une nouvelle commande pour commencer à traiter un document client."
            action={
              <Button onClick={() => setDialogOpen(true)}>
                <Plus /> Nouvelle commande
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Référence</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>N° client</TableHead>
                <TableHead>Pays</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead>Créée le</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow
                  key={order._id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/orders/${order._id}`)}
                >
                  <TableCell className="font-semibold">{order.reference}</TableCell>
                  <TableCell>{order.client?.name ?? "—"}</TableCell>
                  <TableCell>{order.clientOrderNumber ?? "—"}</TableCell>
                  <TableCell>{order.country?.name ?? "—"}</TableCell>
                  <TableCell>
                    <OrderStatusChip status={order.status} />
                  </TableCell>
                  <TableCell>{new Date(order.createdAt).toLocaleDateString("fr-FR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <NewOrderDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}

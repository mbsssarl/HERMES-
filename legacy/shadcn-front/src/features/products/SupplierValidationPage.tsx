import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Save } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { LoadingButton } from "@/components/common/LoadingButton";
import { PageHeader } from "@/components/common/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SupplierValidationPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const id = orderId as Id<"orders">;

  const supplierItems = useQuery(api.supplierItems.listByOrder, { orderId: id });
  const updateItem = useMutation(api.supplierItems.update);
  const rejectItem = useMutation(api.supplierItems.reject);
  const saveToCatalog = useMutation(api.supplierItems.saveToCatalog);

  const [selected, setSelected] = useState<Set<Id<"supplierItems">>>(new Set());
  const [saving, setSaving] = useState(false);

  if (supplierItems === undefined) return <FullPageLoader />;

  const pending = supplierItems.filter((i) => i.status === "pending_validation");
  const others = supplierItems.filter((i) => i.status !== "pending_validation");

  function toggleSelected(itemId: Id<"supplierItems">) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) return;
    setSaving(true);
    try {
      await saveToCatalog({ supplierItemIds: Array.from(selected) });
      toast.success("Produits enregistrés dans le catalogue.");
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/orders/${id}`)} className="-ml-2">
        <ArrowLeft /> Retour à la commande
      </Button>

      <PageHeader
        title="Validation du fichier fournisseur"
        action={
          <LoadingButton disabled={selected.size === 0} loading={saving} onClick={() => void handleSave()}>
            <Save /> Enregistrer dans le catalogue ({selected.size})
          </LoadingButton>
        }
      />

      <Card className="py-0">
        {pending.length === 0 ? (
          <EmptyState title="Aucune ligne en attente de validation" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Code</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead>Prix</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((item) => (
                <TableRow key={item._id}>
                  <TableCell>
                    <Checkbox checked={selected.has(item._id)} onCheckedChange={() => toggleSelected(item._id)} />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={item.rawCode ?? ""}
                      onBlur={(e) => void updateItem({ supplierItemId: item._id, rawCode: e.target.value || undefined })}
                      className="h-8 w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={item.rawName}
                      onBlur={(e) => void updateItem({ supplierItemId: item._id, rawName: e.target.value })}
                      className="h-8 w-40"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={item.rawDescription ?? ""}
                      onBlur={(e) =>
                        void updateItem({ supplierItemId: item._id, rawDescription: e.target.value || undefined })
                      }
                      className="h-8 w-48"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      defaultValue={item.rawUnit ?? ""}
                      onBlur={(e) => void updateItem({ supplierItemId: item._id, rawUnit: e.target.value || undefined })}
                      className="h-8 w-20"
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      defaultValue={item.rawPrice ?? ""}
                      onBlur={(e) =>
                        void updateItem({
                          supplierItemId: item._id,
                          rawPrice: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      className="h-8 w-24"
                    />
                  </TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => void rejectItem({ supplierItemId: item._id })}>
                      Rejeter
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {others.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Autres lignes ({others.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {others.map((item) => (
              <div key={item._id} className="flex items-center justify-between">
                <span className="text-sm">{item.rawName}</span>
                <Badge variant={item.status === "validated" ? "success" : item.status === "duplicate" ? "warning" : "outline"}>
                  {item.status === "duplicate" ? "Doublon détecté" : item.status === "validated" ? "Validé" : "Rejeté"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

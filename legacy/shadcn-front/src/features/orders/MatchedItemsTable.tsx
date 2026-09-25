import { useMutation } from "convex/react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { MatchStatusChip } from "@/components/common/StatusChip";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type ItemWithProduct = Doc<"orderItems"> & { product: Doc<"products"> | null };

export function MatchedItemsTable({ items, currency }: { items: ItemWithProduct[]; currency: string }) {
  const updateItem = useMutation(api.orderItems.update);

  async function handleUpdate(
    orderItemId: Id<"orderItems">,
    patch: { quotedQuantity?: number; lineDiscountPercent?: number },
  ) {
    try {
      await updateItem({ orderItemId, ...patch });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  return (
    <Card className="py-0">
      <CardHeader className="border-b py-4">
        <CardTitle>Articles répertoriés ({items.length})</CardTitle>
      </CardHeader>
      {items.length === 0 ? (
        <EmptyState icon={<PackageCheck />} title="Aucun article répertorié pour l'instant" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead className="text-right">Qté</TableHead>
              <TableHead className="text-right">Prix unit.</TableHead>
              <TableHead className="text-right">Remise %</TableHead>
              <TableHead className="text-right">Prix final</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead>Statut</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item._id}>
                <TableCell>{item.lineNo}</TableCell>
                <TableCell>{item.rawCode ?? item.product?.impaId ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate">{item.rawDescription}</TableCell>
                <TableCell>{item.rawUnit ?? item.product?.unit ?? "—"}</TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    defaultValue={item.quotedQuantity ?? item.rawQuantity ?? 1}
                    onBlur={(e) => void handleUpdate(item._id, { quotedQuantity: Number(e.target.value) })}
                    className="h-8 w-20 text-right"
                  />
                </TableCell>
                <TableCell className="text-right">
                  {item.unitPriceOriginal !== undefined ? (
                    `${item.priceAfterQuotation?.toFixed(2)} ${currency}`
                  ) : (
                    <Badge variant="warning">Prix manquant</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Input
                    type="number"
                    defaultValue={item.lineDiscountPercent ?? 0}
                    onBlur={(e) => void handleUpdate(item._id, { lineDiscountPercent: Number(e.target.value) })}
                    className="h-8 w-16 text-right"
                  />
                </TableCell>
                <TableCell className="text-right">
                  {item.finalUnitPrice !== undefined ? `${item.finalUnitPrice.toFixed(2)} ${currency}` : "—"}
                </TableCell>
                <TableCell className="text-right font-semibold">
                  {item.total !== undefined ? `${item.total.toFixed(2)} ${currency}` : "—"}
                </TableCell>
                <TableCell>
                  <MatchStatusChip status={item.matchStatus} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

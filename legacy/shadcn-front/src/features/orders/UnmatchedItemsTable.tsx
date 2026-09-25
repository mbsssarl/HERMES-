import { useAction, useQuery } from "convex/react";
import { Download, PackageSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingButton } from "@/components/common/LoadingButton";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function UnmatchedItemsTable({ orderId, items }: { orderId: Id<"orders">; items: Doc<"orderItems">[] }) {
  const generateSupplierTemplate = useAction(api.extraction.generateSupplierTemplate);
  const files = useQuery(api.files.listByOrder, { orderId });
  const [generating, setGenerating] = useState(false);

  async function handleGenerateTemplate() {
    setGenerating(true);
    try {
      await generateSupplierTemplate({ orderId });
      toast.success("Template fournisseur généré.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la génération.");
    } finally {
      setGenerating(false);
    }
  }

  const latestTemplate = files
    ?.filter((f) => f.kind === "generated_supplier_template")
    .sort((a, b) => b.uploadedAt - a.uploadedAt)[0];

  return (
    <Card className="py-0">
      <CardHeader className="flex-row items-center justify-between border-b py-4">
        <CardTitle>Articles non répertoriés ({items.length})</CardTitle>
        {items.length > 0 && (
          <LoadingButton variant="outline" size="sm" loading={generating} onClick={() => void handleGenerateTemplate()}>
            <Download /> Générer template fournisseur
          </LoadingButton>
        )}
      </CardHeader>
      {latestTemplate && (
        <p className="text-muted-foreground -mt-2 px-6 text-xs">
          Dernier template généré : {latestTemplate.fileName} le {new Date(latestTemplate.uploadedAt).toLocaleString("fr-FR")}
        </p>
      )}
      {items.length === 0 ? (
        <EmptyState icon={<PackageSearch />} title="Aucun article non répertorié" description="Tous les articles ont été identifiés." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Qté</TableHead>
              <TableHead>Unité</TableHead>
              <TableHead>Origine</TableHead>
              <TableHead>Notes demande</TableHead>
              <TableHead>Notes enquête</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item._id}>
                <TableCell>{item.lineNo}</TableCell>
                <TableCell>{item.rawCode ?? "—"}</TableCell>
                <TableCell className="max-w-64 truncate">{item.rawDescription}</TableCell>
                <TableCell>{item.rawQuantity ?? "—"}</TableCell>
                <TableCell>{item.rawUnit ?? "—"}</TableCell>
                <TableCell>{item.rawOrigin ?? "—"}</TableCell>
                <TableCell>{item.reqNotes ?? "—"}</TableCell>
                <TableCell>{item.enqNotes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

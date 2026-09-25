import { useQuery } from "convex/react";
import { CircleDollarSign, Package, Plus, Search } from "lucide-react";
import { useState } from "react";

import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { ProductCreateDialog } from "./ProductCreateDialog";
import { ProductPricesDialog } from "./ProductPricesDialog";

export function ProductsListPage() {
  const user = useCurrentUser();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pricesDialogProduct, setPricesDialogProduct] = useState<Doc<"products"> | null>(null);
  const products = useQuery(api.products.list, { search: search || undefined });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalogue produits"
        action={
          user?.role === "admin" && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus /> Nouveau produit
            </Button>
          )
        }
      />

      <div className="relative sm:w-80">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input
          placeholder="Rechercher par nom, IMPA, code..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8"
        />
      </div>

      <Card className="py-0">
        {products === undefined ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : products.length === 0 ? (
          <EmptyState icon={<Package />} title="Aucun produit" description="Le catalogue est vide ou aucun résultat ne correspond." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>IMPA</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead>Unité</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Prix</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((product) => (
                <TableRow key={product._id}>
                  <TableCell>{product.impaId ?? "—"}</TableCell>
                  <TableCell>{product.code ?? "—"}</TableCell>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>{product.unit}</TableCell>
                  <TableCell>{product.source === "manual" ? "Manuel" : "Import fournisseur"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => setPricesDialogProduct(product)} title="Prix par pays">
                      <CircleDollarSign className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ProductCreateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      {pricesDialogProduct && (
        <ProductPricesDialog product={pricesDialogProduct} open onClose={() => setPricesDialogProduct(null)} />
      )}
    </div>
  );
}

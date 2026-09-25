import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingButton } from "@/components/common/LoadingButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

function PriceRow({
  productId,
  price,
}: {
  productId: Id<"products">;
  price: Doc<"productPrices"> & { country: Doc<"countries"> | null };
}) {
  const setPrice = useMutation(api.productPrices.setPrice);

  return (
    <div className="flex items-center gap-3">
      <span className="w-32 truncate text-sm font-medium">{price.country?.name ?? "—"}</span>
      <Input
        type="number"
        defaultValue={price.price}
        className="h-8 w-28"
        onBlur={(e) => {
          const value = Number(e.target.value);
          if (value !== price.price && price.country) {
            void setPrice({
              productId,
              countryId: price.countryId,
              price: value,
              currency: price.country.currency,
            }).then(() => toast.success("Prix mis à jour."));
          }
        }}
      />
      <span className="text-muted-foreground text-xs">{price.currency}</span>
    </div>
  );
}

function AddPriceForm({
  productId,
  existingCountryIds,
}: {
  productId: Id<"products">;
  existingCountryIds: Id<"countries">[];
}) {
  const countries = useQuery(api.countries.list, { activeOnly: true });
  const setPrice = useMutation(api.productPrices.setPrice);

  const [countryId, setCountryId] = useState("");
  const [price, setPriceValue] = useState("");
  const [loading, setLoading] = useState(false);

  const availableCountries = (countries ?? []).filter((c) => !existingCountryIds.includes(c._id));

  async function handleAdd() {
    const selected = availableCountries.find((c) => c._id === countryId);
    if (!selected || !price) return;
    setLoading(true);
    try {
      await setPrice({ productId, countryId: selected._id, price: Number(price), currency: selected.currency });
      toast.success("Prix ajouté.");
      setCountryId("");
      setPriceValue("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  if (availableCountries.length === 0) return null;

  return (
    <div className="mt-3 flex items-center gap-2 border-t pt-3">
      <Select value={countryId} onValueChange={setCountryId}>
        <SelectTrigger className="h-8 w-44">
          <SelectValue placeholder="Nouveau pays" />
        </SelectTrigger>
        <SelectContent>
          {availableCountries.map((c) => (
            <SelectItem key={c._id} value={c._id}>
              {c.name} ({c.currency})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        placeholder="Prix"
        value={price}
        onChange={(e) => setPriceValue(e.target.value)}
        className="h-8 w-24"
      />
      <LoadingButton size="sm" variant="outline" loading={loading} disabled={!countryId || !price} onClick={() => void handleAdd()}>
        <Plus /> Ajouter
      </LoadingButton>
    </div>
  );
}

export function ProductPricesDialog({
  product,
  open,
  onClose,
}: {
  product: Doc<"products">;
  open: boolean;
  onClose: () => void;
}) {
  const prices = useQuery(api.productPrices.listForProduct, open ? { productId: product._id } : "skip");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Prix par pays — {product.name}</DialogTitle>
        </DialogHeader>

        {prices === undefined ? null : prices.length === 0 ? (
          <EmptyState title="Aucun prix défini" description="Ajoutez un prix pour au moins un pays." />
        ) : (
          <div className="space-y-3">
            {prices.map((p) => (
              <PriceRow key={p._id} productId={product._id} price={p} />
            ))}
          </div>
        )}
        <AddPriceForm productId={product._id} existingCountryIds={(prices ?? []).map((p) => p.countryId)} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Fermer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

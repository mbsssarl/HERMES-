import { useMutation } from "convex/react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ProductCreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (productId: Id<"products">) => void;
}) {
  const createProduct = useMutation(api.products.createManual);
  const [form, setForm] = useState({ impaId: "", code: "", name: "", description: "", unit: "", category: "" });
  const [loading, setLoading] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    if (!form.name.trim() || !form.unit.trim()) return;
    setLoading(true);
    try {
      const productId = await createProduct({
        impaId: form.impaId.trim() || undefined,
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        unit: form.unit.trim(),
        category: form.category.trim() || undefined,
      });
      toast.success("Produit créé — ajoutez maintenant son prix par pays.");
      onClose();
      onCreated?.(productId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nouveau produit</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="impaId">IMPA / ID</Label>
              <Input id="impaId" value={form.impaId} onChange={(e) => set("impaId", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code interne</Label>
              <Input id="code" value={form.code} onChange={(e) => set("code", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Nom</Label>
            <Input id="name" value={form.name} onChange={(e) => set("name", e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea id="description" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="unit">Unité</Label>
              <Input id="unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="category">Catégorie</Label>
              <Input id="category" value={form.category} onChange={(e) => set("category", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <LoadingButton loading={loading} onClick={() => void handleSubmit()}>
            Créer
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

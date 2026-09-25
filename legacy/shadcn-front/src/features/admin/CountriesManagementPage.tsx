import { useMutation, useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { FullPageLoader } from "@/components/common/FullPageLoader";
import { LoadingButton } from "@/components/common/LoadingButton";
import { PageHeader } from "@/components/common/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function CountriesManagementPage() {
  const countries = useQuery(api.countries.list, {});
  const createCountry = useMutation(api.countries.create);
  const updateCountry = useMutation(api.countries.update);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", currency: "" });
  const [loading, setLoading] = useState(false);

  async function handleCreate() {
    if (!form.code.trim() || !form.name.trim() || !form.currency.trim()) return;
    setLoading(true);
    try {
      await createCountry({
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        currency: form.currency.trim().toUpperCase(),
      });
      toast.success("Pays créé.");
      setDialogOpen(false);
      setForm({ code: "", name: "", currency: "" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(countryId: Id<"countries">, active: boolean) {
    try {
      await updateCountry({ countryId, active: !active });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur.");
    }
  }

  if (countries === undefined) return <FullPageLoader />;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pays de livraison"
        description="Le prix des produits dépend du pays de livraison choisi à la création de chaque commande. Chaque pays porte sa propre devise."
        action={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus /> Nouveau pays
          </Button>
        }
      />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Nom</TableHead>
              <TableHead>Devise</TableHead>
              <TableHead className="text-right">Actif</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {countries.map((c) => (
              <TableRow key={c._id}>
                <TableCell>{c.code}</TableCell>
                <TableCell>{c.name}</TableCell>
                <TableCell>{c.currency}</TableCell>
                <TableCell className="text-right">
                  <Switch checked={c.active} onCheckedChange={() => void handleToggle(c._id, c.active)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Nouveau pays</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="country-code">Code</Label>
              <Input
                id="country-code"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                autoFocus
              />
              <p className="text-muted-foreground text-xs">Ex: CM, CI</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country-name">Nom</Label>
              <Input id="country-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="country-currency">Devise</Label>
              <Input
                id="country-currency"
                value={form.currency}
                onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value }))}
              />
              <p className="text-muted-foreground text-xs">Ex: XAF, EUR</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annuler
            </Button>
            <LoadingButton loading={loading} onClick={() => void handleCreate()}>
              Créer
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

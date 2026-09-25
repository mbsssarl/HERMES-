import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, FileSpreadsheet, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Combobox } from "@/components/common/Combobox";
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

type Step = "info" | "file";

export function NewOrderDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clients = useQuery(api.clients.list, open ? {} : "skip");
  const countries = useQuery(api.countries.list, open ? { activeOnly: true } : "skip");
  const createClient = useMutation(api.clients.create);
  const createOrder = useMutation(api.orders.create);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUploadedFile = useMutation(api.files.registerUploadedFile);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("info");
  const [selectedClientId, setSelectedClientId] = useState<Id<"clients"> | null>(null);
  const [newClientName, setNewClientName] = useState("");
  const [creatingNewClient, setCreatingNewClient] = useState(false);
  const [countryId, setCountryId] = useState<Id<"countries"> | null>(null);
  const [processing, setProcessing] = useState(false);

  function reset() {
    setStep("info");
    setSelectedClientId(null);
    setNewClientName("");
    setCreatingNewClient(false);
    setCountryId(null);
    setProcessing(false);
  }

  function handleClose() {
    if (processing) return; // don't let the dialog close mid-creation
    reset();
    onClose();
  }

  function handleClientChange(clientId: string | null) {
    setSelectedClientId(clientId as Id<"clients"> | null);
    const client = clients?.find((c) => c._id === clientId);
    if (client?.countryId) setCountryId(client.countryId);
  }

  const canContinue =
    (creatingNewClient ? newClientName.trim().length > 0 : selectedClientId !== null) && countryId !== null;

  // Creating the order and importing the file is a single action from the
  // user's point of view: picking a document IS what creates the order —
  // there is no separate "create" button on this step.
  async function handleFileSelected(file: File) {
    if (!countryId) return;
    setProcessing(true);
    try {
      let clientId = selectedClientId;
      if (creatingNewClient) {
        clientId = await createClient({ name: newClientName.trim(), countryId });
      }
      if (!clientId) return;

      const orderId = await createOrder({ clientId, countryId });

      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };

      await registerUploadedFile({
        orderId,
        storageId,
        kind: "client_request",
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });

      toast.success("Commande créée, analyse du document en cours...");
      reset();
      onClose();
      navigate(`/orders/${orderId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la création.");
      setProcessing(false);
    }
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void handleFileSelected(file);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nouvelle commande</DialogTitle>
        </DialogHeader>

        {step === "info" ? (
          <>
            <div className="space-y-4">
              {!creatingNewClient ? (
                <div className="space-y-1.5">
                  <Label>Client</Label>
                  <Combobox
                    options={(clients ?? []).map((c) => ({ value: c._id, label: c.name }))}
                    value={selectedClientId}
                    onChange={handleClientChange}
                    loading={clients === undefined}
                    placeholder="Choisir un client"
                    searchPlaceholder="Rechercher un client..."
                  />
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setCreatingNewClient(true)}
                  >
                    + Nouveau client
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="new-client-name">Nom du nouveau client</Label>
                  <Input
                    id="new-client-name"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    autoFocus
                  />
                  <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="h-auto p-0"
                    onClick={() => setCreatingNewClient(false)}
                  >
                    Choisir un client existant
                  </Button>
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Pays de livraison</Label>
                <Combobox
                  options={(countries ?? []).map((c) => ({ value: c._id, label: `${c.name} (${c.currency})` }))}
                  value={countryId}
                  onChange={(v) => setCountryId(v as Id<"countries"> | null)}
                  loading={countries === undefined}
                  placeholder="Choisir un pays"
                  searchPlaceholder="Rechercher un pays..."
                />
                <p className="text-muted-foreground text-xs">
                  Détermine les prix affichés — le navire, le port et la référence seront détectés automatiquement
                  depuis le document à l'étape suivante.
                </p>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={handleClose}>
                Annuler
              </Button>
              <Button disabled={!canContinue} onClick={() => setStep("file")}>
                Continuer
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <button
                type="button"
                disabled={processing}
                onClick={() => fileInputRef.current?.click()}
                className="border-muted-foreground/25 hover:border-primary hover:bg-accent/50 flex w-full flex-col items-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors disabled:pointer-events-none disabled:opacity-60"
              >
                {processing ? (
                  <Loader2 className="text-primary size-8 animate-spin" />
                ) : (
                  <UploadCloud className="text-muted-foreground size-8" />
                )}
                <div>
                  <p className="text-sm font-semibold">
                    {processing ? "Création de la commande et analyse en cours..." : "Déposez votre document ici"}
                  </p>
                  {!processing && (
                    <p className="text-muted-foreground mt-1 text-xs">PDF, Excel ou Word · cliquez pour parcourir</p>
                  )}
                </div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".pdf,.xlsx,.xls,.docx"
                onChange={handleFileInputChange}
              />
              <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
                <FileSpreadsheet className="mt-0.5 size-3.5 shrink-0" />
                Les articles connus et non répertoriés seront identifiés automatiquement après import.
              </p>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("info")} disabled={processing}>
                <ArrowLeft /> Retour
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

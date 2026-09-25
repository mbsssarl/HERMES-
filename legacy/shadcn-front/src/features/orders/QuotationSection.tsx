import { useAction, useQuery } from "convex/react";
import { FileText, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { EmptyState } from "@/components/common/EmptyState";
import { LoadingButton } from "@/components/common/LoadingButton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function QuotationFileLink({ storageId }: { storageId: Id<"_storage"> }) {
  const url = useQuery(api.files.getUrl, { storageId });
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary text-sm font-medium hover:underline">
      Télécharger le PDF
    </a>
  );
}

function SendQuotationDialog({
  orderId,
  quotation,
  defaultTo,
  open,
  onClose,
}: {
  orderId: Id<"orders">;
  quotation: Doc<"quotations">;
  defaultTo: string;
  open: boolean;
  onClose: () => void;
}) {
  const sendQuotationEmail = useAction(api.emails.sendQuotationEmail);
  const [to, setTo] = useState(defaultTo);
  const [subject, setSubject] = useState(`Votre devis ${quotation.version > 1 ? `v${quotation.version}` : ""}`.trim());
  const [message, setMessage] = useState("Bonjour,\n\nVeuillez trouver ci-joint notre devis.\n\nCordialement.");
  const [loading, setLoading] = useState(false);

  async function handleSend() {
    setLoading(true);
    try {
      await sendQuotationEmail({ orderId, quotationId: quotation._id, to, subject, message });
      toast.success("Email envoyé.");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'envoi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Envoyer la quotation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="to">Destinataire</Label>
            <Input id="to" type="email" value={to} onChange={(e) => setTo(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="subject">Objet</Label>
            <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="message">Message</Label>
            <Textarea id="message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <LoadingButton loading={loading} onClick={() => void handleSend()}>
            <Send /> Envoyer
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function QuotationSection({
  orderId,
  clientEmail,
  hasMatchedItems,
}: {
  orderId: Id<"orders">;
  clientEmail?: string;
  hasMatchedItems: boolean;
}) {
  const quotations = useQuery(api.quotations.listByOrder, { orderId });
  const generateQuotation = useAction(api.quotationGeneration.generateQuotation);
  const [generating, setGenerating] = useState(false);
  const [sendDialogQuotation, setSendDialogQuotation] = useState<Doc<"quotations"> | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    try {
      await generateQuotation({ orderId });
      toast.success("Quotation générée.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la génération.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Quotation</CardTitle>
        <LoadingButton loading={generating} disabled={!hasMatchedItems} onClick={() => void handleGenerate()}>
          <FileText /> Générer la quotation
        </LoadingButton>
      </CardHeader>
      <CardContent>
        {!quotations || quotations.length === 0 ? (
          <EmptyState title="Aucune quotation générée" description="Générez la quotation une fois les articles validés." />
        ) : (
          <div className="space-y-2">
            {quotations.map((q) => (
              <div key={q._id} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="text-sm font-semibold">
                    Version {q.version} — {q.grandTotal.toFixed(2)}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Générée le {new Date(q.generatedAt).toLocaleString("fr-FR")}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {q.pdfStorageId && <QuotationFileLink storageId={q.pdfStorageId} />}
                  <Button size="sm" variant="ghost" onClick={() => setSendDialogQuotation(q)}>
                    <Send /> Envoyer
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {sendDialogQuotation && (
        <SendQuotationDialog
          orderId={orderId}
          quotation={sendDialogQuotation}
          defaultTo={clientEmail ?? ""}
          open
          onClose={() => setSendDialogQuotation(null)}
        />
      )}
    </Card>
  );
}

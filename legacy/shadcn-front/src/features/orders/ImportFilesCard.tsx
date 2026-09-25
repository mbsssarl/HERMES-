import { useQuery } from "convex/react";
import { FileCheck2, FileClock, FileX2, UploadCloud } from "lucide-react";
import { useRef, type ChangeEvent } from "react";
import { toast } from "sonner";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFileUpload } from "@/hooks/useFileUpload";
import { cn } from "cn";

const FILE_STATUS: Record<string, { label: string; icon: typeof FileCheck2; className: string }> = {
  uploaded: { label: "En attente", icon: FileClock, className: "text-muted-foreground" },
  extracting: { label: "Extraction en cours...", icon: FileClock, className: "text-amber-600 dark:text-amber-400" },
  extracted: { label: "Extrait", icon: FileCheck2, className: "text-emerald-600 dark:text-emerald-400" },
  error: { label: "Erreur", icon: FileX2, className: "text-destructive" },
};

export function ImportFilesCard({ orderId }: { orderId: Id<"orders"> }) {
  const files = useQuery(api.files.listByOrder, { orderId });
  const { upload, uploading } = useFileUpload(orderId);
  const clientInputRef = useRef<HTMLInputElement>(null);
  const supplierInputRef = useRef<HTMLInputElement>(null);

  async function handleFileSelected(e: ChangeEvent<HTMLInputElement>, kind: "client_request" | "supplier_response") {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await upload(file, kind);
      toast.info("Fichier envoyé, extraction en cours...");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Échec de l'upload.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => clientInputRef.current?.click()}>
            <UploadCloud /> Importer document client
          </Button>
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => supplierInputRef.current?.click()}>
            <UploadCloud /> Importer fichier fournisseur
          </Button>
          <input
            ref={clientInputRef}
            type="file"
            hidden
            accept=".pdf,.xlsx,.xls,.docx"
            onChange={(e) => void handleFileSelected(e, "client_request")}
          />
          <input
            ref={supplierInputRef}
            type="file"
            hidden
            accept=".pdf,.xlsx,.xls,.docx"
            onChange={(e) => void handleFileSelected(e, "supplier_response")}
          />
        </div>

        {uploading && (
          <div className="bg-muted mt-4 h-1.5 w-full overflow-hidden rounded-full">
            <div className="bg-primary h-full w-1/3 animate-pulse rounded-full" />
          </div>
        )}

        {files && files.length > 0 && (
          <ul className="mt-4 space-y-2">
            {files.map((f) => {
              const status = FILE_STATUS[f.status] ?? FILE_STATUS.uploaded;
              const Icon = status.icon;
              return (
                <li key={f._id} className="flex items-center justify-between text-sm" title={f.extractionError}>
                  <span className="truncate">{f.fileName}</span>
                  <span className={cn("flex shrink-0 items-center gap-1.5 font-medium", status.className)}>
                    <Icon className="size-3.5" />
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

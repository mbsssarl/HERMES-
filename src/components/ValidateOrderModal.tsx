import React from 'react';
import { useAction, useMutation } from 'convex/react';
import { UploadCloud } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import { Modal } from './ui';
import { useToast } from './Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * « Valider la commande » : le client renvoie son fichier de demande de cotation, cette fois avec seulement les
 * articles qu'il veut recevoir, leurs quantités et leurs prix. Le fichier est lu, ses lignes enregistrées.
 */
export function ValidateOrderModal({
  orderId,
  quotationNumber,
  replacing,
  onClose,
  onDone,
}: {
  orderId: string;
  quotationNumber: string;
  /** Une validation existe déjà : le nouveau fichier la remplace. */
  replacing: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const importFile = useAction(api.orderValidationActions.importValidationFile);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };
      const res = await importFile({ orderId: orderId as Id<'orders'>, storageId, mimeType: file.type, fileName: file.name });
      toast(`Commande validée : ${res.lines} article(s) retenu(s)${res.matched < res.lines ? ` (${res.lines - res.matched} non retrouvé(s) dans la cotation)` : ''}.`, 'success');
      onDone();
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={replacing ? 'Remplacer le fichier de validation' : 'Valider la commande'}
      onClose={() => !busy && onClose()}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || !file}>
          {busy ? 'Lecture du fichier…' : replacing ? 'Remplacer' : 'Valider la commande'}
        </button>
      </>}
    >
      <p style={{ marginBottom: 12 }}>Veuillez importer le PO reçu du client ou une version similaire.</p>
      <div
        className={`upload-zone ${dragging ? 'dragging' : ''}`}
        onClick={() => !busy && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f && !busy) setFile(f); }}
      >
        {busy ? <div className="spinner" /> : <div className="upload-icon"><UploadCloud size={28} /></div>}
        <h3>{file?.name || 'Glissez le fichier ici'}</h3>
        <p>Cliquez ou déposez un fichier Excel, PDF ou Word</p>
        <input ref={input} type="file" accept=".xlsx,.xls,.pdf,.docx" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
      </div>
      {replacing && (
        <p className="text-muted" style={{ fontSize: 13, marginTop: 10 }}>La validation actuelle sera remplacée par le contenu de ce fichier.</p>
      )}
    </Modal>
  );
}

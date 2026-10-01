import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { UploadCloud } from 'lucide-react';
import type { Country } from '../types';
import { api, type Id } from '../lib/convex';
import { useToast } from '../components/Toast';

const ACCEPTED = '.pdf,.docx,.xlsx,.xls';

/**
 * Création d'une quotation = petit formulaire (client + pays) puis import du
 * fichier de demande. Le fichier est analysé côté serveur (extraction, matching
 * catalogue) ; on ouvre directement la fiche où les lignes apparaissent en temps réel.
 */
export function NewQuotation({
  countries,
  onCreated,
}: {
  countries: Country[];
  onCreated: (orderId: string) => void;
}) {
  const toast = useToast();
  const clients = useQuery(api.clients.list, {});
  const createClient = useMutation(api.clients.create);
  const createOrder = useMutation(api.orders.create);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUploadedFile = useMutation(api.files.registerUploadedFile);

  const activeCountries = countries.filter((c) => c.active);
  const [countryId, setCountryId] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');
  const [customerEmail, setCustomerEmail] = React.useState('');
  // ETA par défaut : aujourd'hui + 4 jours, pour laisser au fournisseur le temps de répondre avant
  // l'arrivée du navire. Modifiable librement - c'est le seul but de ce champ par défaut.
  const [eta, setEta] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 4);
    return d.toISOString().slice(0, 10);
  });
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!countryId && activeCountries[0]) setCountryId(activeCountries[0].id);
  }, [countryId, activeCountries]);


  const submit = async () => {
    if (!customerName.trim()) { toast('Indiquez le nom du client.', 'error'); return; }
    if (!countryId) { toast('Sélectionnez un pays de cotation.', 'error'); return; }
    if (!file) { toast('Importez le fichier de demande du client.', 'error'); return; }

    setSubmitting(true);
    try {
      const name = customerName.trim();
      const existing = clients?.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const clientId =
        existing?._id ??
        (await createClient({ name, contactEmail: customerEmail.trim() || undefined, countryId: countryId as Id<'countries'> }));

      const orderId = await createOrder({ clientId, countryId: countryId as Id<'countries'>, eta: eta || undefined });

      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };

      await registerUploadedFile({
        orderId,
        storageId,
        kind: 'client_request',
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      });

      toast('Fichier importé : analyse en cours…', 'success');
      onCreated(orderId);
    } catch (err) {
      toast('Erreur lors de la création: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Nouvelle quotation</h1>
          <p className="page-subtitle">Indiquez le client et le pays, puis importez sa demande : les articles connus et inconnus sont détectés automatiquement.</p>
        </div>
      </div>

      <div className="card card-pad" style={{ position: 'relative' }}>
        {submitting && (
          <div className="busy-overlay" style={{ borderRadius: 'inherit' }}>
            <div className="spinner" />
            <h3>Import du fichier en cours…</h3>
            <p className="text-muted">Création de la quotation puis envoi de {file?.name ?? 'votre fichier'}. Ne fermez pas la page.</p>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 32, alignItems: 'stretch' }}>
        <div>
        <div className="section-title">Informations client</div>
        <div className="form-field">
          <label>Nom du client</label>
          <input
            className="input"
            list="known-clients"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="ABC Shipping & Logistics"
          />
          <datalist id="known-clients">
            {(clients ?? []).map((c) => <option key={c._id} value={c.name} />)}
          </datalist>
        </div>
        <div className="form-field">
          <label>Email (optionnel, pour un nouveau client)</label>
          <input className="input" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="purchasing@client.com" />
        </div>
        <div className="form-field">
          <label>Pays de cotation</label>
          <select className="select" value={countryId} onChange={(e) => setCountryId(e.target.value)} disabled={activeCountries.length === 0}>
            <option value="" disabled>{activeCountries.length === 0 ? 'Aucun pays actif' : 'Choisir un pays…'}</option>
            {activeCountries.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
          </select>
          {activeCountries.length === 0 && (
            <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-error)' }}>
              Tous les pays sont inactifs : réactivez-en un dans la page « Pays ».
            </div>
          )}
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Les prix appliqués sont ceux de ce pays ; il ne pourra plus être modifié.
          </div>
        </div>
        <div className="form-field">
          <label>ETA (arrivée du navire)</label>
          <input className="input" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Pré-remplie à aujourd'hui + 4 jours pour laisser le temps de répondre au fournisseur ; modifiable.
          </div>
        </div>

        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="section-title">Fichier client</div>
        <div
          className={`upload-zone ${dragging ? 'dragging' : ''}`}
          style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', minHeight: 260 }}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const f = e.dataTransfer.files[0];
            if (f) setFile(f);
          }}
        >
          <div className="upload-icon"><UploadCloud size={28} /></div>
          <h3>{file?.name || 'Glissez un fichier ici'}</h3>
          <p>Cliquez ou déposez un fichier PDF, Word ou Excel</p>
          <div className="upload-formats">
            <span className="format-chip">PDF</span>
            <span className="format-chip">DOCX</span>
            <span className="format-chip">XLSX</span>
          </div>
          <input ref={fileInput} type="file" accept={ACCEPTED} style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
        </div>
        </div>
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={submit} disabled={submitting}>
            {submitting ? <><span className="spinner-inline" /> Import en cours…</> : 'Créer et analyser'}
          </button>
        </div>
      </div>
    </div>
  );
}

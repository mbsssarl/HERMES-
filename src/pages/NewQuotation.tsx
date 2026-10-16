import React from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { UploadCloud } from 'lucide-react';
import type { Country } from '../types';
import { api, type Id } from '../lib/convex';
import { useToast } from '../components/Toast';
import { capitalizeWords, regionLabel } from '../lib/format';

const ACCEPTED = '.pdf,.docx,.xlsx,.xls';

/**
 * Création d'une quotation = petit formulaire (client + région de cotation) puis import du
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
  const updateClient = useMutation(api.clients.update);
  const createOrder = useMutation(api.orders.create);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const registerUploadedFile = useMutation(api.files.registerUploadedFile);
  const applyExportCurrency = useAction(api.orders.applyExportCurrency);
  const getRate = useAction(api.exchangeRates.getRate);
  const currencies = useQuery(api.currencies.list, {});
  const supportedTargets = useQuery(api.exchangeRates.listSupportedTargets, {});

  const activeCountries = countries.filter((c) => c.active);
  const [countryId, setCountryId] = React.useState('');
  const [customerName, setCustomerName] = React.useState('');
  const [customerEmail, setCustomerEmail] = React.useState('');
  const [emailTouched, setEmailTouched] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const fileInput = React.useRef<HTMLInputElement>(null);
  // Conversion de devise (facultative) : devise cible du fichier exporté + aperçu du taux du jour.
  const [targetCurrency, setTargetCurrency] = React.useState('');
  const [ratePreview, setRatePreview] = React.useState<{ rate: number; asOf: string; source: string } | null>(null);
  const [rateError, setRateError] = React.useState<string | null>(null);
  const [rateLoading, setRateLoading] = React.useState(false);

  React.useEffect(() => {
    if (!countryId && activeCountries[0]) setCountryId(activeCountries[0].id);
  }, [countryId, activeCountries]);

  const country = countries.find((c) => c.id === countryId);
  // Toutes les quotations sont d'abord converties en USD (indépendamment du pays) : la conversion choisie ici part de l'USD.
  const sourceCurrency = 'USD';
  const sourceSupported = supportedTargets?.includes(sourceCurrency) ?? false;
  const targetOptions = (currencies ?? []).filter(
    (c) => c.active && c.code !== sourceCurrency && (supportedTargets?.includes(c.code) ?? false),
  );

  // Aperçu du taux (rien n'est enregistré ici ; le taux est figé à la création de la quotation).
  React.useEffect(() => {
    setRatePreview(null);
    setRateError(null);
    if (!targetCurrency || !sourceCurrency) return;
    let cancelled = false;
    setRateLoading(true);
    getRate({ from: sourceCurrency, to: targetCurrency })
      .then((r) => { if (!cancelled) setRatePreview(r); })
      .catch((err) => { if (!cancelled) setRateError(err instanceof Error ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setRateLoading(false); });
    return () => { cancelled = true; };
  }, [targetCurrency, sourceCurrency, getRate]);

  const knownClient = clients?.find((c) => c.name.toLowerCase() === customerName.trim().toLowerCase());
  React.useEffect(() => {
    if (!emailTouched) setCustomerEmail(knownClient?.contactEmail ?? '');
  }, [knownClient?._id, knownClient?.contactEmail, emailTouched]);


  const submit = async () => {
    if (!customerName.trim()) { toast('Indiquez le nom du client.', 'error'); return; }
    if (!countryId) { toast('Sélectionnez une région de cotation.', 'error'); return; }
    if (!file) { toast('Importez le fichier de demande du client.', 'error'); return; }
    const email = customerEmail.trim();
    if (email && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email)) { toast("L'adresse e-mail du client n'est pas valide.", 'error'); return; }

    setSubmitting(true);
    try {
      const name = capitalizeWords(customerName.trim());
      const existing = clients?.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const clientId =
        existing?._id ??
        (await createClient({ name, countryId: countryId as Id<'countries'>, contactEmail: email || undefined }));
      // Client déjà connu : l'e-mail saisi (facultatif) remplace celui enregistré ; un champ vide n'efface rien.
      if (existing && email && email !== existing.contactEmail) await updateClient({ clientId: existing._id, contactEmail: email });

      const orderId = await createOrder({ clientId, countryId: countryId as Id<'countries'> });

      // Conversion de devise choisie à la création : taux figé sur la quotation (modifiable ensuite depuis sa fiche).
      if (targetCurrency) {
        try {
          await applyExportCurrency({ orderId, targetCurrency, applyRate: true });
        } catch (err) {
          toast(
            'Quotation créée, mais le taux de change n\'a pas pu être appliqué (' +
              (err instanceof Error ? err.message : String(err)) +
              '). Vous pourrez le faire depuis la fiche de la quotation.',
            'error',
          );
        }
      }

      const uploadUrl = await generateUploadUrl();
      const response = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error("Échec de l'upload du fichier.");
      const { storageId } = (await response.json()) as { storageId: Id<'_storage'> };

      await registerUploadedFile({
        orderId,
        storageId,
        kind: 'client_request',
        fileName: file.name.toLowerCase(),
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
        </div>
      </div>

      <div className="card card-pad" style={{ position: 'relative' }}>
        {submitting && (
          <div className="busy-overlay" style={{ borderRadius: 'inherit' }}>
            <div className="spinner" />
            <h3>Import du fichier en cours…</h3>
            <p className="text-muted">Création de la quotation puis envoi de {file?.name.toLowerCase() ?? 'votre fichier'}. Ne fermez pas la page.</p>
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
            onChange={(e) => setCustomerName(capitalizeWords(e.target.value))}
            placeholder="Abc Shipping & Logistics"
          />
          <datalist id="known-clients">
            {(clients ?? []).map((c) => <option key={c._id} value={capitalizeWords(c.name)} />)}
          </datalist>
        </div>
        <div className="form-field">
          <label>E-mail du client <span className="text-muted" style={{ fontWeight: 400 }}>(facultatif)</span></label>
          <input
            className="input"
            type="email"
            value={customerEmail}
            onChange={(e) => { setCustomerEmail(e.target.value); setEmailTouched(true); }}
            placeholder="contact@client.com"
            autoComplete="off"
          />
        </div>
        <div className="form-field">
          <label>Région de cotation</label>
          <select className="select" value={countryId} onChange={(e) => setCountryId(e.target.value)} disabled={activeCountries.length === 0}>
            <option value="" disabled>{activeCountries.length === 0 ? 'Aucune région active' : 'Choisir une région…'}</option>
            {activeCountries.map((c) => <option key={c.id} value={c.id}>{regionLabel(c)} ({c.code})</option>)}
          </select>
          {activeCountries.length === 0 && (
            <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-error)' }}>
              Toutes les régions sont inactives : réactivez-en une dans Admin, onglet « Régions ».
            </div>
          )}
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            Les prix appliqués sont ceux de cette région.
          </div>
        </div>

        <div className="form-field">
          <label>Convertir le total en (depuis l'USD) <span className="text-muted" style={{ fontWeight: 400 }}>(facultatif)</span></label>
          <select
            className="select"
            value={targetCurrency}
            onChange={(e) => setTargetCurrency(e.target.value)}
            disabled={!sourceSupported || targetOptions.length === 0}
          >
            <option value="">Aucune conversion{sourceCurrency ? ` (${sourceCurrency})` : ''}</option>
            {targetOptions.map((c) => <option key={c._id} value={c.code}>{c.code} · {c.name}</option>)}
          </select>
          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            {!targetCurrency && 'Les montants du fichier exporté seront convertis avec le taux du jour, figé à la création.'}
            {targetCurrency && rateLoading && 'Récupération du taux…'}
            {targetCurrency && ratePreview && `1 USD = ${ratePreview.rate.toFixed(6)} ${targetCurrency} · ${ratePreview.source} (${ratePreview.asOf})`}
          </div>
          {rateError && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-error)' }}>{rateError}</div>}
          {country && supportedTargets !== undefined && !sourceSupported && (
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
              Conversion en direct indisponible depuis {sourceCurrency} (pas de taux de référence publié).
            </div>
          )}
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
          <h3>{file?.name.toLowerCase() || 'Glissez un fichier ici'}</h3>
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

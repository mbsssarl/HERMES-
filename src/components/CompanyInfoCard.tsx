import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../lib/convex';
import { StateBox } from './ui';
import { useToast } from './Toast';

interface CompanyInfo {
  name: string;
  address: string;
  postal: string;
  email: string;
  phones: string;
  website: string;
}

const EMPTY: CompanyInfo = { name: '', address: '', postal: '', email: '', phones: '', website: '' };
const KEY = 'companyInfo';
const errMsg = (err: unknown) => (err instanceof Error ? err.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] : String(err));

const FIELDS: Array<{ key: keyof CompanyInfo; label: string; placeholder: string }> = [
  { key: 'name', label: 'Raison sociale', placeholder: 'MARINI AND BRICE SHIPSCHANDLER SUPPLIER MBSS SARL' },
  { key: 'address', label: 'Adresse', placeholder: 'RUE 533 CHARLEY EYOUM EBELLE DEIDO' },
  { key: 'postal', label: 'BP, ville, pays', placeholder: 'BP : 3057 DOUALA CAMEROUN' },
  { key: 'email', label: 'Email', placeholder: 'contact@entreprise.com' },
  { key: 'phones', label: 'Téléphone(s) — « Operation Dept »', placeholder: '+237 600000000 / +237 600000001' },
  { key: 'website', label: 'Site web', placeholder: 'https://www.entreprise.com/' },
];

/**
 * Coordonnées de l'entreprise : elles s'affichent à droite du logo, en tête des demandes de cotation envoyées aux
 * fournisseurs (fichier Excel). Réglage propre à l'entreprise, modifiable par son administrateur.
 */
export function CompanyInfoCard() {
  const toast = useToast();
  const stored = useQuery(api.settings.get, { key: KEY });
  const save = useMutation(api.settings.update);
  const [draft, setDraft] = React.useState<CompanyInfo | null>(null); // null = pas encore modifié
  const [saving, setSaving] = React.useState(false);

  if (stored === undefined) return <StateBox loading variant="table" title="Chargement…" />;

  const saved: CompanyInfo = { ...EMPTY, ...((stored ?? {}) as Partial<CompanyInfo>) };
  const current = draft ?? saved;
  const dirty = FIELDS.some(({ key }) => current[key].trim() !== saved[key].trim());

  const submit = async () => {
    setSaving(true);
    try {
      const value = Object.fromEntries(FIELDS.map(({ key }) => [key, current[key].trim()]));
      await save({ key: KEY, value });
      toast('Coordonnées enregistrées.', 'success');
      setDraft(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card card-pad" style={{ maxWidth: 760, marginTop: 16 }}>
      <div className="section-title">Coordonnées de l'entreprise</div>
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Affichées à droite du logo, en tête des demandes de cotation envoyées aux fournisseurs. Une ligne vide n'est pas imprimée.
      </p>
      {FIELDS.map(({ key, label, placeholder }) => (
        <div className="form-field" key={key}>
          <label>{label}</label>
          <input
            className="input"
            value={current[key]}
            maxLength={120}
            placeholder={placeholder}
            onChange={(e) => setDraft({ ...current, [key]: e.target.value })}
          />
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
        <button className="btn" disabled={!dirty || saving} onClick={() => setDraft(null)}>Annuler les modifications</button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void submit()}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

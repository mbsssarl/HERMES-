import React from 'react';
import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';
import type { Country } from '../types';
import { api, type Id } from '../lib/convex';
import { Modal, StateBox } from '../components/ui';
import { TextCell } from '../components/EditableCells';
import { useToast } from '../components/Toast';

export function Countries({ countries, loading, isAdmin }: { countries: Country[]; loading: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const createCountry = useMutation(api.countries.create);
  const updateCountry = useMutation(api.countries.update);
  const [showAdd, setShowAdd] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [currency, setCurrency] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  if (loading) return <StateBox loading title="Chargement…" />;

  const submit = async () => {
    if (!code.trim() || !name.trim() || !currency.trim()) { toast('Code, nom et devise sont requis.', 'error'); return; }
    setSaving(true);
    try {
      await createCountry({ code: code.trim().toUpperCase(), name: name.trim(), currency: currency.trim().toUpperCase() });
      toast('Pays ajouté.', 'success');
      setShowAdd(false);
      setCode(''); setName(''); setCurrency('');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = async (c: Country, patch: { code?: string; name?: string; currency?: string; active?: boolean }) => {
    try {
      await updateCountry({ countryId: c.id as Id<'countries'>, ...patch });
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Pays</h1>
          <p className="page-subtitle">Pays de cotation disponibles et leur devise.{isAdmin ? ' Cliquez sur une cellule pour la modifier.' : ''}</p>
        </div>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Ajouter un pays</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Pays</th>
                <th>Devise</th>
                <th>Statut</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.id}>
                  <td><TextCell mono width={80} disabled={!isAdmin} value={c.code} onCommit={(v) => void edit(c, { code: v })} /></td>
                  <td style={{ minWidth: 220 }}><TextCell width="100%" disabled={!isAdmin} value={c.name} onCommit={(v) => void edit(c, { name: v })} /></td>
                  <td><TextCell mono width={90} disabled={!isAdmin} value={c.currency} onCommit={(v) => void edit(c, { currency: v })} /></td>
                  <td>
                    <span className={`tag ${c.active ? 'tag-new' : 'tag-same'}`}>{c.active ? 'Actif' : 'Inactif'}</span>
                  </td>
                  {isAdmin && (
                    <td className="text-right">
                      <button className="btn btn-ghost btn-sm" onClick={() => void edit(c, { active: !c.active })}>{c.active ? 'Désactiver' : 'Activer'}</button>
                    </td>
                  )}
                </tr>
              ))}
              {countries.length === 0 && (
                <tr><td colSpan={5} className="text-muted" style={{ padding: 24 }}>Aucun pays. {isAdmin ? 'Ajoutez-en un pour pouvoir créer des quotations.' : ''}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <Modal
          title="Ajouter un pays"
          onClose={() => setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Code (ex. CM)</label><input className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={3} /></div>
          <div className="form-field"><label>Nom</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cameroun" /></div>
          <div className="form-field"><label>Devise (ex. XAF)</label><input className="input" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} /></div>
        </Modal>
      )}
    </div>
  );
}

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
  const [city, setCity] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  if (loading) return <StateBox loading title="Chargement…" />;

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast('Code et nom sont requis.', 'error'); return; }
    setSaving(true);
    try {
      await createCountry({ code: code.trim().toUpperCase(), name: name.trim(), city: city.trim() || undefined });
      toast('Pays ajouté.', 'success');
      setShowAdd(false);
      setCode(''); setName(''); setCity('');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = async (c: Country, patch: { code?: string; name?: string; city?: string; active?: boolean }) => {
    try {
      await updateCountry({ countryId: c.id as Id<'countries'>, ...patch });
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Pays de cotation disponibles.{isAdmin ? ' Cliquez sur une cellule pour la modifier.' : ''}
        </p>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Ajouter un pays</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Pays</th>
                <th>Ville</th>
                <th>Statut</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {countries.map((c) => (
                <tr key={c.id}>
                  <td><TextCell mono width={80} disabled={!isAdmin} value={c.code} onCommit={(v) => void edit(c, { code: v })} /></td>
                  <td style={{ minWidth: 220 }}><TextCell width="100%" disabled={!isAdmin} value={c.name} onCommit={(v) => void edit(c, { name: v })} /></td>
                  <td style={{ minWidth: 160 }}><TextCell width="100%" disabled={!isAdmin} value={c.city ?? ''} placeholder="-" onCommit={(v) => void edit(c, { city: v })} /></td>
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
          <div className="form-field"><label>Ville (facultatif)</label><input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Douala" /></div>
        </Modal>
      )}
    </div>
  );
}

import React from 'react';
import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';
import type { Country, Currency } from '../types';
import { api, type Id } from '../lib/convex';
import { Modal, StateBox } from '../components/ui';
import { TextCell } from '../components/EditableCells';
import { useToast } from '../components/Toast';

export function Countries({ countries, currencies, loading, isAdmin }: { countries: Country[]; currencies: Currency[]; loading: boolean; isAdmin: boolean }) {
  const toast = useToast();
  const createCountry = useMutation(api.countries.create);
  const updateCountry = useMutation(api.countries.update);
  const [showAdd, setShowAdd] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [city, setCity] = React.useState('');
  const [currency, setCurrency] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  if (loading) return <StateBox loading title="Chargement…" />;

  const submit = async () => {
    if (!code.trim() || !name.trim()) { toast('Code et nom sont requis.', 'error'); return; }
    setSaving(true);
    try {
      await createCountry({ code: code.trim().toUpperCase(), name: name.trim(), city: city.trim() || undefined, currency: currency.trim().toUpperCase() });
      toast('Région ajoutée.', 'success');
      setShowAdd(false);
      setCode(''); setName(''); setCity(''); setCurrency('');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = async (c: Country, patch: { code?: string; name?: string; city?: string; currency?: string; active?: boolean }) => {
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
          Régions de cotation (un pays peut en compter plusieurs, une par ville de cotation) et leur devise : tout article ajouté à une région hérite automatiquement de sa devise.
          {isAdmin ? ' Cliquez sur une cellule pour la modifier.' : ''}
        </p>
        {isAdmin && <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Ajouter une région</button>}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Code</th>
                <th>Pays</th>
                <th>Ville</th>
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
                  <td style={{ minWidth: 160 }}><TextCell width="100%" disabled={!isAdmin} value={c.city ?? ''} placeholder="-" onCommit={(v) => void edit(c, { city: v })} /></td>
                  <td>
                    <select className="select cell-input" style={{ width: 110 }} disabled={!isAdmin} value={c.currency} onChange={(e) => void edit(c, { currency: e.target.value })}>
                      {!currencies.some((cur) => cur.code === c.currency) && <option value={c.currency}>{c.currency}</option>}
                      {currencies.filter((cur) => cur.active || cur.code === c.currency).map((cur) => <option key={cur.id} value={cur.code}>{cur.code}</option>)}
                    </select>
                  </td>
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
                <tr><td colSpan={6} className="text-muted" style={{ padding: 24 }}>Aucune région. {isAdmin ? 'Ajoutez-en une pour pouvoir créer des quotations.' : ''}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <Modal
          title="Ajouter une région"
          onClose={() => setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Code (unique, ex. CM-DLA)</label><input className="input" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} /></div>
          <div className="form-field"><label>Nom</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Cameroun" /></div>
          <div className="form-field"><label>Ville de cotation</label><input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Douala" /></div>
          <div className="form-field">
            <label>Devise</label>
            <select className="select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="" disabled>Choisir une devise…</option>
              {currencies.filter((cur) => cur.active).map((cur) => <option key={cur.id} value={cur.code}>{cur.code} - {cur.name}</option>)}
            </select>
            {currencies.length === 0 && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-error)' }}>Ajoutez d'abord une devise dans l'onglet Devises.</div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

import React from 'react';
import { useMutation } from 'convex/react';
import { Plus } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import type { ProductCategory } from '../types';
import { Modal } from '../components/ui';
import { useToast } from '../components/Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const MAX_CATEGORIES = 5;

/**
 * Liste fixe (5 maximum) des catégories du catalogue. Pas de suppression - une fois les 5 prises,
 * on renomme une catégorie existante plutôt que d'en ajouter une nouvelle.
 */
export function CategoriesTab({ categories }: { categories: ProductCategory[] }) {
  const toast = useToast();
  const createCategory = useMutation(api.productCategories.create);
  const updateCategory = useMutation(api.productCategories.update);
  const [showAdd, setShowAdd] = React.useState(false);
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await createCategory({ name });
      toast('Catégorie ajoutée.', 'success');
      setShowAdd(false);
      setName('');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = (c: ProductCategory, patch: { name?: string; active?: boolean }) =>
    updateCategory({ categoryId: c.id as Id<'productCategories'>, ...patch }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  return (
    <>
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Catégories</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {categories.length} / {MAX_CATEGORIES} - classement des articles du catalogue (Produits & prix). Pas de suppression : renommez une catégorie plutôt que d'en recréer une.
            </span>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)} disabled={categories.length >= MAX_CATEGORIES} title={categories.length >= MAX_CATEGORIES ? `${MAX_CATEGORIES} catégories maximum` : undefined}>
            <Plus size={16} /> Ajouter une catégorie
          </button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Nom</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 260, fontWeight: 600 }}>
                    <input key={c.name} className="input cell-input" style={{ width: '100%' }} defaultValue={c.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) void edit(c, { name: v }); else e.target.value = c.name; }} />
                  </td>
                  <td><span className={`tag ${c.active ? 'tag-new' : 'tag-same'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => void edit(c, { active: !c.active })}>{c.active ? 'Désactiver' : 'Activer'}</button>
                  </td>
                </tr>
              ))}
              {categories.length === 0 && <tr><td colSpan={3} className="text-muted" style={{ padding: 24 }}>Aucune catégorie. Ajoutez-en une.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <Modal
          title="Ajouter une catégorie"
          onClose={() => !saving && setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)} disabled={saving}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={saving || !name.trim()}>{saving ? 'Ajout…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Nom</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Pièces techniques" autoFocus /></div>
        </Modal>
      )}
    </>
  );
}

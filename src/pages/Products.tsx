import React from 'react';
import { useMutation } from 'convex/react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type { Country, ProductWithPrices } from '../types';
import { api, type Id } from '../lib/convex';
import { Modal, StateBox } from '../components/ui';
import { NumberCell, TextCell } from '../components/EditableCells';
import { useToast } from '../components/Toast';
import { CatalogImportModal } from '../components/CatalogImportModal';
import { formatPrice } from '../lib/format';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Catalogue : chaque cellule est directement modifiable par l'admin (code, nom, catégorie, unité et
 * prix par pays), sur le même principe que les lignes d'une quotation. Les prix précédents restent
 * dans l'historique.
 */
export function Products({
  products,
  countries,
  loading,
  isAdmin,
}: {
  products: ProductWithPrices[];
  countries: Country[];
  loading: boolean;
  isAdmin: boolean;
}) {
  const toast = useToast();
  const createProduct = useMutation(api.products.createManual);
  const updateProduct = useMutation(api.products.update);
  const removeProduct = useMutation(api.products.deactivate);
  const [toDelete, setToDelete] = React.useState<ProductWithPrices | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const setPrice = useMutation(api.productPrices.setPrice);
  const [showAdd, setShowAdd] = React.useState(false);
  const [showImport, setShowImport] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [countryFilter, setCountryFilter] = React.useState('');

  // Formulaire d'ajout : la « référence » de l'UI correspond à l'IMPA/code du catalogue
  const [ref, setRef] = React.useState('');
  const [name, setName] = React.useState('');
  const [unit, setUnit] = React.useState('PCS');
  const [newCountryId, setNewCountryId] = React.useState('');
  const [newPrice, setNewPrice] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const activeCountries = countries.filter((c) => c.active); // pour l'import
  const priceCountries = countries; // colonnes de prix : tous les pays, actifs ou non

  const submitProduct = async () => {
    if (!name.trim()) { toast('Le nom est requis.', 'error'); return; }
    setSaving(true);
    try {
      const price = newPrice.trim() === '' ? undefined : Math.round(Number(newPrice.trim().replace(',', '.')) * 100) / 100;
      if (price !== undefined && (!Number.isFinite(price) || price < 0)) { toast('Prix invalide.', 'error'); setSaving(false); return; }
      const country = countries.find((c) => c.id === newCountryId);
      if (price !== undefined && !country) { toast('Choisissez le pays de ce prix.', 'error'); setSaving(false); return; }

      const productId = await createProduct({ impaId: ref.trim() || undefined, name: name.trim(), unit: unit.trim() || 'PCS' });
      if (price !== undefined && country) {
        await setPrice({ productId, countryId: country.id as Id<'countries'>, price, currency: country.currency });
      }
      toast('Produit ajouté.', 'success');
      setShowAdd(false);
      setRef(''); setName(''); setUnit('PCS'); setNewPrice('');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const edit = (p: ProductWithPrices, patch: { name?: string; unit?: string; code?: string }) =>
    updateProduct({ productId: p.id as Id<'products'>, ...patch }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await removeProduct({ productId: toDelete.id as Id<'products'> });
      toast('Produit supprimé du catalogue.', 'success');
      setToDelete(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const savePrice = (p: ProductWithPrices, c: Country, price: number) =>
    setPrice({
      productId: p.id as Id<'products'>,
      countryId: c.id as Id<'countries'>,
      price,
      currency: c.currency,
    })
      .then(() => toast(`Prix ${c.code} enregistré : ${formatPrice(price, c.currency)}.`, 'success'))
      .catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  if (loading) return <StateBox loading title="Chargement du catalogue…" />;

  const term = search.trim().toLowerCase();
  const visible = term
    ? products.filter((p) => p.name.toLowerCase().includes(term) || p.reference.toLowerCase().includes(term))
    : products;

  // Une ligne par produit et par pays : ... | Unit | Unit Price | Country
  const shownCountries = countryFilter ? priceCountries.filter((c) => c.id === countryFilter) : priceCountries;
  const rows = visible.flatMap((p) => shownCountries.map((c) => ({ p, c })));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Produits & prix</h1>
          <p className="page-subtitle">
            Catalogue produits avec tarifs par pays.{isAdmin ? ' Cliquez sur une cellule pour la modifier.' : ''}
          </p>
        </div>
        {isAdmin && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => { setNewCountryId(countryFilter || priceCountries[0]?.id || ''); setShowAdd(true); }}><Plus size={16} /> Ajouter un produit</button>
            <button className="btn btn-primary" onClick={() => setShowImport(true)}><Upload size={16} /> Importer un catalogue</button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Catalogue produits</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {visible.length} produit(s) · {countryFilter
                ? `${shownCountries[0]?.name ?? ''} (${shownCountries[0]?.currency ?? ''})`
                : `${priceCountries.length} pays`}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="select" style={{ width: 200 }} value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Pays">
              <option value="">Tous les pays</option>
              {priceCountries.map((c) => <option key={c.id} value={c.id}>{c.code} - {c.name}</option>)}
            </select>
            <input className="input" style={{ width: 260 }} placeholder="Rechercher (nom, code)…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-scroll" style={{ maxHeight: '70vh', border: 'none', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 48 }}>No.</th>
                <th style={{ width: 130 }}>Code</th>
                <th>Description</th>
                <th style={{ width: 90 }}>Unit</th>
                <th className="text-right">Unit Price</th>
                <th style={{ width: 110 }}>Country</th>
                {isAdmin && <th style={{ width: 44 }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ p, c }, index) => {
                const price = p.product_prices.find((pr) => pr.country_id === c.id);
                return (
                  <tr key={`${p.id}-${c.id}`}>
                    <td className="text-muted mono">{index + 1}</td>
                    <td>
                      <TextCell mono width={110} disabled={!isAdmin} value={p.reference}
                        onCommit={(v) => edit(p, { code: v.trim() })} />
                    </td>
                    <td style={{ minWidth: 220 }}>
                      <TextCell width="100%" disabled={!isAdmin} value={p.name}
                        onCommit={(v) => { if (v.trim()) void edit(p, { name: v.trim() }); else toast('Le nom ne peut pas être vide.', 'error'); }} />
                    </td>
                    <td>
                      <TextCell width={80} disabled={!isAdmin} value={p.unit}
                        onCommit={(v) => { if (v.trim()) void edit(p, { unit: v.trim() }); else toast("L'unité ne peut pas être vide.", 'error'); }} />
                    </td>
                    <td className="text-right">
                      <NumberCell
                        width={110}
                        decimals={2}
                        disabled={!isAdmin}
                        value={price ? price.base_price : null}
                        placeholder="-"
                        onCommit={(v) => void savePrice(p, c, v)}
                      />
                    </td>
                    <td className="mono nowrap" title={c.name} style={{ fontWeight: 600 }}>
                      {c.code}
                    </td>
                    {isAdmin && (
                      <td>
                        <button className="btn btn-ghost btn-sm" title="Supprimer" aria-label={`Supprimer ${p.name}`} onClick={() => setToDelete(p)}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={isAdmin ? 7 : 6} className="text-muted" style={{ padding: 24 }}>Aucun produit.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {toDelete && (
        <Modal
          title="Supprimer ce produit ?"
          onClose={() => !deleting && setToDelete(null)}
          footer={<>
            <button className="btn" onClick={() => setToDelete(null)} disabled={deleting}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          </>}
        >
          <p>
            <strong>{toDelete.reference ? `${toDelete.reference} - ` : ''}{toDelete.name}</strong> sera retiré du catalogue.
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Les quotations existantes ne sont pas modifiées et l'historique des prix est conservé.
          </p>
        </Modal>
      )}

      {showImport && <CatalogImportModal countries={activeCountries} onClose={() => setShowImport(false)} />}

      {showAdd && (
        <Modal
          title="Ajouter un produit"
          onClose={() => setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)}>Annuler</button>
            <button className="btn btn-primary" onClick={submitProduct} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Code (optionnel)</label><input className="input" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="150301" /></div>
          <div className="form-field"><label>Description</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Safety Goggles" /></div>
          <div className="form-field"><label>Unit</label><input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-field">
              <label>Country</label>
              <select className="select" value={newCountryId} onChange={(e) => setNewCountryId(e.target.value)}>
                <option value="">Aucun</option>
                {priceCountries.map((c) => <option key={c.id} value={c.id}>{c.code}{c.active ? '' : ' (inactif)'}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label>Unit Price</label>
              <input className="input" inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="0.00" disabled={!newCountryId} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

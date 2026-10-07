import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ArrowLeft, Copy, KeyRound, Plus } from 'lucide-react';
import { api, type Doc, type Id } from '../lib/convex';
import type { QuotationWithRelations } from '../types';
import { formatAmount, formatDate } from '../lib/format';
import { Modal, StateBox } from '../components/ui';
import { StatusTag } from '../components/StatusTag';
import { Countries } from './Countries';
import { BackupsTab } from './BackupsTab';
import { CategoriesTab } from './CategoriesTab';
import type { Country, Currency, ProductCategory } from '../types';
import { useToast } from '../components/Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

// Libellés lisibles des actions enregistrées dans le journal.
const ACTION_LABELS: Record<string, string> = {
  'order.created': 'Quotation créée',
  'order.deleted': 'Quotation supprimée',
  'order.restored': 'Quotation restaurée',
  'order.archived': 'Quotation archivée',
  'order.status_changed': 'Statut modifié',
  'order.global_pricing_applied': 'Cotation / discount global appliqué',
  'order.quotation_percent_changed': 'Cotation modifiée',
  'order.discount_changed': 'Discount modifié',
  'product.created': 'Produit créé',
  'product.updated': 'Produit modifié',
  'product.deactivated': 'Produit supprimé',
  'product.deleted': 'Produit supprimé définitivement',
  'product.deleted_bulk': 'Produits supprimés définitivement',
  'product.restored': 'Produits restaurés depuis la sauvegarde',
  'product.backup_purged': 'Sauvegardes supprimées définitivement',
  'product.price_set': 'Prix enregistré',
  'product.catalog_imported': 'Catalogue importé',
  'product.created_from_supplier': 'Produit créé (fournisseur)',
  'country.created': 'Région créée',
  'country.updated': 'Région modifiée',
  'client.created': 'Client créé',
  'client.updated': 'Client modifié',
  'quotation.generated': 'Devis généré',
  'quotation.approved': 'Devis approuvé',
  'quotation.emailed': 'Devis envoyé',
  'user.created': 'Compte créé',
  'user.disabled': 'Compte désactivé',
  'user.reactivated': 'Compte réactivé',
  'user.bootstrapped': 'Premier admin créé',
};

function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

function detailsOf(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') return '';
  return Object.entries(metadata as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join(' · ');
}

type UserDoc = Doc<'users'>;

/**
 * Espace administrateur : création des comptes, journal d'activité de tous les utilisateurs et accès
 * aux quotations de chacun.
 */
export function Admin({
  quotations,
  countries,
  currencies,
  categories,
  loadingCountries,
  onOpen,
}: {
  quotations: QuotationWithRelations[];
  countries: Country[];
  currencies: Currency[];
  categories: ProductCategory[];
  loadingCountries: boolean;
  onOpen: (q: QuotationWithRelations) => void;
}) {
  const [tab, setTab] = React.useState<'users' | 'logs' | 'countries' | 'currencies' | 'categories' | 'backups'>('users');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const users = useQuery(api.users.listUsers);

  if (users === undefined) return <StateBox loading title="Chargement…" />;

  const selected = users.find((u) => u._id === selectedId) ?? null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">Comptes utilisateurs, journal d'activité, quotations de chacun et régions de cotation.</p>
        </div>
      </div>

      {selected ? (
        <UserDetail user={selected} quotations={quotations} onBack={() => setSelectedId(null)} onOpen={onOpen} users={users} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
            <button className={`btn btn-sm ${tab === 'users' ? 'btn-primary' : ''}`} onClick={() => setTab('users')}>Utilisateurs</button>
            <button className={`btn btn-sm ${tab === 'logs' ? 'btn-primary' : ''}`} onClick={() => setTab('logs')}>Journal d'activité</button>
            <button className={`btn btn-sm ${tab === 'countries' ? 'btn-primary' : ''}`} onClick={() => setTab('countries')}>Régions</button>
            <button className={`btn btn-sm ${tab === 'currencies' ? 'btn-primary' : ''}`} onClick={() => setTab('currencies')}>Devises</button>
            <button className={`btn btn-sm ${tab === 'categories' ? 'btn-primary' : ''}`} onClick={() => setTab('categories')}>Catégories</button>
            <button className={`btn btn-sm ${tab === 'backups' ? 'btn-primary' : ''}`} onClick={() => setTab('backups')}>Sauvegardes</button>
          </div>
          {tab === 'users' && <UsersTab users={users} quotations={quotations} onSelect={setSelectedId} />}
          {tab === 'logs' && <LogsTab users={users} />}
          {tab === 'currencies' && <CurrenciesTab currencies={currencies} />}
          {tab === 'categories' && <CategoriesTab categories={categories} />}
          {tab === 'backups' && <BackupsTab countries={countries} />}
          {tab === 'countries' && (
            <div className="card card-pad">
              <Countries countries={countries} currencies={currencies} loading={loadingCountries} isAdmin />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Utilisateurs

function UsersTab({
  users,
  quotations,
  onSelect,
}: {
  users: UserDoc[];
  quotations: QuotationWithRelations[];
  onSelect: (id: string) => void;
}) {
  const toast = useToast();
  const createUser = useMutation(api.users.createUser);
  const toggleStatus = useMutation(api.users.toggleUserStatus);
  const [showAdd, setShowAdd] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const resetPassword = useMutation(api.users.adminResetPassword);
  const [created, setCreated] = React.useState<{ email: string; password: string; emailed: boolean; reset: boolean } | null>(null);
  const [toReset, setToReset] = React.useState<UserDoc | null>(null);
  const [resetting, setResetting] = React.useState(false);

  const countBy = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const q of quotations) if (q.created_by) map.set(q.created_by, (map.get(q.created_by) ?? 0) + 1);
    return map;
  }, [quotations]);

  const submit = async () => {
    if (!email.trim()) { toast("Indiquez l'adresse email.", 'error'); return; }
    setSaving(true);
    try {
      const res = await createUser({ email: email.trim() });
      setCreated({ email: email.trim().toLowerCase(), password: res.tempPassword, emailed: false, reset: false });
      setShowAdd(false);
      setEmail('');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmReset = async () => {
    if (!toReset) return;
    setResetting(true);
    try {
      const res = await resetPassword({ userId: toReset._id });
      setCreated({ email: res.email, password: res.tempPassword, emailed: res.emailSent, reset: true });
      setToReset(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setResetting(false);
    }
  };

  const setStatus = (u: UserDoc, status: 'active' | 'disabled') =>
    toggleStatus({ userId: u._id, status }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  return (
    <>
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Utilisateurs</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>{users.length} compte(s)</span>
          </div>
          <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Créer un compte</button>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Email</th>
                <th>Rôle</th>
                <th>Statut</th>
                <th>Dernière connexion</th>
                <th className="text-right">Quotations</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id} className="clickable" onClick={() => onSelect(u._id)}>
                  <td style={{ fontWeight: 600 }}>{u.email}</td>
                  <td>{u.role === 'admin' ? 'Admin' : 'Utilisateur'}</td>
                  <td>
                    <span className={`tag ${u.status === 'active' ? 'tag-new' : 'tag-same'}`}>{u.status === 'active' ? 'Actif' : 'Désactivé'}</span>
                    {u.mustChangePassword && <span className="tag tag-warn" style={{ marginLeft: 6 }}>Mot de passe temporaire</span>}
                  </td>
                  <td className="text-muted nowrap">{u.lastLoginAt ? formatDate(new Date(u.lastLoginAt).toISOString()) : 'Jamais'}</td>
                  <td className="text-right mono">{countBy.get(u._id) ?? 0}</td>
                  <td className="text-right nowrap" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setToReset(u)} title="Générer un mot de passe à usage unique">
                      <KeyRound size={14} /> Réinitialiser le mot de passe
                    </button>
                    {u.status === 'active'
                      ? <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(u, 'disabled')}>Désactiver</button>
                      : <button className="btn btn-ghost btn-sm" onClick={() => void setStatus(u, 'active')}>Réactiver</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <Modal
          title="Créer un compte utilisateur"
          onClose={() => !saving && setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)} disabled={saving}>Annuler</button>
            <button className="btn btn-primary" onClick={submit} disabled={saving}>{saving ? 'Création…' : 'Créer le compte'}</button>
          </>}
        >
          <div className="form-field">
            <label>Adresse email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="prenom.nom@mbss-sarl.com" autoFocus />
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Un mot de passe temporaire est généré. L'utilisateur devra le changer à sa première connexion.
          </p>
        </Modal>
      )}

      {toReset && (
        <Modal
          title="Réinitialiser le mot de passe ?"
          onClose={() => !resetting && setToReset(null)}
          footer={<>
            <button className="btn" onClick={() => setToReset(null)} disabled={resetting}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void confirmReset()} disabled={resetting}>
              {resetting ? 'Génération…' : 'Générer le mot de passe'}
            </button>
          </>}
        >
          <p>Un mot de passe à usage unique va être généré pour <strong>{toReset.email}</strong>.</p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Son mot de passe actuel ne fonctionnera plus et ses sessions ouvertes seront fermées. À sa prochaine
            connexion, il devra définir un nouveau mot de passe.
          </p>
        </Modal>
      )}

      {created && (
        <Modal
          title={created.reset ? 'Mot de passe réinitialisé' : 'Compte créé'}
          onClose={() => setCreated(null)}
          footer={<button className="btn btn-primary" onClick={() => setCreated(null)}>Terminé</button>}
        >
          <p>
            {created.reset ? 'Mot de passe à usage unique pour' : 'Le compte est créé :'} <strong>{created.email}</strong>
          </p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label>Mot de passe à usage unique</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input mono" readOnly value={created.password} onFocus={(e) => e.target.select()} />
              <button
                className="btn"
                onClick={() => { void navigator.clipboard.writeText(created.password); toast('Mot de passe copié.', 'success'); }}
              >
                <Copy size={14} /> Copier
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Il n'est affiché qu'une seule fois. L'utilisateur devra définir un nouveau mot de passe dès sa connexion.{' '}
            {created.reset
              ? created.emailed
                ? 'Il lui a aussi été envoyé par email.'
                : "L'envoi d'emails n'est pas configuré : transmettez-le vous-même."
              : "Il sera aussi envoyé par email si l'envoi d'emails est configuré."}
          </p>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Détail d'un utilisateur

function UserDetail({
  user,
  users,
  quotations,
  onBack,
  onOpen,
}: {
  user: UserDoc;
  users: UserDoc[];
  quotations: QuotationWithRelations[];
  onBack: () => void;
  onOpen: (q: QuotationWithRelations) => void;
}) {
  const mine = quotations.filter((q) => q.created_by === user._id);
  return (
    <div>
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 12 }}><ArrowLeft size={16} /> Retour</button>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>{user.email}</h2>
      <p className="text-muted" style={{ marginBottom: 20, fontSize: 13 }}>
        {user.role === 'admin' ? 'Admin' : 'Utilisateur'} · {user.status === 'active' ? 'Actif' : 'Désactivé'} · dernière connexion :{' '}
        {user.lastLoginAt ? formatDate(new Date(user.lastLoginAt).toISOString()) : 'jamais'}
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h3 style={{ fontSize: 16 }}>Quotations ({mine.length})</h3>
        </div>
        {mine.length === 0 ? (
          <StateBox title="Aucune quotation" subtitle="Cet utilisateur n'a pas encore créé de quotation." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Référence</th><th>Client</th><th>Région</th><th>Statut</th><th className="text-right">Total</th><th>Date</th></tr>
              </thead>
              <tbody>
                {mine.map((q) => (
                  <tr key={q.id} className="clickable" onClick={() => onOpen(q)}>
                    <td className="mono" style={{ fontWeight: 700 }}>{q.quotation_number}</td>
                    <td>{q.customer_name}</td>
                    <td>{q.countries?.code ?? '-'}</td>
                    <td><StatusTag status={q.status} /></td>
                    <td className="text-right mono">{formatAmount(q.total)}</td>
                    <td className="text-muted nowrap">{formatDate(q.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LogsTab users={users} onlyUserId={user._id} title="Activité de cet utilisateur" />
    </div>
  );
}

// ------------------------------------------------------------------ Journal d'activité

function LogsTab({ users, onlyUserId, title }: { users: UserDoc[]; onlyUserId?: string; title?: string }) {
  const [userFilter, setUserFilter] = React.useState('');
  const [search, setSearch] = React.useState('');
  const effectiveUser = onlyUserId ?? userFilter;
  const logs = useQuery(api.activityLogs.list, effectiveUser ? { userId: effectiveUser as Id<'users'>, limit: 300 } : { limit: 300 });
  const emailOf = React.useMemo(() => new Map(users.map((u) => [u._id as string, u.email ?? ''])), [users]);

  const term = search.trim().toLowerCase();
  const rows = (logs ?? []).filter((l) => {
    if (!term) return true;
    const text = `${actionLabel(l.action)} ${l.action} ${l.entityType} ${detailsOf(l.metadata)} ${l.userId ? emailOf.get(l.userId) ?? '' : ''}`.toLowerCase();
    return text.includes(term);
  });

  return (
    <div className="card">
      <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 16 }}>{title ?? "Journal d'activité"}</h3>
          <span className="text-muted" style={{ fontSize: 13 }}>{rows.length} événement(s) récent(s)</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!onlyUserId && (
            <select className="select" style={{ width: 240 }} value={userFilter} onChange={(e) => setUserFilter(e.target.value)} aria-label="Utilisateur">
              <option value="">Tous les utilisateurs</option>
              {users.map((u) => <option key={u._id} value={u._id}>{u.email}</option>)}
            </select>
          )}
          <input className="input" style={{ width: 240 }} placeholder="Rechercher…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>
      {logs === undefined ? (
        <StateBox loading title="Chargement…" />
      ) : rows.length === 0 ? (
        <StateBox title="Aucune activité" />
      ) : (
        <div className="table-scroll" style={{ maxHeight: '60vh', border: 'none', borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr><th>Date</th>{!onlyUserId && <th>Utilisateur</th>}<th>Action</th><th>Détails</th></tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l._id}>
                  <td className="text-muted nowrap">{formatDate(new Date(l.createdAt).toISOString())}</td>
                  {!onlyUserId && <td>{l.userId ? emailOf.get(l.userId) ?? 'Utilisateur supprimé' : 'Système'}</td>}
                  <td style={{ fontWeight: 600 }}>{actionLabel(l.action)}</td>
                  <td className="text-muted" style={{ fontSize: 12, maxWidth: 420 }}>{detailsOf(l.metadata) || l.entityType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Devises

/** Liste des devises : sert à choisir la devise d'une région et la devise cible de conversion du fichier exporté. */
function CurrenciesTab({ currencies }: { currencies: Currency[] }) {
  const toast = useToast();
  const createCurrency = useMutation(api.currencies.create);
  const updateCurrency = useMutation(api.currencies.update);
  const seedAllKnown = useMutation(api.currencies.seedAllKnownFromAdmin);
  const [showAdd, setShowAdd] = React.useState(false);
  const [code, setCode] = React.useState('');
  const [name, setName] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [seeding, setSeeding] = React.useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await createCurrency({ code, name });
      toast('Devise ajoutée.', 'success');
      setShowAdd(false);
      setCode(''); setName('');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const seedAll = async () => {
    setSeeding(true);
    try {
      const { created } = await seedAllKnown({});
      toast(created.length > 0 ? `${created.length} devise(s) ajoutée(s).` : 'Toutes les devises connues sont déjà présentes.', 'success');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSeeding(false);
    }
  };

  const edit = (c: Currency, patch: { name?: string; active?: boolean }) =>
    updateCurrency({ currencyId: c.id as Id<'currencies'>, ...patch }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'));

  return (
    <>
      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ fontSize: 16 }}>Devises</h3>
            <span className="text-muted" style={{ fontSize: 13 }}>
              Devises disponibles pour les régions et pour la conversion du fichier exporté (code ISO 4217 exact requis : le taux de change en ligne s'appuie dessus).
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" onClick={() => void seedAll()} disabled={seeding} title="Ajoute toutes les devises ISO 4217 manquantes, sans toucher à celles déjà présentes.">
              {seeding ? 'Chargement…' : 'Charger toutes les devises ISO'}
            </button>
            <button className="btn btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Ajouter une devise</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Code</th><th>Nom</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              {currencies.map((c) => (
                <tr key={c.id}>
                  <td className="mono" style={{ fontWeight: 700 }}>{c.code}</td>
                  <td style={{ minWidth: 240 }}>
                    <input key={c.name} className="input cell-input" style={{ width: '100%' }} defaultValue={c.name}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.name) void edit(c, { name: v }); else e.target.value = c.name; }} />
                  </td>
                  <td><span className={`tag ${c.active ? 'tag-new' : 'tag-same'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                  <td className="text-right">
                    <button className="btn btn-ghost btn-sm" onClick={() => void edit(c, { active: !c.active })}>{c.active ? 'Désactiver' : 'Activer'}</button>
                  </td>
                </tr>
              ))}
              {currencies.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ padding: 24 }}>Aucune devise. Ajoutez-en une.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {showAdd && (
        <Modal
          title="Ajouter une devise"
          onClose={() => !saving && setShowAdd(false)}
          footer={<>
            <button className="btn" onClick={() => setShowAdd(false)} disabled={saving}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>{saving ? 'Ajout…' : 'Ajouter'}</button>
          </>}
        >
          <div className="form-field"><label>Code (3 lettres)</label><input className="input mono" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={3} placeholder="XAF" autoFocus /></div>
          <div className="form-field"><label>Nom</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Franc CFA (CEMAC)" /></div>
        </Modal>
      )}
    </>
  );
}

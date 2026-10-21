import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { Ban, Building2, CalendarPlus, Copy, KeyRound, LogOut, Palette, Pencil, PauseCircle, PlayCircle, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import { applyTheme } from '../lib/theme';
import { setLanguage } from '../lib/i18n';
import { useBranding } from '../lib/branding';
import { formatDate } from '../lib/format';
import { Modal, StateBox } from '../components/ui';
import { useToast } from '../components/Toast';
import { BrandingTab } from './BrandingTab';
import { SubscriptionCountdown } from '../components/SubscriptionCountdown';
import { Settings } from './Settings';
import type { AppUser } from '../types';

type PlatformView = 'companies' | 'branding' | 'settings';

const longDate = (ms: number) => new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(ms));

const errMsg = (err: unknown) => (err instanceof Error ? err.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] : String(err));

/** « Société Générale SA » -> « societe-generale-sa » : proposition de code à partir du nom. */
const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);

/** Espace du super administrateur : aucune donnée métier, seulement les entreprises et l'identité de la plateforme. */
export function PlatformApp({ me }: { me: AppUser }) {
  const { signOut } = useAuthActions();
  const brand = useBranding();
  const [view, setView] = React.useState<PlatformView>('companies');
  const [confirmLogout, setConfirmLogout] = React.useState(false);

  const items: Array<{ id: PlatformView; label: string; icon: React.ReactNode }> = [
    { id: 'companies', label: 'Entreprises', icon: <Building2 size={18} /> },
    { id: 'branding', label: 'Page de connexion', icon: <Palette size={18} /> },
    { id: 'settings', label: 'Réglages', icon: <SettingsIcon size={18} /> },
  ];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo"><img src={brand.logoUrl} alt={brand.name} /></div>
          <div className="brand-text">
            <div className="brand-name" title={brand.name}>{brand.name}</div>
            <div className="brand-sub">Super administration</div>
          </div>
        </div>
        {items.map((it) => (
          <button key={it.id} className={`nav-item ${view === it.id ? 'active' : ''}`} onClick={() => setView(it.id)}>
            {it.icon}
            {it.label}
          </button>
        ))}
        <div className="sidebar-foot">
          <div className="who">{me.email}</div>
          <button className="nav-item" onClick={() => setConfirmLogout(true)}>
            <LogOut size={18} /> Déconnexion
          </button>
        </div>
      </aside>
      <main className="main">
        {view === 'companies' && <CompaniesView />}
        {view === 'branding' && (
          <div>
            <div className="page-header">
              <div>
                <h1 className="page-title">Page de connexion</h1>
                <span className="text-muted" style={{ fontSize: 13 }}>
                  Nom, logo et couleur affichés sur la page de connexion, vue par toutes les entreprises. Une fois connectés, les
                  utilisateurs voient l'identité définie par l'administrateur de leur entreprise.
                </span>
              </div>
            </div>
            <BrandingTab platform />
          </div>
        )}
        {view === 'settings' && <Settings me={me} />}
      </main>
      {confirmLogout && (
        <Modal
          title="Se déconnecter ?"
          onClose={() => setConfirmLogout(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmLogout(false)}>Annuler</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                applyTheme('light');
                setLanguage('fr');
                void signOut();
              }}
            >
              Se déconnecter
            </button>
          </>}
        >
          <p>Vous devrez vous reconnecter pour accéder à la super administration.</p>
        </Modal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Entreprises

interface Secret { title: string; email: string; password: string; intro: string }

function CompaniesView() {
  const toast = useToast();
  const companies = useQuery(api.platform.listCompanies);
  const createCompany = useMutation(api.platform.createCompany);
  const renameCompany = useMutation(api.platform.renameCompany);
  const setStatus = useMutation(api.platform.setCompanyStatus);
  const resetAdmin = useMutation(api.platform.resetCompanyAdminPassword);
  const renew = useMutation(api.platform.renewSubscription);
  const terminate = useMutation(api.platform.terminateSubscription);
  const removeCompany = useMutation(api.platform.deleteCompany);

  type Company = NonNullable<typeof companies>[number];
  const [showCreate, setShowCreate] = React.useState(false);
  const [toRename, setToRename] = React.useState<Company | null>(null);
  const [toSuspend, setToSuspend] = React.useState<Company | null>(null);
  const [toReset, setToReset] = React.useState<Company | null>(null);
  // Actions confirmées par le mot de passe du super admin : renouveler (nombre de mois), résilier, supprimer.
  const [toRenew, setToRenew] = React.useState<Company | null>(null);
  const [toTerminate, setToTerminate] = React.useState<Company | null>(null);
  const [toDelete, setToDelete] = React.useState<Company | null>(null);
  const [toReactivate, setToReactivate] = React.useState<Company | null>(null);
  const [months, setMonths] = React.useState('1');
  const [password, setPassword] = React.useState('');
  const [secret, setSecret] = React.useState<Secret | null>(null);
  const [busy, setBusy] = React.useState(false);

  // formulaires
  const [name, setName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [codeEdited, setCodeEdited] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [reason, setReason] = React.useState('');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (err) { toast('Erreur: ' + errMsg(err), 'error'); } finally { setBusy(false); }
  };

  if (companies === undefined) return <StateBox loading variant="table" title="Chargement…" />;

  const active = companies.filter((c) => c.status === 'active').length;
  const totalUsers = companies.reduce((n, c) => n + c.users, 0);

  const closeCreate = () => { setShowCreate(false); setName(''); setCode(''); setCodeEdited(false); };

  const submitCreate = () => run(async () => {
    const res = await createCompany({ name, code });
    closeCreate();
    setSecret({
      title: 'Entreprise créée',
      email: res.adminEmail,
      password: res.tempPassword,
      intro: "Compte de l'administrateur de la nouvelle entreprise :",
    });
  });

  const submitRename = () => run(async () => {
    if (!toRename) return;
    await renameCompany({ companyId: toRename.id as Id<'companies'>, name: newName });
    toast('Entreprise renommée.', 'success');
    setToRename(null);
  });

  const submitSuspend = () => run(async () => {
    if (!toSuspend) return;
    await setStatus({ companyId: toSuspend.id as Id<'companies'>, status: 'suspended', reason, password });
    toast(`${toSuspend.name} est suspendue : ses utilisateurs sont déconnectés.`, 'success');
    closeSecure();
  });

  const submitReactivate = () => run(async () => {
    if (!toReactivate) return;
    await setStatus({ companyId: toReactivate.id as Id<'companies'>, status: 'active', password });
    toast(`${toReactivate.name} est réactivée.`, 'success');
    closeSecure();
  });

  const submitReset = () => run(async () => {
    if (!toReset) return;
    const res = await resetAdmin({ companyId: toReset.id as Id<'companies'> });
    setToReset(null);
    setSecret({ title: 'Mot de passe réinitialisé', email: res.email, password: res.tempPassword, intro: 'Mot de passe à usage unique pour' });
  });

  const closeSecure = () => { setToRenew(null); setToTerminate(null); setToDelete(null); setToReactivate(null); setToSuspend(null); setPassword(''); setMonths('1'); setReason(''); };

  const monthsNumber = Number(months);
  const monthsValid = Number.isInteger(monthsNumber) && monthsNumber >= 1 && monthsNumber <= 36;
  // Aperçu de la nouvelle échéance : à partir de l'échéance actuelle si elle n'est pas dépassée, sinon d'aujourd'hui.
  const renewPreview = (c: Company) => {
    const base = c.subscriptionEndsAt !== null && c.subscriptionEndsAt > Date.now() ? c.subscriptionEndsAt : Date.now();
    return base + monthsNumber * 30 * 86_400_000;
  };

  const submitRenew = () => run(async () => {
    if (!toRenew || !monthsValid) return;
    const res = await renew({ companyId: toRenew.id as Id<'companies'>, months: monthsNumber, password });
    toast(`Abonnement de ${toRenew.name} prolongé de ${monthsNumber} mois, jusqu'au ${longDate(res.subscriptionEndsAt)}${res.reactivated ? ' : entreprise réactivée.' : '.'}`, 'success');
    closeSecure();
  });

  const submitTerminate = () => run(async () => {
    if (!toTerminate) return;
    await terminate({ companyId: toTerminate.id as Id<'companies'>, password });
    toast(`Abonnement de ${toTerminate.name} résilié : l'accès est coupé.`, 'success');
    closeSecure();
  });

  const submitDelete = () => run(async () => {
    if (!toDelete) return;
    const res = await removeCompany({ companyId: toDelete.id as Id<'companies'>, password });
    toast(`Suppression de ${res.name} lancée : ses données sont effacées en arrière-plan.`, 'success');
    closeSecure();
  });

  const adminPreview = `admin@${(code || 'code').trim().toLowerCase()}.dev`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Entreprises</h1>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {companies.length} entreprise(s) · {active} active(s) · {totalUsers} compte(s)
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> Créer une entreprise</button>
      </div>

      <div className="card">
        {companies.length === 0 ? (
          <StateBox title="Aucune entreprise" subtitle="Créez la première entreprise pour qu'elle puisse utiliser l'application." />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Entreprise</th>
                  <th>Administrateur</th>
                  <th>Statut</th>
                  <th>Abonnement</th>
                  <th className="text-right">Comptes</th>
                  <th className="text-right">Quotations</th>
                  <th>Dernière connexion</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {companies.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="text-muted mono" style={{ fontSize: 12 }}>{c.code}</div>
                    </td>
                    <td className="text-muted">{c.adminEmail ?? '·'}</td>
                    <td>
                      <span className={`tag ${c.status === 'active' ? 'tag-new' : 'tag-warn'}`}>{c.status === 'active' ? 'Active' : c.suspendKind === 'deleting' ? 'Suppression en cours' : c.suspendKind === 'subscription' ? 'Abonnement expiré' : 'Suspendue'}</span>
                      {c.status === 'suspended' && c.suspendReason && (
                        <div className="text-muted" style={{ fontSize: 12, marginTop: 4, maxWidth: 220 }}>{c.suspendReason}</div>
                      )}
                    </td>
                    <td className="nowrap">
                      {c.subscriptionEndsAt === null ? (
                        <span className="text-muted">Sans échéance</span>
                      ) : (
                        <>
                          <div>{longDate(c.subscriptionEndsAt)}</div>
                          <div style={{ fontSize: 12 }}><SubscriptionCountdown endsAt={c.subscriptionEndsAt} /></div>
                        </>
                      )}
                    </td>
                    <td className="text-right mono">{c.activeUsers}/{c.users}</td>
                    <td className="text-right mono">{c.orders}{c.ordersCapped ? '+' : ''}</td>
                    <td className="text-muted nowrap">{c.lastLoginAt ? formatDate(new Date(c.lastLoginAt).toISOString()) : 'Jamais'}</td>
                    <td className="text-right nowrap">
                      {c.suspendKind === 'deleting' ? (
                        <span className="text-muted" style={{ fontSize: 13 }}>Suppression en cours…</span>
                      ) : (
                        <>
                          <button className="btn btn-ghost btn-sm" title="Prolonger l'abonnement (nombre de mois au choix)" onClick={() => { setToRenew(c); setMonths('1'); setPassword(''); }} disabled={busy}>
                            <CalendarPlus size={14} /> Renouveler
                          </button>
                          {c.status === 'active' && c.subscriptionEndsAt !== null && (
                            <button className="btn btn-ghost btn-sm" title="Résilier l'abonnement : l'accès est coupé tout de suite" onClick={() => { setToTerminate(c); setPassword(''); }} disabled={busy}>
                              <Ban size={14} /> Résilier
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" title="Renommer" onClick={() => { setToRename(c); setNewName(c.name); }}>
                            <Pencil size={14} />
                          </button>
                          <button className="btn btn-ghost btn-sm" title="Générer un mot de passe à usage unique pour l'administrateur" onClick={() => setToReset(c)} disabled={!c.adminEmail}>
                            <KeyRound size={14} />
                          </button>
                          {c.status === 'active' ? (
                            <button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} onClick={() => { setToSuspend(c); setReason(''); setPassword(''); }}>
                              <PauseCircle size={14} /> Suspendre
                            </button>
                          ) : (
                            <button className="btn btn-ghost btn-sm" onClick={() => { setToReactivate(c); setPassword(''); }} disabled={busy}>
                              <PlayCircle size={14} /> Réactiver
                            </button>
                          )}
                          <button className="btn btn-ghost btn-sm" style={{ color: '#b91c1c' }} title="Supprimer définitivement l'entreprise et toutes ses données" onClick={() => { setToDelete(c); setPassword(''); }} disabled={busy}>
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {toRenew && (
        <Modal
          title={`Renouveler l'abonnement de ${toRenew.name}`}
          onClose={() => !busy && closeSecure()}
          footer={<>
            <button className="btn" onClick={closeSecure} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitRenew()} disabled={busy || !monthsValid || !password}>
              {busy ? 'Renouvellement…' : 'Renouveler'}
            </button>
          </>}
        >
          <div className="form-field" style={{ marginBottom: 8 }}>
            <label>Nombre de mois (1 mois = 30 jours)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {[1, 3, 6, 12].map((m) => (
                <button key={m} type="button" className={`btn btn-sm ${monthsNumber === m ? 'btn-primary' : ''}`} onClick={() => setMonths(String(m))}>{m}</button>
              ))}
              <input className="input" type="number" min={1} max={36} step={1} style={{ width: 90 }} value={months} onChange={(e) => setMonths(e.target.value)} aria-label="Nombre de mois" />
            </div>
            {!monthsValid && <span style={{ fontSize: 12, color: 'var(--color-error)' }}>Entre 1 et 36 mois.</span>}
          </div>
          {monthsValid && (
            <p style={{ margin: '8px 0 0' }}>
              Nouvelle échéance : <strong>{longDate(renewPreview(toRenew))}</strong>
              {toRenew.status === 'suspended' && toRenew.suspendKind === 'subscription' ? ' — l\'entreprise sera réactivée.' : '.'}
            </p>
          )}
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Votre mot de passe (super administrateur)</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Pour confirmer cette action.</span>
          </div>
        </Modal>
      )}

      {toTerminate && (
        <Modal
          title={`Résilier l'abonnement de ${toTerminate.name} ?`}
          onClose={() => !busy && closeSecure()}
          footer={<>
            <button className="btn" onClick={closeSecure} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void submitTerminate()} disabled={busy || !password}>
              {busy ? 'Résiliation…' : 'Résilier'}
            </button>
          </>}
        >
          <p>
            L'abonnement prend fin <strong>immédiatement</strong> : les {toTerminate.activeUsers} compte(s) actif(s) sont déconnectés et ne peuvent plus
            se connecter. Aucune donnée n'est supprimée ; un renouvellement rétablit l'accès.
          </p>
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Votre mot de passe (super administrateur)</label>
            <input className="input" type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Pour confirmer cette action.</span>
          </div>
        </Modal>
      )}

      {toDelete && (
        <Modal
          title={`Supprimer définitivement ${toDelete.name} ?`}
          onClose={() => !busy && closeSecure()}
          footer={<>
            <button className="btn" onClick={closeSecure} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void submitDelete()} disabled={busy || !password}>
              {busy ? 'Suppression…' : 'Supprimer définitivement'}
            </button>
          </>}
        >
          <p>
            <strong>Action irréversible.</strong> Seront effacés pour toujours : les {toDelete.users} compte(s) et leurs connexions, les clients, le catalogue
            et les prix, les {toDelete.orders}{toDelete.ordersCapped ? '+' : ''} quotation(s) avec leurs fichiers, les réglages et le journal de {toDelete.name}.
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            L'entreprise est bloquée aussitôt ; l'effacement se fait en arrière-plan et peut prendre quelques minutes pour un grand catalogue.
            Pensez à faire une sauvegarde avant.
          </p>
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Votre mot de passe (super administrateur)</label>
            <input className="input" type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Pour confirmer cette action.</span>
          </div>
        </Modal>
      )}

      {showCreate && (
        <Modal
          title="Créer une entreprise"
          onClose={() => !busy && closeCreate()}
          footer={<>
            <button className="btn" onClick={closeCreate} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitCreate()} disabled={busy || !name.trim() || !code.trim()}>
              {busy ? 'Création…' : 'Créer'}
            </button>
          </>}
        >
          <div className="form-field">
            <label>Nom de l'entreprise</label>
            <input
              className="input"
              value={name}
              maxLength={80}
              autoFocus
              onChange={(e) => { setName(e.target.value); if (!codeEdited) setCode(slugify(e.target.value)); }}
            />
          </div>
          <div className="form-field">
            <label>Code</label>
            <input
              className="input mono"
              value={code}
              maxLength={30}
              onChange={(e) => { setCode(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')); setCodeEdited(true); }}
            />
            <span className="text-muted" style={{ fontSize: 12 }}>
              Minuscules, chiffres et tirets. Le compte administrateur sera <strong>{adminPreview}</strong> ; les autres comptes
              suivent de préférence le modèle prenom@{code || 'code'}.dev.
            </span>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Le catalogue produits de la nouvelle entreprise commence vide ; les devises, régions et catégories sont reprises de la première entreprise.
          </p>
        </Modal>
      )}

      {toRename && (
        <Modal
          title="Renommer l'entreprise"
          onClose={() => !busy && setToRename(null)}
          footer={<>
            <button className="btn" onClick={() => setToRename(null)} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitRename()} disabled={busy || !newName.trim()}>Enregistrer</button>
          </>}
        >
          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>Nom de l'entreprise</label>
            <input className="input" value={newName} maxLength={80} autoFocus onChange={(e) => setNewName(e.target.value)} />
          </div>
        </Modal>
      )}

      {toSuspend && (
        <Modal
          title={`Suspendre ${toSuspend.name} ?`}
          onClose={() => !busy && closeSecure()}
          footer={<>
            <button className="btn" onClick={closeSecure} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void submitSuspend()} disabled={busy || reason.trim().length < 3 || !password}>
              {busy ? 'Suspension…' : 'Suspendre'}
            </button>
          </>}
        >
          <p>
            Les {toSuspend.activeUsers} compte(s) actif(s) de cette entreprise seront refusés à la connexion et ceux qui sont
            connectés seront renvoyés à la page de connexion aussitôt. Aucune donnée n'est supprimée : la réactivation rétablit tout.
          </p>
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Motif de la suspension</label>
            <input className="input" value={reason} maxLength={300} autoFocus placeholder="Ex. : paiement non reçu, demande du client…" onChange={(e) => setReason(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Obligatoire. Ce texte sera montré aux personnes qui tentent de se connecter à cette entreprise.</span>
          </div>
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Votre mot de passe (super administrateur)</label>
            <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Pour confirmer cette action.</span>
          </div>
        </Modal>
      )}

      {toReactivate && (
        <Modal
          title={`Réactiver ${toReactivate.name} ?`}
          onClose={() => !busy && closeSecure()}
          footer={<>
            <button className="btn" onClick={closeSecure} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitReactivate()} disabled={busy || !password}>
              {busy ? 'Réactivation…' : 'Réactiver'}
            </button>
          </>}
        >
          <p>Les comptes de l'entreprise pourront de nouveau se connecter et retrouveront leurs données.</p>
          <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
            <label>Votre mot de passe (super administrateur)</label>
            <input className="input" type="password" autoComplete="current-password" value={password} autoFocus onChange={(e) => setPassword(e.target.value)} />
            <span className="text-muted" style={{ fontSize: 12 }}>Pour confirmer cette action.</span>
          </div>
        </Modal>
      )}

      {toReset && (
        <Modal
          title="Réinitialiser le mot de passe ?"
          onClose={() => !busy && setToReset(null)}
          footer={<>
            <button className="btn" onClick={() => setToReset(null)} disabled={busy}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitReset()} disabled={busy}>
              {busy ? 'Génération…' : 'Générer le mot de passe'}
            </button>
          </>}
        >
          <p>Un mot de passe à usage unique va être généré pour <strong>{toReset.adminEmail}</strong>, administrateur de {toReset.name}.</p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Son mot de passe actuel ne fonctionnera plus et ses sessions ouvertes seront fermées.
          </p>
        </Modal>
      )}

      {secret && (
        <Modal title={secret.title} onClose={() => setSecret(null)} footer={<button className="btn btn-primary" onClick={() => setSecret(null)}>Terminé</button>}>
          <p>{secret.intro} <strong>{secret.email}</strong></p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label>Mot de passe à usage unique</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input mono" readOnly value={secret.password} onFocus={(e) => e.target.select()} />
              <button className="btn" onClick={() => { void navigator.clipboard.writeText(secret.password); toast('Mot de passe copié.', 'success'); }}>
                <Copy size={14} /> Copier
              </button>
            </div>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Il n'est affiché qu'une seule fois et n'est envoyé par email à personne : transmettez-le vous-même. L'administrateur devra
            définir un nouveau mot de passe dès sa connexion.
          </p>
        </Modal>
      )}
    </div>
  );
}

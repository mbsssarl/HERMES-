import React from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Download, FlaskConical, Plus, Trash2 } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import { saveBase64File } from '../lib/exportFile';
import { ITEM_TOKENS, SCALAR_TOKENS } from '../../convex/lib/export/templateTokens';
import { Modal, StateBox } from './ui';
import { useToast } from './Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const formatSize = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} Ko` : `${(bytes / 1024 / 1024).toFixed(1)} Mo`);

/**
 * Modèles d'export : fichiers Excel importés par l'admin, utilisés pour le fichier envoyé aux fournisseurs. Le modèle
 * par défaut sert à tout le monde ; l'utilisateur peut en choisir un autre au moment de l'export.
 */
export function ExportTemplatesTab() {
  const toast = useToast();
  const templates = useQuery(api.exportTemplates.list);
  const setDefault = useMutation(api.exportTemplates.setDefault);
  const remove = useMutation(api.exportTemplates.remove);
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const register = useAction(api.exportTemplatesNode.register);
  const download = useAction(api.exportTemplatesNode.download);
  const baseTemplate = useAction(api.exportTemplatesNode.baseTemplate);
  const test = useAction(api.exportTemplatesNode.test);

  const [showImport, setShowImport] = React.useState(false);
  const [showTokens, setShowTokens] = React.useState(false);
  const [file, setFile] = React.useState<File | null>(null);
  const [name, setName] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null); // action en cours (identifiant du modèle ou « import »)
  const [toDelete, setToDelete] = React.useState<{ id: string; name: string } | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  if (templates === undefined) return <StateBox loading variant="table" title="Chargement…" />;
  const builtinIsDefault = !templates.some((t) => t.isDefault);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try { await task(); } catch (err) { toast('Erreur: ' + errMsg(err), 'error'); } finally { setBusy(null); }
  };

  const closeImport = () => { if (busy === 'import') return; setShowImport(false); setFile(null); setName(''); };

  const submitImport = () =>
    run('import', async () => {
      if (!file) return;
      const url = await generateUploadUrl();
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
      if (!res.ok) throw new Error("Échec de l'envoi du fichier.");
      const { storageId } = (await res.json()) as { storageId: Id<'_storage'> };
      const { warnings } = await register({ storageId, name: name.trim(), fileName: file.name });
      toast('Modèle importé.', 'success');
      if (warnings.length > 0) toast(warnings.join(' '), 'info', { duration: 10000 });
      setShowImport(false); setFile(null); setName('');
    });

  return (
    <>
      <div className="card">
        <div className="card-pad card-head">
          <div><h3 style={{ fontSize: 16 }}>Modèles d'export · {templates.length + 1}</h3></div>
          <div className="toolbar-actions">
            <button className="btn" onClick={() => setShowTokens(true)}>Repères</button>
            <button className="btn" disabled={busy !== null} onClick={() => void run('base', async () => { const f = await baseTemplate({}); saveBase64File(f.fileName, f.base64); })}>
              <Download size={16} /> Modèle de base
            </button>
            <button className="btn btn-primary" onClick={() => setShowImport(true)}><Plus size={16} /> Importer un modèle</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data cards">
            <thead><tr><th>Nom</th><th>Fichier</th><th>Statut</th><th></th></tr></thead>
            <tbody>
              <tr>
                <td className="c-main" style={{ fontWeight: 700 }}>Modèle intégré</td>
                <td className="text-muted" data-label="Fichier">·</td>
                <td data-label="Statut">{builtinIsDefault ? <span className="tag tag-new">Par défaut</span> : null}</td>
                <td className="text-right c-actions">
                  {!builtinIsDefault && (
                    <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void run('builtin', async () => { await setDefault({ templateId: null }); })}>Définir par défaut</button>
                  )}
                </td>
              </tr>
              {templates.map((t) => (
                <tr key={t.id}>
                  <td className="c-main" style={{ fontWeight: 700 }}>{t.name}</td>
                  <td className="text-muted" data-label="Fichier">{t.fileName} · {formatSize(t.size)}</td>
                  <td data-label="Statut">{t.isDefault ? <span className="tag tag-new">Par défaut</span> : null}</td>
                  <td className="text-right nowrap c-actions">
                    {!t.isDefault && (
                      <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => void run(t.id, async () => { await setDefault({ templateId: t.id as Id<'exportTemplates'> }); })}>Définir par défaut</button>
                    )}
                    <button className="btn btn-ghost btn-sm" disabled={busy !== null} title="Génère un fichier d'essai avec des données fictives"
                      onClick={() => void run(t.id, async () => { const f = await test({ templateId: t.id as Id<'exportTemplates'> }); saveBase64File(f.fileName, f.base64, f.mime); })}>
                      <FlaskConical size={14} /> {busy === t.id ? 'Génération…' : 'Tester'}
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busy !== null} title="Télécharger le fichier du modèle"
                      onClick={() => void run(t.id, async () => { const f = await download({ templateId: t.id as Id<'exportTemplates'> }); saveBase64File(f.fileName, f.base64); })}>
                      <Download size={14} />
                    </button>
                    <button className="btn btn-ghost btn-sm" disabled={busy !== null} style={{ color: '#b91c1c' }} title="Supprimer" onClick={() => setToDelete({ id: t.id, name: t.name })}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showImport && (
        <Modal
          title="Importer un modèle"
          onClose={closeImport}
          footer={<>
            <button className="btn" onClick={closeImport} disabled={busy === 'import'}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submitImport()} disabled={!file || busy === 'import'}>{busy === 'import' ? 'Import…' : 'Importer'}</button>
          </>}
        >
          <div className="form-field">
            <label>Fichier Excel (.xlsx)</label>
            <input
              ref={input}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                setFile(f);
                if (f && !name.trim()) setName(f.name.replace(/\.xlsx$/i, ''));
              }}
            />
          </div>
          <div className="form-field">
            <label>Nom du modèle</label>
            <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>
        </Modal>
      )}

      {showTokens && (
        <Modal title="Repères d'un modèle" onClose={() => setShowTokens(false)} wide footer={<button className="btn" onClick={() => setShowTokens(false)}>Fermer</button>}>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
            Écrivez un repère dans une cellule, par exemple {'{{vessel}}'} : il est remplacé à l'export. Les repères d'article se placent sur une seule ligne, répétée pour chaque article.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
            <TokenList title="Généraux" tokens={SCALAR_TOKENS} />
            <TokenList title="Ligne d'article" tokens={ITEM_TOKENS} />
          </div>
        </Modal>
      )}

      {toDelete && (
        <Modal
          title="Supprimer ce modèle ?"
          onClose={() => setToDelete(null)}
          footer={<>
            <button className="btn" onClick={() => setToDelete(null)}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#b91c1c' }} onClick={() => { const t = toDelete; setToDelete(null); void run(t.id, async () => { await remove({ templateId: t.id as Id<'exportTemplates'> }); toast('Modèle supprimé.', 'success'); }); }}>Supprimer</button>
          </>}
        >
          <p style={{ margin: 0 }}>« {toDelete.name} » sera supprimé définitivement.</p>
        </Modal>
      )}
    </>
  );
}

function TokenList({ title, tokens }: { title: string; tokens: Record<string, string> }) {
  return (
    <div>
      <div className="section-title">{title}</div>
      <table className="data" style={{ fontSize: 13 }}>
        <tbody>
          {Object.entries(tokens).map(([key, label]) => (
            <tr key={key}>
              <td className="mono nowrap" style={{ fontWeight: 600 }}>{`{{${key}}}`}</td>
              <td className="text-muted">{label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

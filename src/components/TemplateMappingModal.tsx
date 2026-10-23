import React from 'react';
import { Plus, X } from 'lucide-react';
import { tokensFor, type TemplateKind } from '../../convex/lib/export/templateTokens';
import type { TemplateAnalysis, TemplateMapping } from '../../convex/lib/export/templateAuthoring';
import { Modal } from './ui';

const CELL_RE = /^[A-Z]{1,3}[1-9]\d*$/;
let nextId = 1;

/**
 * Fichier importé sans repères : l'application a repéré le tableau et les cases d'information ; l'admin vérifie ou
 * corrige l'association, puis l'application écrit elle-même les repères dans le fichier.
 */
export function TemplateMappingModal({
  kind,
  analysis,
  busy,
  onSubmit,
  onCancel,
}: {
  kind: TemplateKind;
  analysis: TemplateAnalysis;
  busy: boolean;
  onSubmit: (mapping: TemplateMapping) => void;
  onCancel: () => void;
}) {
  const { scalar: scalarTokens, item: itemTokens } = tokensFor(kind);
  const [columns, setColumns] = React.useState<Record<string, string>>(() => Object.fromEntries(analysis.columns.map((c) => [c.col, c.token])));
  const [modelRow, setModelRow] = React.useState(String(analysis.modelRow));
  const [endRow, setEndRow] = React.useState(String(analysis.endRow));
  const [fields, setFields] = React.useState(() => analysis.fields.map((f) => ({ id: nextId++, cell: f.cell, token: f.token, label: f.label, current: f.current })));
  // Sort de chaque image du fichier : la première (en général le logo) est proposée remplacée par le logo de l'entreprise.
  const [imageActions, setImageActions] = React.useState<Record<number, 'keep' | 'remove' | 'logo'>>(() =>
    Object.fromEntries(analysis.images.map((img, i) => [img.index, i === 0 ? 'logo' : 'keep'])),
  );

  const first = Number(modelRow);
  const last = Number(endRow);
  const rowsOk = Number.isInteger(first) && Number.isInteger(last) && first > analysis.headerRow && last >= first;
  const fieldsOk = fields.every((f) => !f.token || CELL_RE.test(f.cell.trim().toUpperCase()));
  const hasDescription = Object.values(columns).includes('item_description');
  const canSubmit = rowsOk && fieldsOk && hasDescription && !busy;

  const submit = () =>
    onSubmit({
      sheet: analysis.sheet,
      modelRow: first,
      endRow: last,
      columns,
      fields: fields.filter((f) => f.token).map((f) => ({ cell: f.cell.trim().toUpperCase(), token: f.token })),
      images: analysis.images.map((img) => ({ index: img.index, action: imageActions[img.index] ?? 'keep' })),
    });

  return (
    <Modal
      title="Associer le modèle"
      wide
      onClose={() => !busy && onCancel()}
      footer={<>
        <button className="btn" onClick={onCancel} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>{busy ? 'Création…' : 'Créer le modèle'}</button>
      </>}
    >
      <p className="text-muted" style={{ fontSize: 13, marginTop: 0 }}>
        Ce fichier n'a pas de repères : choisissez ce que contient chaque colonne du tableau (feuille « {analysis.sheet} », en-tête ligne {analysis.headerRow}).
      </p>

      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Col.</th><th>En-tête</th><th>Exemple</th><th>Contenu</th></tr></thead>
          <tbody>
            {analysis.columns.map((c) => (
              <tr key={c.col}>
                <td className="mono">{c.col}</td>
                <td>{c.header}</td>
                <td className="text-muted">{c.sample || (c.formula ? 'formule' : '·')}</td>
                <td>
                  <select className="select" value={columns[c.col] ?? ''} onChange={(e) => setColumns((prev) => ({ ...prev, [c.col]: e.target.value }))}>
                    <option value="">{c.formula ? 'Formule conservée' : '— Ignorée —'}</option>
                    {Object.entries(itemTokens).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: 'flex', gap: 12, alignItems: 'end', flexWrap: 'wrap', margin: '14px 0' }}>
        <div className="form-field" style={{ margin: 0 }}>
          <label>Articles d'exemple : de la ligne</label>
          <input className="input" style={{ width: 90 }} inputMode="numeric" value={modelRow} onChange={(e) => setModelRow(e.target.value)} />
        </div>
        <div className="form-field" style={{ margin: 0 }}>
          <label>à la ligne</label>
          <input className="input" style={{ width: 90 }} inputMode="numeric" value={endRow} onChange={(e) => setEndRow(e.target.value)} />
        </div>
        <span className="text-muted" style={{ fontSize: 12, paddingBottom: 10 }}>Remplacés par vos articles ; la première ligne sert de modèle.</span>
      </div>

      <div className="section-title">Informations de l'en-tête</div>
      {fields.map((f) => (
        <div key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
          <input
            className="input mono"
            style={{ width: 80, borderColor: f.token && !CELL_RE.test(f.cell.trim().toUpperCase()) ? '#b91c1c' : undefined }}
            value={f.cell}
            placeholder="D10"
            onChange={(e) => setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, cell: e.target.value } : x)))}
          />
          <select className="select" style={{ minWidth: 220 }} value={f.token} onChange={(e) => setFields((prev) => prev.map((x) => (x.id === f.id ? { ...x, token: e.target.value } : x)))}>
            <option value="">— Ignorée —</option>
            {Object.entries(scalarTokens).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
          <span className="text-muted" style={{ fontSize: 12, flex: 1, minWidth: 120 }}>{f.label ? `${f.label}${f.current ? ` : ${f.current}` : ''}` : ''}</span>
          <button className="btn btn-ghost btn-sm" title="Retirer" onClick={() => setFields((prev) => prev.filter((x) => x.id !== f.id))}><X size={14} /></button>
        </div>
      ))}
      <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => setFields((prev) => [...prev, { id: nextId++, cell: '', token: '', label: '', current: '' }])}>
        <Plus size={14} /> Ajouter une cellule
      </button>

      {analysis.images.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 16 }}>Images du fichier</div>
          {analysis.images.map((img, i) => (
            <div key={img.index} style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '8px 0', flexWrap: 'wrap' }}>
              {img.thumbnail
                ? <img src={img.thumbnail} alt="" style={{ height: 44, maxWidth: 110, objectFit: 'contain', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6 }} />
                : <div style={{ height: 44, width: 60, background: '#f3f4f6', borderRadius: 6 }} />}
              <span className="text-muted" style={{ fontSize: 13, minWidth: 90 }}>Image {i + 1} · {img.range}</span>
              <select className="select" value={imageActions[img.index] ?? 'keep'} onChange={(e) => setImageActions((prev) => ({ ...prev, [img.index]: e.target.value as 'keep' | 'remove' | 'logo' }))}>
                <option value="logo">Remplacer par le logo de l'entreprise</option>
                <option value="keep">Conserver</option>
                <option value="remove">Retirer</option>
              </select>
            </div>
          ))}
        </>
      )}
      {!hasDescription && <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 0 }}>Choisissez la colonne de la désignation des articles.</p>}
      {!rowsOk && <p style={{ color: '#b91c1c', fontSize: 13, marginBottom: 0 }}>Lignes d'exemple invalides.</p>}
    </Modal>
  );
}

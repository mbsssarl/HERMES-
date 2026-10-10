import React from 'react';
import { useMutation, useQuery } from 'convex/react';
import { ImagePlus, RotateCcw } from 'lucide-react';
import { api, type Id } from '../lib/convex';
import { DEFAULT_LOGO } from '../lib/branding';
import { ACCENT_PRESETS, DEFAULT_ACCENT, accentVars } from '../lib/accent';
import { StateBox } from '../components/ui';
import { useToast } from '../components/Toast';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
const errMsg = (err: unknown) => (err instanceof Error ? err.message.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0] : String(err));

/** Personnalisation : le nom et le logo de l'entreprise, repris dans le menu, les pages de connexion et le titre de l'onglet. */
export function BrandingTab() {
  const toast = useToast();
  const branding = useQuery(api.branding.get, {});
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const save = useMutation(api.branding.set);

  const [name, setName] = React.useState<string | null>(null); // null = pas encore modifié
  const [file, setFile] = React.useState<File | null>(null);
  const [resetLogo, setResetLogo] = React.useState(false);
  const [accent, setAccent] = React.useState<string | null>(null); // null = pas encore modifiée
  const [saving, setSaving] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  const preview = React.useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  React.useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  if (branding === undefined) return <StateBox loading variant="table" title="Chargement…" />;

  const currentName = name ?? (branding.customName ? branding.name : '');
  const shownLogo = preview ?? (resetLogo ? DEFAULT_LOGO : branding.logoUrl ?? DEFAULT_LOGO);
  const shownName = currentName.trim() || branding.defaultName;
  const nameChanged = currentName.trim() !== (branding.customName ? branding.name : '');
  const savedAccent = (branding.accentColor ?? DEFAULT_ACCENT).toLowerCase();
  const currentAccent = (accent ?? savedAccent).toLowerCase();
  const accentChanged = currentAccent !== savedAccent;
  const isPreset = ACCENT_PRESETS.some((p) => p.hex === currentAccent);
  const previewVars = accentVars(currentAccent);
  const dark = document.documentElement.dataset.theme === 'dark';
  const dirty = nameChanged || file !== null || resetLogo || accentChanged;

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!LOGO_TYPES.includes(f.type)) { toast('Format non autorisé : PNG, JPEG, WebP ou SVG.', 'error'); return; }
    if (f.size > MAX_LOGO_BYTES) { toast('Logo trop volumineux (2 Mo maximum).', 'error'); return; }
    setFile(f);
    setResetLogo(false);
  };

  const submit = async () => {
    setSaving(true);
    try {
      let logoStorageId: Id<'_storage'> | undefined;
      if (file) {
        const url = await generateUploadUrl();
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
        if (!res.ok) throw new Error("Échec de l'envoi du logo.");
        logoStorageId = ((await res.json()) as { storageId: Id<'_storage'> }).storageId;
      }
      await save({
        name: currentName,
        logoStorageId,
        removeLogo: resetLogo && !file ? true : undefined,
        accentColor: accentChanged ? (currentAccent === DEFAULT_ACCENT ? null : currentAccent) : undefined,
      });
      toast('Personnalisation enregistrée.', 'success');
      setName(null);
      setFile(null);
      setResetLogo(false);
      setAccent(null);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasCustomLogo = branding.customLogo && !resetLogo;

  return (
    <div className="card card-pad" style={{ maxWidth: 760 }}>
      <div className="section-title">Identité de l'entreprise</div>

      <div className="branding-grid">
        <div>
          <div className="form-field">
            <label>Nom de l'entreprise</label>
            <input
              className="input"
              value={currentName}
              maxLength={60}
              placeholder={branding.defaultName}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-field" style={{ marginBottom: 0 }}>
            <label>Logo</label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" className="btn" onClick={() => input.current?.click()}>
                <ImagePlus size={16} /> {file ? 'Choisir un autre logo' : 'Choisir un logo'}
              </button>
              {(hasCustomLogo || file) && (
                <button type="button" className="btn btn-ghost" onClick={() => { setFile(null); setResetLogo(true); }} disabled={!hasCustomLogo && !file}>
                  <RotateCcw size={16} /> Logo par défaut
                </button>
              )}
            </div>
            <input ref={input} type="file" accept={LOGO_TYPES.join(',')} style={{ display: 'none' }} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
            <span className="text-muted" style={{ fontSize: 12 }}>PNG, JPEG, WebP ou SVG, 2 Mo maximum. Un fond transparent ou blanc rend mieux.</span>
          </div>

          <div className="form-field" style={{ marginTop: 20, marginBottom: 0 }}>
            <label>Couleur de l'application</label>
            <div className="swatches" role="radiogroup" aria-label="Couleur de l'application">
              {ACCENT_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={currentAccent === p.hex}
                  className={`swatch ${currentAccent === p.hex ? 'active' : ''}`}
                  style={{ ['--sw' as string]: p.hex }}
                  title={p.label}
                  aria-label={p.label}
                  onClick={() => setAccent(p.hex)}
                />
              ))}
              <label className={`swatch swatch-custom ${!isPreset ? 'active' : ''}`} style={!isPreset ? { ['--sw' as string]: currentAccent } : undefined} title="Couleur personnalisée">
                <input type="color" value={currentAccent} onChange={(e) => setAccent(e.target.value)} aria-label="Couleur personnalisée" />
              </label>
            </div>
          </div>
        </div>

        <div className="branding-preview" aria-label="Aperçu" style={{ ['--color-primary' as string]: dark ? previewVars.dark : previewVars.light }}>
          <div className="brand">
            <div className="brand-logo"><img src={shownLogo} alt="" /></div>
            <div className="brand-text">
              <div className="brand-name">{shownName}</div>
              <div className="brand-sub">Aperçu</div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
        <button
          className="btn"
          disabled={!dirty || saving}
          onClick={() => { setName(null); setFile(null); setResetLogo(false); setAccent(null); }}
        >
          Annuler les modifications
        </button>
        <button className="btn btn-primary" disabled={!dirty || saving} onClick={() => void submit()}>
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}

import React from 'react';
import { useMutation } from 'convex/react';
import { Moon, Sun } from 'lucide-react';
import { api } from '../lib/convex';
import type { AppUser } from '../types';
import { applyTheme, type Theme } from '../lib/theme';
import { useToast } from '../components/Toast';

const errText = (err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0].trim() || 'Une erreur est survenue.';
};

/** Réglages personnels : mot de passe et thème de l'interface. */
export function Settings({ me }: { me: AppUser }) {
  const toast = useToast();
  const changePassword = useMutation(api.users.changeMyPassword);
  const setThemeOnAccount = useMutation(api.users.setTheme);

  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const theme: Theme = me.theme;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { toast('Les mots de passe ne correspondent pas.', 'error'); return; }
    setSaving(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      toast('Mot de passe mis à jour.', 'success');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      toast(errText(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  const chooseTheme = (value: Theme) => {
    applyTheme(value); // effet immédiat
    setThemeOnAccount({ theme: value }).catch((err) => toast(errText(err), 'error'));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Réglages</h1>
          <p className="page-subtitle">{me.email} · {me.role === 'admin' ? 'Admin' : 'Utilisateur'}</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <form className="card card-pad" onSubmit={submit}>
          <div className="section-title">Mot de passe</div>
          <div className="form-field">
            <label>Mot de passe actuel</label>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="form-field">
            <label>Nouveau mot de passe</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>8 caractères minimum</div>
          </div>
          <div className="form-field">
            <label>Confirmer le nouveau mot de passe</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={saving}>{saving ? 'Enregistrement…' : 'Mettre à jour le mot de passe'}</button>
          </div>
        </form>

        <div className="card card-pad">
          <div className="section-title">Apparence</div>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Le thème choisi est enregistré sur votre compte et s'applique sur tous vos appareils.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            {([
              ['light', 'Clair', <Sun size={18} key="s" />],
              ['dark', 'Sombre', <Moon size={18} key="m" />],
            ] as const).map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={`btn theme-choice ${theme === value ? 'btn-primary' : ''}`}
                onClick={() => chooseTheme(value)}
                aria-pressed={theme === value}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { useMutation } from 'convex/react';
import { Moon, Sun } from 'lucide-react';
import { api } from '../lib/convex';
import type { AppUser } from '../types';
import { applyTheme, type Theme } from '../lib/theme';
import { setLanguage, useT, type Language } from '../lib/i18n';
import { useToast } from '../components/Toast';

const errText = (err: unknown) => {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0].trim() || 'Une erreur est survenue.';
};

/** Réglages personnels : mot de passe, thème et langue de l'interface. */
export function Settings({ me }: { me: AppUser }) {
  const toast = useToast();
  const t = useT();
  const changePassword = useMutation(api.users.changeMyPassword);
  const setThemeOnAccount = useMutation(api.users.setTheme);
  const setLanguageOnAccount = useMutation(api.users.setLanguage);

  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [saving, setSaving] = React.useState(false);

  const theme: Theme = me.theme;
  const language: Language = me.language;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) { toast(t('settings.passwordMismatch'), 'error'); return; }
    setSaving(true);
    try {
      await changePassword({ currentPassword: current, newPassword: next });
      toast(t('settings.passwordUpdated'), 'success');
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

  const chooseLanguage = (value: Language) => {
    setLanguage(value); // effet immédiat : toute l'interface se redessine
    setLanguageOnAccount({ language: value }).catch((err) => toast(errText(err), 'error'));
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t('settings.title')}</h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 20, alignItems: 'start' }}>
        <form className="card card-pad" onSubmit={submit}>
          <div className="section-title">{t('settings.password')}</div>
          <div className="form-field">
            <label>{t('settings.passwordCurrent')}</label>
            <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </div>
          <div className="form-field">
            <label>{t('settings.passwordNew')}</label>
            <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
            <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{t('settings.passwordMin')}</div>
          </div>
          <div className="form-field">
            <label>{t('settings.passwordConfirm')}</label>
            <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary" disabled={saving}>{saving ? t('settings.saving') : t('settings.passwordSubmit')}</button>
          </div>
        </form>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="card card-pad">
            <div className="section-title">{t('settings.appearance')}</div>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
              {t('settings.appearanceHint')}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              {([
                ['light', t('settings.light'), <Sun size={18} key="s" />],
                ['dark', t('settings.dark'), <Moon size={18} key="m" />],
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

          <div className="card card-pad">
            <div className="section-title">{t('settings.language')}</div>
            <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
              {t('settings.languageHint')}
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              {([
                ['fr', t('settings.french'), 'FR'],
                ['en', t('settings.english'), 'EN'],
              ] as const).map(([value, label, code]) => (
                <button
                  key={value}
                  type="button"
                  className={`btn theme-choice ${language === value ? 'btn-primary' : ''}`}
                  onClick={() => chooseLanguage(value)}
                  aria-pressed={language === value}
                >
                  <span className="lang-code">{code}</span> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

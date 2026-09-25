import React from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { api } from '../lib/convex';
import { useToast } from '../components/Toast';

export function Login() {
  const { signIn } = useAuthActions();
  const recordLogin = useMutation(api.users.recordLogin);
  const toast = useToast();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn('password', { email, password, flow: 'signIn' });
      await recordLogin({});
    } catch {
      toast('Email ou mot de passe incorrect.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card card-pad auth-card" onSubmit={submit}>
        <div className="brand">
          <div className="brand-logo"><img src="/logo-mbss.webp" alt="M.B.S.S Sarl" /></div>
          <div className="brand-name">MBSS ERP</div>
          <div className="brand-sub">Gestion des quotations</div>
        </div>
        <h1 className="page-title" style={{ fontSize: 22 }}>Connexion</h1>
        <p className="page-subtitle" style={{ marginBottom: 20 }}>Utilisez votre adresse professionnelle.</p>
        <div className="form-field">
          <label>Adresse e-mail</label>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="form-field">
          <label>Mot de passe</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
    </div>
  );
}

/** Changement de mot de passe imposé à la première connexion (mot de passe temporaire). */
export function SetPassword() {
  const setNewPassword = useMutation(api.users.setNewPassword);
  const toast = useToast();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { toast('Les mots de passe ne correspondent pas.', 'error'); return; }
    setLoading(true);
    try {
      await setNewPassword({ newPassword: password });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Une erreur est survenue.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="card card-pad auth-card" onSubmit={submit}>
        <h1 className="page-title" style={{ fontSize: 22 }}>Nouveau mot de passe</h1>
        <p className="page-subtitle" style={{ marginBottom: 20 }}>
          Votre mot de passe est temporaire : choisissez-en un nouveau (8 caractères minimum).
        </p>
        <div className="form-field">
          <label>Nouveau mot de passe</label>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </div>
        <div className="form-field">
          <label>Confirmer</label>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
          {loading ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </form>
    </div>
  );
}

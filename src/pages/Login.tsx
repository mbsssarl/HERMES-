import React from 'react';
import { useBranding } from '../lib/branding';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { api } from '../lib/convex';
import { clearSuspension, useSuspension } from '../lib/suspension';
import { Modal } from '../components/ui';

// ---------------------------------------------------------------------------
// Textes FR / EN des écrans d'authentification
// ---------------------------------------------------------------------------

type Lang = 'FR' | 'EN';

const TEXTS = {
  FR: {
    welcome: 'Bon retour à bord,',
    crew: 'équipage.',
    welcomeText: "Chaque navire servi commence par vous. Connectez-vous pour suivre les commandes, les livraisons à quai et les stocks du jour.",
    setTitle: 'Bienvenue à bord,',
    setCrew: 'sécurisons votre compte.',
    setText: "Votre mot de passe est temporaire. Choisissez-en un nouveau pour accéder à l'application.",
    signOut: '←  Retour à la connexion',
    signIn: 'Connexion',
    signInSub: 'Utilisez votre adresse e-mail professionnelle.',
    email: 'Adresse e-mail',
    password: 'Mot de passe',
    forgotHelp: 'Mot de passe oublié ? Contactez votre administrateur : il vous remettra un mot de passe à usage unique.',
    submit: 'Se connecter',
    loading: 'Chargement...',
    badLogin: 'Email ou mot de passe incorrect.',
    serverRefused: "Connexion refusée : email ou mot de passe incorrect, ou configuration du serveur à vérifier (logs Convex).",
    generic: 'Une erreur est survenue. Réessayez.',
    mismatch: 'Les mots de passe ne correspondent pas.',
    tooShort: '8 caractères minimum',
    retype: 'Retapez le mot de passe',
    newPasswordLabel: 'Nouveau mot de passe',
    confirm: 'Confirmer le mot de passe',
    setHeading: 'Définir votre mot de passe',
    setSub: 'Choisissez un mot de passe personnel (8 caractères minimum).',
    setSubmit: 'Enregistrer le mot de passe',
    show: 'Afficher le mot de passe',
    rights: 'Tous droits réservés',
    suspExpiredTitle: 'Abonnement expiré',
    suspExpiredBody: "L'abonnement de {name} a pris fin{date}. L'accès à l'application est suspendu pour tous les comptes de l'entreprise, sans aucune perte de données.",
    suspExpiredHint: "Contactez l'administrateur de la plateforme pour renouveler l'abonnement : tout redevient disponible dès le renouvellement.",
    suspTitle: 'Accès suspendu',
    suspBody: "L'accès de {name} à l'application a été suspendu par l'administrateur de la plateforme.",
    suspReason: 'Motif',
    suspHint: "Aucune donnée n'est perdue. Contactez l'administrateur de la plateforme pour rétablir l'accès.",
    suspOn: ' le {date}',
    thisCompany: 'votre entreprise',
    understood: 'Compris',
  },
  EN: {
    welcome: 'Welcome back on board,',
    crew: 'crew.',
    welcomeText: "Every ship we serve starts with you. Sign in to follow orders, dock deliveries and today's stock.",
    setTitle: 'Welcome on board,',
    setCrew: "let's secure your account.",
    setText: 'Your password is temporary. Choose a new one to access the application.',
    signOut: '←  Back to sign in',
    signIn: 'Sign in',
    signInSub: 'Use your professional email address.',
    email: 'Email address',
    password: 'Password',
    forgotHelp: 'Forgot your password? Contact your administrator: they will give you a one-time password.',
    submit: 'Sign in',
    loading: 'Loading...',
    badLogin: 'Incorrect email or password.',
    serverRefused: 'Sign-in refused: wrong email or password, or server configuration to check (Convex logs).',
    generic: 'An error occurred. Please try again.',
    mismatch: 'Passwords do not match.',
    tooShort: '8 characters minimum',
    retype: 'Retype the password',
    newPasswordLabel: 'New password',
    confirm: 'Confirm the password',
    setHeading: 'Set your password',
    setSub: 'Choose a personal password (8 characters minimum).',
    setSubmit: 'Save the password',
    show: 'Show password',
    rights: 'All rights reserved',
    suspExpiredTitle: 'Subscription expired',
    suspExpiredBody: 'The subscription of {name} ended{date}. Access to the application is suspended for every account of the company, with no data loss.',
    suspExpiredHint: 'Contact the platform administrator to renew the subscription: everything is available again as soon as it is renewed.',
    suspTitle: 'Access suspended',
    suspBody: 'Access to the application for {name} has been suspended by the platform administrator.',
    suspReason: 'Reason',
    suspHint: 'No data is lost. Contact the platform administrator to restore access.',
    suspOn: ' on {date}',
    thisCompany: 'your company',
    understood: 'Understood',
  },
} as const;

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLangState] = React.useState<Lang>(() => {
    try { return localStorage.getItem('lang') === 'EN' ? 'EN' : 'FR'; } catch { return 'FR'; }
  });
  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* stockage indisponible */ }
  };
  return [lang, setLang];
}

const errText = (err: unknown, fallback: string) => {
  const m = err instanceof Error ? err.message : '';
  // Les messages serveur ("Uncaught Error: ...") sont nettoyés pour l'affichage.
  const clean = m.replace(/^.*Uncaught Error:\s*/s, '').split('\n')[0].trim();
  return clean || fallback;
};

// ---------------------------------------------------------------------------
// Coquille commune : panneau de bienvenue + panneau du formulaire
// ---------------------------------------------------------------------------

function AuthShell({
  lang,
  setLang,
  headline,
  headline2,
  text,
  title,
  subtitle,
  children,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  headline: string;
  headline2: string;
  text: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const t = TEXTS[lang];
  useBranding(); // applique la couleur de la plateforme à la page
  return (
    <main className="login-page">
      <section className="welcome-panel" style={{ backgroundImage: "url('/login-bg.jpg')" }}>
        <div className="welcome-overlay" />
        <div className="welcome-content">
          <div className="welcome-copy">
            <h1>
              {headline}
              <span>{headline2}</span>
            </h1>
            <p className="welcome-description">{text}</p>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="panel-inner">
          <div className="language-switch">
            <button type="button" className={lang === 'FR' ? 'active' : ''} onClick={() => setLang('FR')}>FR</button>
            <button type="button" className={lang === 'EN' ? 'active' : ''} onClick={() => setLang('EN')}>EN</button>
          </div>
          <div className="login-content">
            <h2>{title}</h2>
            <p className="login-subtitle">{subtitle}</p>
            {children}
          </div>
        </div>
        <footer>© {new Date().getFullYear()} · {t.rights}</footer>
      </section>
    </main>
  );
}

/** Champ à icône ; pour un mot de passe, bouton afficher / masquer. */
function Field({
  icon,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  password,
  showLabel,
  className,
  autoFocus,
  inputMode,
  maxLength,
  required,
}: {
  icon: 'mail' | 'lock';
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  password?: boolean;
  showLabel?: string;
  className?: string;
  autoFocus?: boolean;
  inputMode?: 'numeric' | 'text';
  maxLength?: number;
  /** Défaut : true. Mettre à false pour un champ que le formulaire n'exige pas (ex. mot de passe à la connexion,
   * puisqu'un compte peut ne pas en avoir encore). */
  required?: boolean;
}) {
  const [visible, setVisible] = React.useState(false);
  return (
    <div className="input-wrap">
      <span className={`input-icon ${icon === 'lock' ? 'lock-icon' : ''}`}>
        {icon === 'mail' ? <Mail size={17} /> : <Lock size={17} />}
      </span>
      <input
        className={className}
        type={password ? (visible ? 'text' : 'password') : (type ?? 'text')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        inputMode={inputMode}
        maxLength={maxLength}
        required={required ?? true}
      />
      {password && (
        <button className="visibility-button" type="button" onClick={() => setVisible((v) => !v)} aria-label={showLabel}>
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connexion (le mot de passe d'un utilisateur est réinitialisé par un administrateur)
// ---------------------------------------------------------------------------

export function Login() {
  const { signIn } = useAuthActions();
  const [lang, setLang] = useLang();
  const t = TEXTS[lang];
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [message, setMessage] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const suspension = useSuspension();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      // Un compte est créé avec un email normalisé (minuscules, sans espaces) : si la saisie ne l'est pas,
      // la recherche du compte échoue silencieusement (autocomplétion, clavier mobile, copier-coller...).
      await signIn('password', { email: email.trim().toLowerCase(), password, flow: 'signIn' });
    } catch (err) {
      // "InvalidAccountId" / "InvalidSecret" = identifiants réellement erronés ; tout le reste (déploiement mal
      // configuré, clé JWT manquante, etc.) doit remonter tel quel pour rester diagnosticable.
      // En production Convex masque le détail des erreurs serveur : seul "Server Error" arrive au navigateur.
      // Ici, la cause quasi unique est un mauvais email / mot de passe ; la vraie raison est dans les logs Convex.
      const raw = err instanceof Error ? err.message : '';
      console.error('Connexion impossible :', err);
      setMessage(
        /InvalidAccountId|InvalidSecret/.test(raw) ? t.badLogin
        : /Server Error/i.test(raw) ? t.serverRefused
        : errText(err, t.generic),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      lang={lang}
      setLang={setLang}
      headline={t.welcome}
      headline2={t.crew}
      text={t.welcomeText}
      title={t.signIn}
      subtitle={t.signInSub}
    >
      <form className="login-form" onSubmit={submit}>
        <label className="field-label">{t.email}</label>
        <Field icon="mail" type="email" value={email} onChange={setEmail} placeholder="prenom.nom@entreprise.com" autoComplete="email" autoFocus />
        <label className="field-label">{t.password}</label>
        <Field icon="lock" password showLabel={t.show} value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />
        <button className="submit-button" type="submit" disabled={loading}>{loading ? t.loading : t.submit}</button>
        {message && <p className="form-message error" role="status">{message}</p>}
      </form>
      <p className="code-hint">{t.forgotHelp}</p>
      {suspension && (() => {
        // Identifiants valides mais entreprise suspendue (ou suspendue pendant la session) : on explique pourquoi.
        const who = suspension.name ? <strong>{suspension.name}</strong> : t.thisCompany;
        const date = suspension.endsAt ? new Intl.DateTimeFormat(lang === 'FR' ? 'fr-FR' : 'en-GB', { dateStyle: 'long' }).format(new Date(suspension.endsAt)) : null;
        const expired = suspension.kind === 'subscription';
        const [before, after] = (expired ? t.suspExpiredBody : t.suspBody).split('{name}');
        const withDate = (s: string) => s.replace('{date}', date ? t.suspOn.replace('{date}', date) : '');
        return (
          <Modal
            title={expired ? t.suspExpiredTitle : t.suspTitle}
            onClose={clearSuspension}
            footer={<button className="btn btn-primary" onClick={clearSuspension}>{t.understood}</button>}
          >
            <p>{withDate(before)}{who}{withDate(after)}</p>
            {!expired && suspension.reason && (
              <div className="form-field" style={{ marginTop: 12, marginBottom: 0 }}>
                <label>{t.suspReason}</label>
                <p style={{ margin: 0, fontWeight: 600 }}>{suspension.reason}</p>
              </div>
            )}
            <p className="text-muted" style={{ fontSize: 13, marginTop: 12 }}>{expired ? t.suspExpiredHint : t.suspHint}</p>
          </Modal>
        );
      })()}
    </AuthShell>
  );
}

// ---------------------------------------------------------------------------
// Définition du mot de passe (première connexion, mot de passe temporaire)
// ---------------------------------------------------------------------------

export function SetPassword() {
  const setNewPassword = useMutation(api.users.setNewPassword);
  const { signOut } = useAuthActions();
  const [lang, setLang] = useLang();
  const t = TEXTS[lang];
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (password !== confirm) { setMessage(t.mismatch); return; }
    setLoading(true);
    try {
      await setNewPassword({ newPassword: password });
    } catch (err) {
      setMessage(errText(err, t.generic));
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      lang={lang}
      setLang={setLang}
      headline={t.setTitle}
      headline2={t.setCrew}
      text={t.setText}
      title={t.setHeading}
      subtitle={t.setSub}
    >
      <form className="login-form" onSubmit={submit}>
        <label className="field-label">{t.newPasswordLabel}</label>
        <Field icon="lock" password showLabel={t.show} value={password} onChange={setPassword} placeholder={t.tooShort} autoComplete="new-password" autoFocus />
        <label className="field-label">{t.confirm}</label>
        <Field icon="lock" password showLabel={t.show} value={confirm} onChange={setConfirm} placeholder={t.retype} autoComplete="new-password" />
        <button className="submit-button" type="submit" disabled={loading}>{loading ? t.loading : t.setSubmit}</button>
        {message && <p className="form-message error" role="status">{message}</p>}
      </form>
      <button className="back-button" type="button" onClick={() => void signOut()}>{t.signOut}</button>
    </AuthShell>
  );
}

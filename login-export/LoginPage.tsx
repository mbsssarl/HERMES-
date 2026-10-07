/**
 * LoginPage.tsx — Page de connexion MBSS Sarl
 *
 * Composant React autonome pour la page de connexion.
 * Inclut : connexion, récupération de mot de passe (3 étapes), bilingue FR/EN.
 *
 * POUR LE BACKEND : chercher les commentaires "// TODO BACKEND"
 *
 * Dépendances : React, TypeScript, Tailwind CSS v4
 * Images requises : src/assets/BATEAU.jpg et src/assets/logo-mbss.jpg
 */

import { useState } from 'react'
import type { FormEvent } from 'react'

// ⚠️  Adapter ces imports selon la structure du projet de ton ami
// import boatImage from '../assets/BATEAU.jpg'
// import logoImage from '../assets/logo-mbss.jpg'

// Pour tester sans les images, remplacer par des chaînes vides :
const boatImage = ''   // remplacer par : import boatImage from '../assets/BATEAU.jpg'
const logoImage = ''   // remplacer par : import logoImage from '../assets/logo-mbss.jpg'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type View = 'login' | 'email' | 'code' | 'password'

/**
 * Props du composant LoginPage.
 * onLogin est appelé quand l'utilisateur soumet le formulaire de connexion.
 * Le backend doit valider les credentials et retourner un token/session.
 */
type LoginPageProps = {
  /** Appelé avec email + password quand l'utilisateur clique "Se connecter" */
  onLogin?: (email: string, password: string) => void | Promise<void>
  /** Appelé après la réinitialisation du mot de passe (optionnel) */
  onPasswordReset?: () => void
}

// ---------------------------------------------------------------------------
// Classes Tailwind réutilisables
// ---------------------------------------------------------------------------

const inputClass =
  'h-12 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#36a445] focus:ring-4 focus:ring-[#36a445]/10'

const buttonClass =
  'h-12 w-full rounded-xl bg-[#36a445] text-sm font-bold text-white shadow-lg shadow-[#36a445]/25 transition hover:bg-[#2d913b] focus:outline-none focus:ring-4 focus:ring-[#36a445]/20'

// ---------------------------------------------------------------------------
// Composant principal
// ---------------------------------------------------------------------------

export default function LoginPage({ onLogin, onPasswordReset }: LoginPageProps) {
  const [view, setView] = useState<View>('login')
  const [language, setLanguage] = useState<'FR' | 'EN'>('FR')
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const isFrench = language === 'FR'
  const isRecovery = view !== 'login'

  // -------------------------------------------------------------------------
  // Gestion de la soumission du formulaire
  // -------------------------------------------------------------------------

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    try {
      if (view === 'login') {
        // TODO BACKEND — Remplacer par un appel réel à l'API d'authentification
        // Exemple avec fetch :
        //
        // const response = await fetch('/api/auth/login', {
        //   method: 'POST',
        //   headers: { 'Content-Type': 'application/json' },
        //   body: JSON.stringify({ email, password }),
        // })
        // if (!response.ok) throw new Error('Identifiants incorrects')
        // const { token } = await response.json()
        // localStorage.setItem('token', token)
        //
        // Exemple avec Axios :
        // const { data } = await axios.post('/api/auth/login', { email, password })
        // localStorage.setItem('token', data.token)
        //
        // Exemple avec Convex Auth :
        // await signIn('password', { email, password, flow: 'signIn' })

        await onLogin?.(email, password)

      } else if (view === 'email') {
        // TODO BACKEND — Envoyer l'email de réinitialisation
        // await fetch('/api/auth/forgot-password', {
        //   method: 'POST',
        //   body: JSON.stringify({ email }),
        // })
        setView('code')
        setMessage('')

      } else if (view === 'code') {
        // TODO BACKEND — Vérifier le code reçu par email
        // const form = event.currentTarget
        // const code = new FormData(form).get('code') as string
        // await fetch('/api/auth/verify-code', {
        //   method: 'POST',
        //   body: JSON.stringify({ email, code }),
        // })
        setView('password')
        setMessage('')

      } else {
        // TODO BACKEND — Enregistrer le nouveau mot de passe
        // const form = event.currentTarget
        // const newPassword = new FormData(form).get('password') as string
        // await fetch('/api/auth/reset-password', {
        //   method: 'POST',
        //   body: JSON.stringify({ email, newPassword }),
        // })
        setView('login')
        setMessage(isFrench ? 'Votre mot de passe a été mis à jour.' : 'Your password has been updated.')
        onPasswordReset?.()
      }
    } catch (error) {
      // TODO BACKEND — Afficher le message d'erreur retourné par l'API
      setMessage(
        error instanceof Error
          ? error.message
          : isFrench
          ? 'Une erreur est survenue. Réessayez.'
          : 'An error occurred. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  // -------------------------------------------------------------------------
  // Textes des étapes de récupération
  // -------------------------------------------------------------------------

  const recovery = {
    email: [
      'Mot de passe oublié',
      'Étape 1 sur 3 · Identification du compte',
      'Adresse e-mail professionnelle',
      'Envoyer le lien de réinitialisation',
    ],
    code: [
      'Vérifiez votre e-mail',
      'Étape 2 sur 3 · Code de vérification',
      'Code reçu par e-mail',
      'Vérifier le code',
    ],
    password: [
      'Nouveau mot de passe',
      'Étape 3 sur 3 · Sécurisez votre compte',
      'Nouveau mot de passe',
      'Valider le nouveau mot de passe',
    ],
  } as const

  const recoveryStep = view === 'login' ? recovery.email : recovery[view]

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------

  return (
    <main className="grid min-h-screen grid-cols-1 bg-white lg:grid-cols-[43%_57%]">

      {/* ── Panneau gauche : image + texte de bienvenue ── */}
      <section
        className="relative min-h-[430px] overflow-hidden bg-cover bg-center lg:min-h-screen"
        style={{ backgroundImage: boatImage ? `url(${boatImage})` : undefined, backgroundColor: '#0a1a4a' }}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_35%,rgba(34,67,156,.25),transparent_34%),linear-gradient(180deg,rgba(8,31,79,.82),rgba(6,24,65,.96))]" />
        <div className="relative z-10 flex min-h-[430px] flex-col p-7 sm:p-10 lg:min-h-screen lg:p-16">

          {logoImage && (
            <img
              className="h-auto w-36 rounded-2xl shadow-2xl sm:w-44"
              src={logoImage}
              alt="M.B.S.S Sarl"
            />
          )}

          <div className="my-auto max-w-xl py-10">
            <p className="mb-6 text-xs font-semibold tracking-[.19em] text-[#69d875]">
              {isRecovery ? 'RÉCUPÉRATION DE COMPTE' : 'PORTAIL EMPLOYÉS · DOUALA'}
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              {isRecovery
                ? 'Pas de panique,'
                : isFrench
                ? 'Bon retour à bord,'
                : 'Welcome back on board,'}
              <span className="block text-[#6be477]">
                {isRecovery
                  ? 'on vous remet à quai.'
                  : isFrench
                  ? 'équipage M.B.S.S.'
                  : 'M.B.S.S. crew.'}
              </span>
            </h1>
            <p className="mt-7 max-w-md text-sm leading-7 text-blue-100/75">
              {isRecovery
                ? 'Saisissez votre adresse professionnelle : vous recevrez un lien sécurisé pour définir un nouveau mot de passe.'
                : isFrench
                ? 'Chaque navire servi commence par vous. Connectez-vous pour suivre les commandes, les livraisons à quai et les stocks du jour.'
                : "Every ship we serve starts with you. Sign in to follow orders, dock deliveries and today's stock."}
            </p>
          </div>

          <p className="text-[11px] text-blue-100/65">
            ⌖&nbsp;&nbsp;Bonantone, Deido, Douala — Cameroun · Port autonome de Douala
          </p>
        </div>
      </section>

      {/* ── Panneau droit : formulaire ── */}
      <section className="flex min-h-[640px] flex-col justify-between px-6 py-7 sm:px-12 sm:py-10 lg:min-h-screen lg:px-[clamp(42px,8vw,105px)] lg:py-11">
        <div className="mx-auto w-full max-w-[410px]">

          {/* Sélecteur de langue */}
          <div className="ml-auto flex w-28 rounded-full bg-slate-100 p-1">
            <button
              className={`flex-1 rounded-full py-2 text-[11px] font-semibold ${isFrench ? 'bg-[#22439c] text-white shadow' : 'text-slate-500'}`}
              onClick={() => setLanguage('FR')}
              type="button"
            >
              FR
            </button>
            <button
              className={`flex-1 rounded-full py-2 text-[11px] font-semibold ${!isFrench ? 'bg-[#22439c] text-white shadow' : 'text-slate-500'}`}
              onClick={() => setLanguage('EN')}
              type="button"
            >
              EN
            </button>
          </div>

          <div className="mt-12 sm:mt-16">
            <p className="mb-4 text-[10px] font-semibold tracking-[.18em] text-slate-400">
              M.B.S.S SARL · {isRecovery ? 'ESPACE EMPLOYÉ' : 'SUPPLY SOLUTIONS FOR YOUR SHIP'}
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-[#22439c]">
              {isRecovery ? recoveryStep[0] : isFrench ? 'Connexion' : 'Sign in'}
            </h2>
            <p className="mt-2 text-sm text-slate-400">
              {isRecovery
                ? recoveryStep[1]
                : isFrench
                ? 'Utilisez votre adresse professionnelle M.B.S.S.'
                : 'Use your professional M.B.S.S. address.'}
            </p>

            {/* Barre de progression (flux récupération) */}
            {isRecovery && (
              <div className="mt-8 flex gap-2">
                {[1, 2, 3].map((step) => (
                  <span
                    className={`h-1 flex-1 rounded-full ${
                      step <= (view === 'email' ? 1 : view === 'code' ? 2 : 3)
                        ? 'bg-[#36a445]'
                        : 'bg-slate-200'
                    }`}
                    key={step}
                  />
                ))}
              </div>
            )}

            {/* Formulaire principal */}
            <form className="mt-7 space-y-4" onSubmit={handleSubmit}>

              {/* Champ email / code / mot de passe selon l'étape */}
              <label className="block text-xs font-semibold text-slate-600" htmlFor="form-value">
                {isRecovery ? recoveryStep[2] : 'Adresse e-mail'}
              </label>
              <input
                className={inputClass}
                id="form-value"
                name={view === 'code' ? 'code' : view === 'password' ? 'password' : 'email'}
                type={
                  view === 'email' || view === 'login'
                    ? 'email'
                    : view === 'password'
                    ? showPassword ? 'text' : 'password'
                    : 'text'
                }
                value={view === 'login' ? email : view === 'email' ? email : undefined}
                onChange={(e) => {
                  if (view === 'login' || view === 'email') setEmail(e.target.value)
                  if (view === 'login') setEmail(e.target.value)
                }}
                placeholder={
                  view === 'code'
                    ? 'Ex. 482 915'
                    : view === 'password'
                    ? '8 caractères minimum'
                    : 'prenom.nom@mbss-sarl.cm'
                }
                autoComplete={view === 'login' ? 'email' : undefined}
                required
              />

              {/* Champ mot de passe (vue login uniquement) */}
              {view === 'login' && (
                <>
                  <label className="block text-xs font-semibold text-slate-600" htmlFor="login-password">
                    Mot de passe
                  </label>
                  <div className="relative">
                    <input
                      className={`${inputClass} pr-12`}
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••"
                      autoComplete="current-password"
                      required
                    />
                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-slate-400"
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label="Afficher le mot de passe"
                    >
                      {showPassword ? '◉' : '◎'}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <label className="flex items-center gap-2 text-slate-400">
                      <input className="h-4 w-4 accent-[#36a445]" type="checkbox" defaultChecked />
                      Rester connecté
                    </label>
                    <button
                      className="font-semibold text-[#22439c]"
                      type="button"
                      onClick={() => { setView('email'); setMessage('') }}
                    >
                      Mot de passe oublié ?
                    </button>
                  </div>
                </>
              )}

              {/* Bouton de soumission */}
              <button className={buttonClass} type="submit" disabled={isLoading}>
                {isLoading
                  ? (isFrench ? 'Chargement...' : 'Loading...')
                  : isRecovery
                  ? recoveryStep[3]
                  : isFrench ? 'Se connecter' : 'Sign in'}
              </button>

              {/* Message de succès ou d'erreur */}
              {message && (
                <p
                  className={`text-xs ${message.includes('erreur') || message.includes('error') ? 'text-red-500' : 'text-[#2d913b]'}`}
                  role="status"
                >
                  {message}
                </p>
              )}
            </form>

            {/* Info code envoyé */}
            {view === 'code' && (
              <p className="mt-4 text-center text-xs text-slate-400">
                Code envoyé à <strong className="text-slate-600">{email || 'votre adresse e-mail'}</strong>
              </p>
            )}

            {/* Bouton retour */}
            {isRecovery && (
              <button
                className="mt-3 h-11 w-full rounded-xl border border-slate-200 text-xs font-semibold text-[#22439c] hover:bg-slate-50"
                type="button"
                onClick={() => { setView('login'); setMessage('') }}
              >
                ←&nbsp;&nbsp; Retour à la connexion
              </button>
            )}
          </div>
        </div>

        <footer className="mt-12 text-center text-[10px] text-slate-400">
          © 2026 M.B.S.S Sarl · Douala, Cameroun · Tous droits réservés
        </footer>
      </section>
    </main>
  )
}

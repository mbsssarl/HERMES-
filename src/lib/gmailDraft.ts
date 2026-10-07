import { buildEmlText } from './exportFile';

/**
 * Brouillon Gmail AVEC pièce jointe, via l'API Gmail (un simple lien ne peut pas joindre de fichier, mais
 * l'API peut créer un brouillon complet dans la boîte de l'utilisateur, qu'on ouvre ensuite).
 * Nécessite un identifiant client OAuth Google (VITE_GOOGLE_CLIENT_ID) ; sans lui, l'option est masquée.
 */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/gmail.compose';

export const gmailApiConfigured = Boolean(CLIENT_ID);

interface TokenResponse { access_token?: string; error?: string; error_description?: string }
interface GoogleWindow {
  google?: { accounts: { oauth2: { initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type?: string; message?: string }) => void;
  }) => { requestAccessToken: (o?: { prompt?: string }) => void } } } };
}

function loadGoogleScript(): Promise<void> {
  const w = window as unknown as GoogleWindow;
  if (w.google) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossible de charger le service de connexion Google.'));
    document.head.appendChild(s);
  });
}

/** Ouvre la fenêtre d'autorisation Google. À appeler directement depuis un clic (sinon le navigateur bloque la fenêtre). */
export async function requestGmailToken(): Promise<string> {
  if (!CLIENT_ID) throw new Error("L'envoi Gmail avec pièce jointe n'est pas configuré.");
  await loadGoogleScript();
  const w = window as unknown as GoogleWindow;
  return new Promise((resolve, reject) => {
    const client = w.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (r) => (r.access_token ? resolve(r.access_token) : reject(new Error(r.error_description || r.error || 'Autorisation Google refusée.'))),
      error_callback: (e) => reject(new Error(e.message || 'Autorisation Google annulée.')),
    });
    client.requestAccessToken();
  });
}

const toBase64Url = (text: string) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function gmailFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Gmail a refusé la demande (${res.status}). ${detail.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/** Crée le brouillon (destinataire, objet, message, fichier joint) dans Gmail et renvoie le lien pour l'ouvrir. */
export async function createGmailDraft(
  token: string,
  opts: { to: string; subject: string; body: string; fileName: string; base64: string },
): Promise<string> {
  const raw = toBase64Url(buildEmlText(opts));
  const draft = await gmailFetch<{ message: { id: string } }>(token, 'drafts', {
    method: 'POST',
    body: JSON.stringify({ message: { raw } }),
  });
  // Plusieurs comptes Google peuvent être ouverts : on cible celui qui a donné l'autorisation.
  const profile = await gmailFetch<{ emailAddress: string }>(token, 'profile').catch(() => null);
  const account = profile ? `authuser=${encodeURIComponent(profile.emailAddress)}` : 'authuser=0';
  return `https://mail.google.com/mail/?${account}#drafts?compose=${draft.message.id}`;
}

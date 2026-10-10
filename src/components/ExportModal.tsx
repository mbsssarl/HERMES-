import React from 'react';
import { Download, Mail } from 'lucide-react';
import { Modal } from './ui';
import { useToast } from './Toast';
import { useBranding } from '../lib/branding';
import { gmailComposeUrl, saveBase64File, yahooComposeUrl } from '../lib/exportFile';
import { createGmailDraft, gmailApiConfigured, requestGmailToken } from '../lib/gmailDraft';

export type RecipientType = 'client' | 'supplier';
type Mode = 'download' | 'email';
type Mailer = 'gmailApi' | 'gmail' | 'yahoo';

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Extraction d'un lot de lignes : télécharger le fichier, ou l'envoyer par email (destinataire, objet, message
 * facultatif, type de destinataire). Le type (client / fournisseur) est saisi dès maintenant : le format du
 * fichier en dépendra plus tard, il n'a pas encore d'effet sur le contenu.
 */
export function ExportModal({
  title,
  count,
  quotationNumber,
  vessel,
  defaultTo,
  defaultType,
  fetchExport,
  onClose,
}: {
  title: string;
  count: number;
  quotationNumber: string;
  vessel: string | null;
  defaultTo: string;
  defaultType: RecipientType;
  /** Génère le fichier côté serveur (avec l'ETA saisie, si fournisseur) ; renvoie null (et affiche l'erreur) en cas d'échec. */
  fetchExport: (opts: { eta?: string; clientFormat?: boolean }) => Promise<{ fileName: string; base64: string; notice?: string; format: 'client' | 'standard' } | null>;
  onClose: () => void;
}) {
  const toast = useToast();
  const brand = useBranding();
  const [mode, setMode] = React.useState<Mode>('download');
  const [recipientType, setRecipientType] = React.useState<RecipientType>(defaultType);
  const [to, setTo] = React.useState(defaultType === 'client' ? defaultTo : '');
  const [toTouched, setToTouched] = React.useState(false);
  const [subject, setSubject] = React.useState(
    `${defaultType === 'client' ? 'Quotation' : 'Demande de prix'} ${quotationNumber} - ${brand.name}`,
  );
  const [subjectTouched, setSubjectTouched] = React.useState(false);
  const [message, setMessage] = React.useState('');
  // ETA du navire : aujourd'hui + 4 jours par défaut (temps laissé au fournisseur pour répondre), modifiable.
  // Demandée uniquement pour un fournisseur ; elle figure dans l'en-tête du fichier envoyé.
  const [eta, setEta] = React.useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 4);
    return d.toISOString().slice(0, 10);
  });
  const [mailer, setMailer] = React.useState<Mailer>(gmailApiConfigured ? 'gmailApi' : 'gmail');
  const [busy, setBusy] = React.useState(false);

  const chooseType = (type: RecipientType) => {
    setRecipientType(type);
    // Suit le type tant que l'utilisateur n'a pas saisi lui-même l'adresse / l'objet.
    if (!toTouched) setTo(type === 'client' ? defaultTo : '');
    if (!subjectTouched) setSubject(`${type === 'client' ? 'Quotation' : 'Demande de prix'} ${quotationNumber} - ${brand.name}`);
  };

  const recipients = to.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const emailInvalid = mode === 'email' && (recipients.length === 0 || recipients.some((r) => !EMAIL_RE.test(r)));
  const subjectMissing = mode === 'email' && !subject.trim();

  const run = async () => {
    setBusy(true);
    try {
      // La fenêtre d'autorisation Google doit s'ouvrir directement au clic : on la demande avant le calcul du fichier.
      const gmailToken = mode === 'email' && mailer === 'gmailApi' ? await requestGmailToken() : null;
      // Le fichier suit le destinataire, en téléchargement comme en envoi : un client reçoit son fichier d'origine
      // complété des prix, un fournisseur le gabarit MBSS (avec l'ETA saisie).
      const file = await fetchExport({ eta: recipientType === 'supplier' && eta ? eta : undefined, clientFormat: recipientType === 'client' });
      if (!file) return;
      if (file.notice) toast(file.notice, 'info', { duration: 10000 });
      if (mode === 'download') {
        saveBase64File(file.fileName, file.base64);
        toast(`Fichier Excel téléchargé (${file.format === 'client' ? 'modèle du client' : 'modèle standard'}).`, 'success');
        onClose();
        return;
      }

      const body =
        message.trim() ||
        [
          'Bonjour,',
          '',
          recipientType === 'client'
            ? `Veuillez trouver ci-joint notre quotation ${quotationNumber}${vessel ? ` pour le navire ${vessel}` : ''}.`
            : `Veuillez trouver ci-joint notre demande de prix ${quotationNumber}${vessel ? ` pour le navire ${vessel}` : ''}.`,
          '',
          'Cordialement,',
        ].join('\n');
      const toList = recipients.join(', ');

      if (gmailToken) {
        const url = await createGmailDraft(gmailToken, { to: toList, subject: subject.trim(), body, fileName: file.fileName, base64: file.base64 });
        window.open(url, '_blank');
        toast('Brouillon Gmail créé avec le fichier en pièce jointe.', 'success');
      } else {
        // Gmail et Yahoo ne permettent pas de joindre un fichier via un lien : on télécharge le fichier à côté du brouillon.
        const name = mailer === 'yahoo' ? 'Yahoo' : 'Gmail';
        saveBase64File(file.fileName, file.base64);
        const compose = mailer === 'yahoo' ? yahooComposeUrl : gmailComposeUrl;
        window.open(compose({ to: toList, subject: subject.trim(), body }), '_blank');
        toast(`« ${file.fileName} » téléchargé : glissez-le dans le brouillon ${name} qui vient de s'ouvrir.`, 'info', { duration: 9000 });
      }
      onClose();
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const choice = (active: boolean) => `btn ${active ? 'btn-primary' : ''}`;

  return (
    <Modal
      title={title}
      onClose={() => !busy && onClose()}
      footer={<>
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={() => void run()} disabled={busy || emailInvalid || subjectMissing}>
          {busy ? 'Préparation…' : mode === 'download' ? 'Télécharger' : 'Continuer vers ma messagerie'}
        </button>
      </>}
    >
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>{count} ligne(s) dans ce fichier.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button type="button" className={choice(mode === 'download')} style={{ flex: 1 }} onClick={() => setMode('download')}>
          <Download size={16} /> Télécharger
        </button>
        <button type="button" className={choice(mode === 'email')} style={{ flex: 1 }} onClick={() => setMode('email')}>
          <Mail size={16} /> Envoyer par email
        </button>
      </div>

      <div className="form-field">
        <label>Destinataire du fichier</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className={choice(recipientType === 'client')} onClick={() => chooseType('client')}>Client</button>
          <button type="button" className={choice(recipientType === 'supplier')} onClick={() => chooseType('supplier')}>Fournisseur</button>
        </div>
      </div>

      {recipientType === 'supplier' && (
        <div className="form-field">
          <label>ETA (arrivée du navire)</label>
          <input className="input" type="date" value={eta} onChange={(e) => setEta(e.target.value)} />
        </div>
      )}

      {mode === 'email' && (
        <>
          <div className="form-field">
            <label>Adresse du destinataire</label>
            <input
              className="input"
              type="email"
              multiple
              value={to}
              onChange={(e) => { setTo(e.target.value); setToTouched(true); }}
              placeholder="achats@exemple.com"
              autoFocus
            />
            {to.trim() !== '' && emailInvalid && <div style={{ fontSize: 12, marginTop: 4, color: 'var(--color-error)' }}>Adresse email invalide.</div>}
          </div>
          <div className="form-field">
            <label>Objet</label>
            <input className="input" value={subject} onChange={(e) => { setSubject(e.target.value); setSubjectTouched(true); }} />
          </div>
          <div className="form-field">
            <label>Message (facultatif)</label>
            <textarea className="input" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Laissez vide pour un message standard." style={{ resize: 'vertical' }} />
          </div>
          <div className="form-field">
            <label>Messagerie</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {gmailApiConfigured && (
                <button type="button" className={choice(mailer === 'gmailApi')} onClick={() => setMailer('gmailApi')}>Gmail (fichier joint)</button>
              )}
              <button type="button" className={choice(mailer === 'gmail')} onClick={() => setMailer('gmail')}>{gmailApiConfigured ? 'Gmail (à joindre)' : 'Gmail'}</button>
              <button type="button" className={choice(mailer === 'yahoo')} onClick={() => setMailer('yahoo')}>Yahoo</button>
            </div>
            <div className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
              {mailer === 'gmailApi'
                ? "Google vous demande une autorisation (création de brouillons uniquement) ; le brouillon est créé dans votre Gmail avec le fichier déjà joint, rien n'est envoyé."
                : `${mailer === 'yahoo' ? 'Yahoo' : 'Gmail'} ne permet pas de pré-joindre un fichier : le brouillon s'ouvre pré-rempli et le fichier est téléchargé, il suffit de le glisser dedans.`}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}

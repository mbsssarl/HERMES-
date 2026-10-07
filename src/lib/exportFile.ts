export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

/** Enregistre un fichier reçu du serveur en base64 (téléchargement du navigateur). */
export function saveBase64File(fileName: string, base64: string, mime = XLSX_MIME) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mime }), fileName);
}

const utf8Base64 = (text: string) => btoa(unescape(encodeURIComponent(text)));
const wrap76 = (b64: string) => (b64.match(/.{1,76}/g) ?? []).join('\r\n');

/** En-tête d'objet encodé (RFC 2047) si besoin, découpé en morceaux courts. */
function encodeHeader(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const chars = Array.from(text);
  const parts: string[] = [];
  for (let i = 0; i < chars.length; i += 24) parts.push(`=?UTF-8?B?${utf8Base64(chars.slice(i, i + 24).join(''))}?=`);
  return parts.join('\r\n ');
}

/**
 * Brouillon de message (.eml) avec le fichier en pièce jointe. « X-Unsent: 1 » le fait s'ouvrir comme un
 * message à envoyer (et non reçu) dans Outlook / Courrier Windows : destinataire, objet, texte et pièce
 * jointe sont déjà là. Gmail (web) ne sait pas ouvrir ce format.
 */
export function downloadEmailDraft(opts: { to: string; subject: string; body: string; fileName: string; base64: string; draftName: string }) {
  downloadBlob(new Blob([buildEmlText(opts)], { type: 'message/rfc822' }), opts.draftName);
}

/** Message MIME complet (texte + pièce jointe), tel que lu par les clients de messagerie et par l'API Gmail. */
export function buildEmlText(opts: { to: string; subject: string; body: string; fileName: string; base64: string }): string {
  const boundary = `----=_MBSS_${Date.now().toString(36)}`;
  const asciiName = opts.fileName.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const lines = [
    `To: ${opts.to}`,
    `Subject: ${encodeHeader(opts.subject)}`,
    'X-Unsent: 1',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(utf8Base64(opts.body)),
    `--${boundary}`,
    `Content-Type: ${XLSX_MIME}; name="${asciiName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`,
    '',
    wrap76(opts.base64),
    `--${boundary}--`,
    '',
  ];
  return lines.join('\r\n');
}

export function yahooComposeUrl(opts: { to: string; subject: string; body: string }) {
  const params = new URLSearchParams({ to: opts.to, subject: opts.subject, body: opts.body });
  return `https://compose.mail.yahoo.com/?${params.toString()}`;
}

export function gmailComposeUrl(opts: { to: string; subject: string; body: string }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: opts.to, su: opts.subject, body: opts.body });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

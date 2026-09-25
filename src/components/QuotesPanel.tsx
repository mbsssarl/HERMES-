import React from 'react';
import { useAction, useConvex, useMutation, useQuery } from 'convex/react';
import { FileDown, Mail, FilePlus2 } from 'lucide-react';
import { api, type Doc, type Id } from '../lib/convex';
import { formatDate, formatPrice } from '../lib/format';
import { Badge, Modal } from './ui';
import { useToast } from './Toast';

/** Versions du devis (PDF figé), validation admin et envoi par email (Brevo). */
export function QuotesPanel({
  orderId,
  reference,
  clientEmail,
  currency,
  isAdmin,
  canGenerate,
}: {
  orderId: Id<'orders'>;
  reference: string;
  clientEmail: string | null;
  currency: string;
  isAdmin: boolean;
  canGenerate: boolean;
}) {
  const toast = useToast();
  const convex = useConvex();
  const quotes = useQuery(api.quotations.listByOrder, { orderId });
  const emailLogs = useQuery(api.quotations.listEmailLogs, { orderId });
  const generate = useAction(api.quotationGeneration.generateQuotation);
  const sendEmail = useAction(api.emails.sendQuotationEmail);
  const approve = useMutation(api.quotations.approve);
  const [busy, setBusy] = React.useState(false);
  const [emailFor, setEmailFor] = React.useState<Doc<'quotations'> | null>(null);
  const [to, setTo] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [message, setMessage] = React.useState('');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
    } catch (err) {
      toast('Erreur: ' + (err instanceof Error ? err.message : String(err)), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openPdf = async (q: Doc<'quotations'>) => {
    if (!q.pdfStorageId) return;
    const url = await convex.query(api.files.getUrl, { storageId: q.pdfStorageId });
    if (url) window.open(url, '_blank');
  };

  const openEmail = (q: Doc<'quotations'>) => {
    setEmailFor(q);
    setTo(clientEmail ?? '');
    setSubject(`Quotation ${reference}`);
    setMessage(`Bonjour,\n\nVeuillez trouver ci-joint notre quotation ${reference}.\n\nCordialement`);
  };

  return (
    <div className="card" style={{ marginTop: 20 }}>
      <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 16 }}>Devis générés</h3>
        <button
          className="btn btn-primary btn-sm"
          disabled={busy || !canGenerate}
          title={canGenerate ? '' : 'Aucun article reconnu avec prix'}
          onClick={() => run(() => generate({ orderId }), 'Devis généré.')}
        >
          <FilePlus2 size={14} /> Générer le devis (PDF)
        </button>
      </div>
      {(quotes ?? []).length === 0 ? (
        <div className="card-pad text-muted">Aucun devis généré pour l'instant.</div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Version</th><th>Date</th><th className="text-right">Total</th><th>Validation</th><th></th></tr></thead>
            <tbody>
              {(quotes ?? []).map((q) => (
                <tr key={q._id}>
                  <td className="mono" style={{ fontWeight: 700 }}>v{q.version}</td>
                  <td className="text-muted nowrap">{formatDate(new Date(q.generatedAt).toISOString())}</td>
                  <td className="text-right mono">{formatPrice(q.grandTotal, currency)}</td>
                  <td>
                    {q.approvedByAdmin
                      ? <Badge label="Approuvé" color="var(--badge-success)" />
                      : <Badge label="Non approuvé" color="var(--badge-neutral)" />}
                  </td>
                  <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => void openPdf(q)}><FileDown size={14} /> PDF</button>
                    {isAdmin && !q.approvedByAdmin && (
                      <button className="btn btn-ghost btn-sm" onClick={() => run(() => approve({ quotationId: q._id }), 'Devis approuvé.')}>Approuver</button>
                    )}
                    <button className="btn btn-sm" onClick={() => openEmail(q)}><Mail size={14} /> Envoyer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(emailLogs ?? []).length > 0 && (
        <div className="card-pad" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="section-title">Emails envoyés</div>
          {(emailLogs ?? []).map((l) => (
            <div key={l._id} className="text-muted" style={{ fontSize: 13, padding: '2px 0' }}>
              {formatDate(new Date(l.sentAt).toISOString())} - {l.to} - {l.status === 'sent' ? 'envoyé' : `échec (${l.errorMessage ?? 'erreur'})`}
            </div>
          ))}
        </div>
      )}

      {emailFor && (
        <Modal
          title="Envoyer le devis par email"
          onClose={() => setEmailFor(null)}
          footer={<>
            <button className="btn" onClick={() => setEmailFor(null)}>Annuler</button>
            <button
              className="btn btn-primary"
              disabled={busy || !to.trim()}
              onClick={() =>
                run(async () => {
                  await sendEmail({ orderId, quotationId: emailFor._id, to: to.trim(), subject, message });
                  setEmailFor(null);
                }, 'Email envoyé.')
              }
            >
              Envoyer
            </button>
          </>}
        >
          <div className="form-field"><label>Destinataire</label><input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <div className="form-field"><label>Objet</label><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
          <div className="form-field"><label>Message</label><textarea className="input" rows={6} value={message} onChange={(e) => setMessage(e.target.value)} /></div>
        </Modal>
      )}
    </div>
  );
}

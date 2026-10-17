import React from 'react';
import { Trash2 } from 'lucide-react';
import { useMutation } from 'convex/react';
import { api, type Id } from '../lib/convex';
import { useToast } from './Toast';
import { Modal } from './ui';
import type { QuotationWithRelations } from '../types';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Bouton « Supprimer » d'une ligne de liste : envoie la quotation à la corbeille après confirmation. */
export function DeleteQuotationButton({ quotation }: { quotation: QuotationWithRelations }) {
  const toast = useToast();
  const removeOrder = useMutation(api.orders.remove);
  const [confirm, setConfirm] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const doDelete = async () => {
    setDeleting(true);
    try {
      await removeOrder({ orderId: quotation.id as Id<'orders'> });
      toast('Quotation supprimée. Elle reste visible dans le filtre « Supprimé ».', 'success');
      setConfirm(false);
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    // Empêche le clic d'ouvrir la quotation (la ligne entière est cliquable).
    <span onClick={(e) => e.stopPropagation()}>
      <button
        className="btn btn-ghost btn-sm"
        style={{ color: '#b91c1c' }}
        title="Supprimer"
        aria-label="Supprimer"
        onClick={() => setConfirm(true)}
      >
        <Trash2 size={15} />
      </button>
      {confirm && (
        <Modal
          title="Supprimer cette quotation ?"
          onClose={() => !deleting && setConfirm(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirm(false)} disabled={deleting}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void doDelete()} disabled={deleting}>
              {deleting ? 'Suppression…' : 'Supprimer'}
            </button>
          </>}
        >
          <p>
            La quotation <strong>{quotation.quotation_number}</strong> ({quotation.customer_name}) sera retirée des listes.
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Elle reste consultable dans le filtre « Supprimé » et peut être restaurée.
          </p>
        </Modal>
      )}
    </span>
  );
}

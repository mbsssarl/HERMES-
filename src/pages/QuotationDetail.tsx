import React from 'react';
import { useAction, useMutation } from 'convex/react';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import type { Currency, OrderValidation, PendingEdit, ProductWithPrices, QuotationWithRelations } from '../types';
import { MATCH_LABELS, formatPrice, formatAmount, formatDate } from '../lib/format';
import { StatusTag } from '../components/StatusTag';
import { Modal, StateBox } from '../components/ui';
import { LinesTable } from '../components/LinesTable';
import { RequestInfoCard } from '../components/RequestInfoCard';
import { ExportModal } from '../components/ExportModal';
import { ValidateOrderModal } from '../components/ValidateOrderModal';
import { ValidationDetails } from '../components/ValidationDetails';
import { api, type Id } from '../lib/convex';
import { UI_TO_ORDER_STATUS } from '../lib/mappers';
import { useToast } from '../components/Toast';

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function QuotationDetail({
  quotation,
  products,
  currencies,
  loading,
  isAdmin,
  meId,
  edits,
  validation,
  onBack,
}: {
  quotation: QuotationWithRelations | null;
  products: ProductWithPrices[];
  currencies: Currency[];
  loading: boolean;
  isAdmin: boolean;
  /** Utilisateur connecté : seul le propriétaire de la quotation valide les modifications des autres. */
  meId: string;
  /** Modifications de lignes proposées par d'autres utilisateurs, en attente. */
  edits: PendingEdit[];
  /** Fichier final du client importé à « Valider la commande » (null tant que la commande n'est pas validée). */
  validation: OrderValidation | null;
  onBack: () => void;
}) {
  const toast = useToast();
  const confirmMatch = useMutation(api.orderItems.confirmAmbiguousMatch);
  const updateItem = useMutation(api.orderItems.update);
  const refreshOrder = useMutation(api.orderItems.refreshOrder);
  const [refreshing, setRefreshing] = React.useState(false);
  // Cotation des lignes saisie en pourcentage ou en montant par unité (choix mémorisé sur ce poste).
  const [cotationMode, setCotationMode] = React.useState<'percent' | 'price'>(() => {
    try { return localStorage.getItem('cotationMode') === 'price' ? 'price' : 'percent'; } catch { return 'percent'; }
  });
  const changeCotationMode = (mode: 'percent' | 'price') => {
    setCotationMode(mode);
    try { localStorage.setItem('cotationMode', mode); } catch { /* stockage indisponible */ }
  };
  const updateStatus = useMutation(api.orders.updateStatus);
  const applyGlobalPricing = useMutation(api.orders.applyGlobalPricing);
  const exportXlsx = useAction(api.exportQuotation.exportQuotationXlsx);
  const applyExportCurrency = useAction(api.orders.applyExportCurrency);
  const setTransportFee = useMutation(api.orders.setTransportFee);
  const markSeen = useMutation(api.orders.markSeen);
  const setExcluded = useMutation(api.orderItems.setExcluded).withOptimisticUpdate((store, { orderItemIds, excluded }) => {
    const ids = new Set<string>(orderItemIds);
    for (const { args, value } of store.getAllQueries(api.orderItems.listByOrder)) {
      if (!value) continue;
      store.setQuery(
        api.orderItems.listByOrder,
        args,
        value.map((it) => (ids.has(it._id) ? { ...it, excluded: excluded ? true : undefined } : it)),
      );
    }
  });
  const dismissProposal = useMutation(api.orderItems.dismissProposal);
  const decideEdit = useMutation(api.orderItemEdits.decide);
  const withdrawEdit = useMutation(api.orderItemEdits.withdraw);
  // Incrémenté quand une modification est seulement proposée (pas appliquée) : les cellules reprennent la valeur actuelle.
  const [editNonce, setEditNonce] = React.useState(0);
  const removeOrder = useMutation(api.orders.remove);
  const restoreOrder = useMutation(api.orders.restore);
  const [applying, setApplying] = React.useState(false);
  const [convertingCurrency, setConvertingCurrency] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [validateModal, setValidateModal] = React.useState(false);
  const [showValidation, setShowValidation] = React.useState(false);
  const [exportDialog, setExportDialog] = React.useState<'selected' | 'unknown' | null>(null);


  // Ouvrir la quotation fait disparaître son badge « mise à jour » pour cet utilisateur.
  const seenId = quotation?.id;
  // (orders.get ne renvoie pas le badge : on enregistre simplement l'ouverture, la liste fait le reste.)
  React.useEffect(() => {
    if (seenId) markSeen({ orderId: seenId as Id<'orders'> }).catch(() => {});
  }, [seenId, markSeen]);

  if (loading) return <StateBox loading title="Chargement…" />;
  if (!quotation) return <StateBox title="Quotation introuvable" />;

  const orderId = quotation.id as Id<'orders'>;
  // Valider la commande engage la quotation : réservé à son propriétaire (et aux administrateurs).
  const canValidate = quotation.created_by === meId || isAdmin;
  const currency = quotation.countries?.currency ?? 'EUR';

  // Récapitulatif du bas de tableau : sous-total, discount, frais de transport, total. Les frais sont saisis dans la
  // devise du fichier exporté ; si une vraie conversion est appliquée, les montants affichés ici restent dans la devise
  // d'origine de chaque ligne et le total converti (avec frais) est donné à part.
  const discountPercent = quotation.global_discount_percent ?? 0;
  const transportFee = quotation.transport_fee ?? 0;
  const exportCurrency = quotation.export_currency;
  const converting =
    Boolean(exportCurrency) && quotation.export_rates.length > 0 && !quotation.export_rates.every((r) => r.source === 'sans conversion');
  const totalWithFee = quotation.total + (converting ? 0 : transportFee);
  const convertedTotal = converting
    ? quotation.quotation_items
        .filter((it) => !it.excluded && it.total_price != null)
        .reduce((sum, it) => sum + (it.total_price as number) * (quotation.export_rates.find((r) => r.currency === (it.price_currency ?? currency))?.rate ?? 1), 0) *
        (1 - discountPercent / 100) +
      transportFee
    : null;
  const items = quotation.quotation_items;
  // Les lignes décochées sont écartées des statistiques.
  const includedItems = items.filter((it) => !it.excluded);
  const isKnown = (it: (typeof items)[number]) => it.match_status === 'MATCHED';
  const counts = {
    selected: includedItems.length,
    known: includedItems.filter(isKnown).length,
    // « Sans prix » = aucun prix retenu pour la ligne (un article reconnu au catalogue mais non chiffré en fait partie).
    unknown: includedItems.filter((it) => it.unit_price === null).length,
    all: items.length,
  };
  const unknownCount = includedItems.filter((it) => it.match_status === 'NOT_FOUND').length;
  const reviewCount = includedItems.filter((it) => it.match_status === 'REVIEW').length;

  const applyGlobal = async (quotationPercent: number | undefined, discountPercent: number | undefined) => {
    setApplying(true);
    try {
      await applyGlobalPricing({ orderId, quotationPercent, discountPercent });
      toast('Tarification appliquée à tous les articles.', 'success');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setApplying(false);
    }
  };

  // Refait un tour en base : reconnaissance des lignes en attente et prix courants du catalogue.
  const refreshPrices = async () => {
    setRefreshing(true);
    try {
      let matched = 0;
      let repriced = 0;
      let cursor: string | undefined;
      for (;;) {
        const res = await refreshOrder({ orderId, cursor });
        matched += res.matched;
        repriced += res.repriced;
        if (res.done) break;
        cursor = res.cursor;
      }
      toast(
        matched + repriced === 0
          ? 'Quotation déjà à jour.'
          : `Quotation actualisée : ${matched} ligne(s) reconnue(s), ${repriced} prix mis à jour.`,
        'success',
      );
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const applyExportCurrencyChange = async (targetCurrency: string | undefined, applyRate: boolean) => {
    setConvertingCurrency(true);
    try {
      const rates = await applyExportCurrency({ orderId, targetCurrency, applyRate });
      const summary = rates?.map((r) => `1 ${r.currency} = ${r.rate.toFixed(4)} ${targetCurrency}`).join(', ');
      toast(
        !rates ? 'Conversion annulée : chaque ligne du fichier ressortira dans sa devise d\'origine.'
          : applyRate ? `Taux appliqué : ${summary}.`
          : `Devise du fichier changée en ${targetCurrency} sans conversion : les montants restent inchangés.`,
        'success',
      );
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setConvertingCurrency(false);
    }
  };

  const deleteQuotation = async () => {
    setDeleting(true);
    try {
      await removeOrder({ orderId });
      toast('Quotation supprimée. Elle reste visible dans le filtre « Supprimé ».', 'success');
      setConfirmDelete(false);
      onBack();
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const restoreQuotation = async () => {
    try {
      await restoreOrder({ orderId });
      toast('Quotation restaurée.', 'success');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    }
  };

  const setStatus = async (status: 'PO' | 'CANCELLED') => {
    const target = UI_TO_ORDER_STATUS[status];
    if (!target) return;
    try {
      await updateStatus({ orderId, status: target });
      toast(status === 'PO' ? 'PO enregistré : le client a approuvé la demande.' : 'Quotation archivée.', 'success');
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
    }
  };

  // Génère le fichier Excel du gabarit MBSS pour ce périmètre (le modal décide ensuite : téléchargement ou email).
  const fetchExport = async (scope: 'selected' | 'unknown', opts: { eta?: string; clientFormat?: boolean }): Promise<{ fileName: string; base64: string; notice?: string; format: 'client' | 'standard' } | null> => {
    try {
      return await exportXlsx({ orderId, scope, eta: opts.eta, clientFormat: opts.clientFormat });
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
      return null;
    }
  };

  return (
    <div>
      <div className="page-header" style={{ alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={16} /> Retour
        </button>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <StatusTag status={quotation.status} />
          <h1 className="page-title" style={{ fontSize: 18, fontWeight: 500, letterSpacing: 0, color: 'var(--color-text-muted)' }}>{quotation.quotation_number}</h1>
        </div>
      </div>

      <div className="card summary-bar">
        <div className="summary-item">
          <label>Client</label>
          <div className="value" title={quotation.customer_name}>{quotation.customer_name}</div>
          <div className="sub" title={quotation.customer_email ?? ''}>{quotation.customer_email ?? '·'}</div>
        </div>
        <div className="summary-item">
          <label>Région de cotation</label>
          <div className="value">{quotation.countries?.name ?? '·'}</div>
          <div className="sub">{quotation.countries?.city ?? ''}</div>
        </div>
        <div className="summary-item summary-wide">
          <label>Fichier source</label>
          <div className="value" title={quotation.source_file_name ?? ''}>{quotation.source_file_name ?? 'Aucun'}</div>
          <div className="sub">{quotation.item_count} ligne(s) importée(s)</div>
        </div>
        <div className="summary-item">
          <label>Créée le</label>
          <div className="value">{formatDate(quotation.created_at)}</div>
          <div className="sub" title={quotation.owner_email ?? ''}>{quotation.owner_email ? `par ${quotation.owner_email}` : ''}&nbsp;</div>
        </div>
      </div>

      {isAdmin && (
        <RequestInfoCard
          quotation={quotation}
          currencies={currencies}
          pricingCurrency={quotation.countries?.currency ?? ''}
          convertingCurrency={convertingCurrency}
          onApplyExportCurrency={(target, applyRate) => void applyExportCurrencyChange(target, applyRate)}
          cotationMode={cotationMode}
          onCotationModeChange={changeCotationMode}
          onRefresh={() => void refreshPrices()}
          refreshing={refreshing}
          refreshDisabled={validation !== null || ['PO', 'SENT', 'CANCELLED', 'DELETED'].includes(quotation.status)}
          onSaveTransportFee={(fee) =>
            setTransportFee({ orderId, transportFee: fee })
              .then(() => toast(fee ? 'Frais de transport enregistrés : ils figureront dans le fichier après le discount.' : 'Frais de transport retirés.', 'success'))
              .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
          }
          applying={applying} onApply={(cot, dis) => void applyGlobal(cot, dis)} />
      )}

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14 }}>
          <h3 style={{ fontSize: 16 }}>Lignes de la quotation</h3>
          <span className="text-muted" style={{ fontSize: 13, marginLeft: 'auto' }}>
            {includedItems.length}/{items.length} ligne(s) · {unknownCount} inconnue(s) · {reviewCount} à confirmer · cotation {quotation.margin_percentage}%
          </span>
        </div>
        {items.length === 0 ? (
          <StateBox loading variant="table" title="Analyse du document en cours…" subtitle="Les lignes apparaissent ici dès que l'extraction est terminée." />
        ) : (
          <LinesTable
            cotationMode={cotationMode}
            items={items}
            products={products}
            currency={currency}
            countryId={quotation.country_id}
            onDismiss={(it, productId) =>
              dismissProposal({ orderItemId: it.id as Id<'orderItems'>, productId: productId as Id<'products'> })
                .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            edits={edits}
            meId={meId}
            isOwner={quotation.created_by === meId}
            resetKey={editNonce}
            onDecide={(edit, approve) =>
              decideEdit({ editId: edit.id as Id<'orderItemEdits'>, approve })
                .then(() => toast(approve ? 'Modification validée et appliquée.' : 'Modification invalidée.', 'success'))
                .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            onWithdraw={(edit) =>
              withdrawEdit({ editId: edit.id as Id<'orderItemEdits'> }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            onEdit={(it, edit) =>
              updateItem({ orderItemId: it.id as Id<'orderItems'>, ...edit })
                .then((res) => {
                  if (res.applied) return;
                  setEditNonce((n) => n + 1);
                  toast(`Modification proposée : elle sera appliquée quand ${quotation.owner_email ?? 'le propriétaire'} la validera.`, 'info');
                })
                .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            onToggle={(lines, included) =>
              setExcluded({ orderItemIds: lines.map((l) => l.id as Id<'orderItems'>), excluded: !included }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            onConfirm={(it, productId) =>
              confirmMatch({ orderItemId: it.id as Id<'orderItems'>, productId: productId as Id<'products'> })
                .then(() => toast('Correspondance confirmée.', 'success'))
                .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
          />
        )}
        <div className="total-bar" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
          {(discountPercent > 0 || transportFee > 0) && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">Sous-total</span>
              <span className="mono">{formatAmount(quotation.subtotal)}</span>
            </div>
          )}
          {discountPercent > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">Discount global {discountPercent}%</span>
              <span className="mono">-{formatAmount(quotation.subtotal - quotation.total)}</span>
            </div>
          )}
          {transportFee > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="label">(+) Delivery + launch service</span>
              <span className="mono">+{formatAmount(transportFee)}{exportCurrency ? ` ${exportCurrency}` : ''}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="label">Total quotation</span>
            <span className="amount mono">{formatAmount(totalWithFee)}</span>
          </div>
          {convertedTotal !== null && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="label">Total du fichier exporté ({exportCurrency})</span>
              <span className="mono" style={{ fontWeight: 700 }}>{formatAmount(convertedTotal)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="actions-bar">
        <button className="btn" onClick={() => setExportDialog('selected')} disabled={counts.selected === 0}>
          Exporter la sélection ({counts.selected})
        </button>
        <button className="btn" onClick={() => setExportDialog('unknown')} disabled={counts.unknown === 0}>
          Exporter sans prix ({counts.unknown})
        </button>
        {quotation.status === 'DELETED' ? (
          isAdmin && <button className="btn" onClick={() => void restoreQuotation()}>Restaurer</button>
        ) : (
          <>
            <button className="btn" onClick={() => void setStatus('CANCELLED')} disabled={quotation.status === 'CANCELLED'}>Archiver</button>
            {isAdmin && (
              <button className="btn" style={{ color: '#b91c1c', borderColor: '#fecaca' }} onClick={() => setConfirmDelete(true)}>Supprimer</button>
            )}
          </>
        )}
        {validation ? (
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setShowValidation(true)}>
            Détails de validation
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => setValidateModal(true)}
            disabled={quotation.status === 'DELETED' || !canValidate}
            title={canValidate ? "Importer le fichier final du client (articles retenus, quantités, prix)" : 'Réservé au propriétaire de la quotation'}
          >
            Valider la commande
          </button>
        )}
      </div>

      {validation && showValidation && (
        <Modal
          title="Détails de validation"
          wide
          onClose={() => setShowValidation(false)}
          actions={
            canValidate && quotation.status !== 'DELETED' ? (
              <button className="btn btn-sm" onClick={() => setValidateModal(true)}><RefreshCw size={14} /> Remplacer le fichier</button>
            ) : undefined
          }
        >
          <div style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}>
            <ValidationDetails
              quotation={quotation}
              validation={validation}
              currency={currency}
            />
          </div>
        </Modal>
      )}

      {validateModal && (
        <ValidateOrderModal
          orderId={quotation.id}
          quotationNumber={quotation.quotation_number}
          replacing={validation !== null}
          onClose={() => setValidateModal(false)}
          onDone={() => { setValidateModal(false); setShowValidation(true); }}
        />
      )}

      {exportDialog && (
        <ExportModal
          title={exportDialog === 'selected' ? 'Extraire les éléments sélectionnés' : 'Extraire les éléments sans prix'}
          count={counts[exportDialog]}
          quotationNumber={quotation.quotation_number}
          vessel={quotation.vessel}
          defaultTo={quotation.customer_email ?? ''}
          defaultType={exportDialog === 'unknown' ? 'supplier' : 'client'}
          fetchExport={(opts) => fetchExport(exportDialog, opts)}
          onClose={() => setExportDialog(null)}
        />
      )}

      {confirmDelete && (
        <Modal
          title="Supprimer cette quotation ?"
          onClose={() => !deleting && setConfirmDelete(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmDelete(false)} disabled={deleting}>Annuler</button>
            <button className="btn btn-primary" style={{ background: '#dc2626', borderColor: '#dc2626' }} onClick={() => void deleteQuotation()} disabled={deleting}>
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

    </div>
  );
}

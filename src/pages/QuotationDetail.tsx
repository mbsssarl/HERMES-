import React from 'react';
import { useAction, useMutation } from 'convex/react';
import { ArrowLeft, Mail } from 'lucide-react';
import type { Currency, ProductWithPrices, QuotationWithRelations } from '../types';
import { DEFAULT_CURRENCY, MATCH_LABELS, formatPrice, formatAmount, formatDate } from '../lib/format';
import { StatusTag } from '../components/StatusTag';
import { Modal, StateBox } from '../components/ui';
import { LinesTable } from '../components/LinesTable';
import { RequestInfoCard } from '../components/RequestInfoCard';
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
  onBack,
}: {
  quotation: QuotationWithRelations | null;
  products: ProductWithPrices[];
  currencies: Currency[];
  loading: boolean;
  isAdmin: boolean;
  onBack: () => void;
}) {
  const toast = useToast();
  const confirmMatch = useMutation(api.orderItems.confirmAmbiguousMatch);
  const updateItem = useMutation(api.orderItems.update);
  const updateStatus = useMutation(api.orders.updateStatus);
  const applyGlobalPricing = useMutation(api.orders.applyGlobalPricing);
  const exportXlsx = useAction(api.exportQuotation.exportQuotationXlsx);
  const applyExportCurrency = useAction(api.orders.applyExportCurrency);
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
  const removeOrder = useMutation(api.orders.remove);
  const restoreOrder = useMutation(api.orders.restore);
  const [applying, setApplying] = React.useState(false);
  const [convertingCurrency, setConvertingCurrency] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmPo, setConfirmPo] = React.useState(false);
  const [savingPo, setSavingPo] = React.useState(false);
  const [exporting, setExporting] = React.useState<string | null>(null);


  // Ouvrir la quotation fait disparaître son badge « mise à jour » pour cet utilisateur.
  const seenId = quotation?.id;
  const hasUpdate = Boolean(quotation?.catalog_update);
  React.useEffect(() => {
    if (seenId && hasUpdate) markSeen({ orderId: seenId as Id<'orders'> }).catch(() => {});
  }, [seenId, hasUpdate, markSeen]);

  if (loading) return <StateBox loading title="Chargement…" />;
  if (!quotation) return <StateBox title="Quotation introuvable" />;

  const orderId = quotation.id as Id<'orders'>;
  // Devise à afficher pour la commande dans son ensemble (PO, messages) : celle déjà en usage sur ses
  // lignes chiffrées, sinon la devise par défaut de l'entreprise - les pays n'ont plus de devise attachée.
  const currency = quotation.quotation_items.find((it) => it.price_currency)?.price_currency ?? DEFAULT_CURRENCY;
  const items = quotation.quotation_items;
  // Les lignes décochées sont écartées des statistiques.
  const includedItems = items.filter((it) => !it.excluded);
  const isKnown = (it: (typeof items)[number]) => it.match_status === 'MATCHED';
  const counts = {
    selected: includedItems.length,
    known: includedItems.filter(isKnown).length,
    unknown: includedItems.filter((it) => !isKnown(it)).length,
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

  const applyExportCurrencyChange = async (targetCurrency: string | undefined) => {
    setConvertingCurrency(true);
    try {
      const rates = await applyExportCurrency({ orderId, targetCurrency });
      const summary = rates?.map((r) => `1 ${r.currency} = ${r.rate.toFixed(4)} ${targetCurrency}`).join(', ');
      toast(summary ? `Taux appliqué : ${summary}.` : 'Conversion annulée : chaque ligne du fichier ressortira dans sa devise d\'origine.', 'success');
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

  // Télécharge le fichier Excel du gabarit MBSS pour ce périmètre ; renvoie son nom si ça a marché.
  const downloadExport = async (scope: 'selected' | 'known' | 'unknown' | 'all'): Promise<string | null> => {
    try {
      const { fileName, base64 } = await exportXlsx({ orderId, scope });
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      return fileName;
    } catch (err) {
      toast('Erreur: ' + errMsg(err), 'error');
      return null;
    }
  };

  const exportQuotation = async (scope: 'selected' | 'known' | 'unknown' | 'all') => {
    setExporting(scope);
    const fileName = await downloadExport(scope);
    if (fileName) toast('Export Excel téléchargé.', 'success');
    setExporting(null);
  };

  // "Envoyer un email" : télécharge le document (tout ce qui est coché), puis ouvre un brouillon Gmail pré-rempli
  // dans un nouvel onglet. AUCUN site ne peut joindre un fichier à un brouillon Gmail par un lien - c'est bloqué
  // par Gmail lui-même, pas une limite de l'appli : il faut le glisser depuis les téléchargements dans la fenêtre
  // Gmail qui s'ouvre (ou utiliser son trombone), d'où le rappel ci-dessous.
  const emailQuotation = async () => {
    setExporting('email');
    const fileName = await downloadExport('selected');
    setExporting(null);
    if (!fileName) return;

    const subject = `Quotation ${quotation.quotation_number} - MBSS Sarl`;
    const body = [
      'Bonjour,',
      '',
      `Veuillez trouver ci-joint notre quotation ${quotation.quotation_number}${quotation.vessel ? ` pour le navire ${quotation.vessel}` : ''}.`,
      '',
      'Cordialement,',
    ].join('\n');
    const params = new URLSearchParams({
      view: 'cm',
      fs: '1',
      to: quotation.customer_email ?? '',
      su: subject,
      body,
    });
    window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank');
    toast(`"${fileName}" téléchargé - glissez-le dans le brouillon Gmail qui vient de s'ouvrir pour le joindre.`, 'info', { duration: 8000 });
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>
            <ArrowLeft size={16} /> Retour
          </button>
          <h1 className="page-title">{quotation.quotation_number}</h1>
          <p className="page-subtitle">{quotation.customer_name} - {quotation.countries?.name ?? 'Pays non renseigné'}</p>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <StatusTag status={quotation.status} />
        </div>
      </div>

      <div className="card summary-bar">
        <div className="summary-item">
          <label>Client</label>
          <div className="value" title={quotation.customer_name}>{quotation.customer_name}</div>
          <div className="sub" title={quotation.customer_email ?? ''}>{quotation.customer_email ?? '-'}</div>
        </div>
        <div className="summary-item">
          <label>Pays de cotation</label>
          <div className="value">{quotation.countries?.name ?? '-'}</div>
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
          <div className="sub">&nbsp;</div>
        </div>
      </div>

      {isAdmin && (
        <RequestInfoCard
          quotation={quotation}
          currencies={currencies}
          pricingCurrency={DEFAULT_CURRENCY}
          convertingCurrency={convertingCurrency}
          onApplyExportCurrency={(target) => void applyExportCurrencyChange(target)}
          applying={applying} onApply={(cot, dis) => void applyGlobal(cot, dis)} />
      )}

      <div className="card">
        <div className="card-pad" style={{ borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 16 }}>Lignes de la quotation</h3>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {includedItems.length}/{items.length} ligne(s) · {unknownCount} inconnue(s) · {reviewCount} à confirmer · cotation {quotation.margin_percentage}%
          </span>
        </div>
        {items.length === 0 ? (
          <StateBox loading title="Analyse du document en cours…" subtitle="Les lignes apparaissent ici dès que l'extraction est terminée." />
        ) : (
          <LinesTable
            items={items}
            products={products}
            currency={currency}
            countryId={quotation.country_id}
            onDismiss={(it, productId) =>
              dismissProposal({ orderItemId: it.id as Id<'orderItems'>, productId: productId as Id<'products'> })
                .catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
            }
            onEdit={(it, edit) =>
              updateItem({ orderItemId: it.id as Id<'orderItems'>, ...edit }).catch((err) => toast('Erreur: ' + errMsg(err), 'error'))
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
          {(quotation.global_discount_percent ?? 0) > 0 && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="label">Sous-total</span>
                <span className="mono">{formatAmount(quotation.subtotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="label">Discount global {quotation.global_discount_percent}%</span>
                <span className="mono">-{formatAmount(quotation.subtotal - quotation.total)}</span>
              </div>
            </>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="label">Total quotation</span>
            <span className="amount mono">{formatAmount(quotation.total)}</span>
          </div>
        </div>
      </div>

      <div className="actions-bar">
        <button
          className="btn btn-primary"
          onClick={() => void emailQuotation()}
          disabled={exporting !== null || counts.selected === 0}
          title="Télécharge le document sélectionné puis ouvre un brouillon Gmail - le fichier doit ensuite être joint à la main."
        >
          <Mail size={16} /> {exporting === 'email' ? 'Préparation…' : 'Envoyer un email'}
        </button>
        {([
          ['selected', 'Exporter les sélectionnés'],
          ['known', 'Exporter les répertoriés'],
          ['unknown', 'Exporter les non répertoriés'],
          ['all', 'Tout exporter'],
        ] as const).map(([scope, label]) => (
          <button key={scope} className="btn" onClick={() => void exportQuotation(scope)} disabled={exporting !== null || counts[scope] === 0}>
            {exporting === scope ? 'Export…' : `${label} (${counts[scope]})`}
          </button>
        ))}
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
        <button className="btn btn-primary" onClick={() => setConfirmPo(true)} disabled={quotation.status === 'PO' || quotation.status === 'DELETED'} title="Le client a approuvé la demande">
          PO
        </button>
      </div>

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

      {confirmPo && (
        <Modal
          title="Confirmer le PO ?"
          onClose={() => !savingPo && setConfirmPo(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmPo(false)} disabled={savingPo}>Annuler</button>
            <button
              className="btn btn-primary"
              disabled={savingPo}
              onClick={async () => {
                setSavingPo(true);
                await setStatus('PO');
                setSavingPo(false);
                setConfirmPo(false);
              }}
            >
              {savingPo ? 'Enregistrement…' : 'Confirmer le PO'}
            </button>
          </>}
        >
          <p>
            Le client a-t-il approuvé la demande <strong>{quotation.quotation_number}</strong> ?
          </p>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            La quotation passera au statut « PO reçu » ({formatAmount(quotation.total)} {currency}).
          </p>
        </Modal>
      )}
    </div>
  );
}

// Jointure Convex → modèle du front : on convertit les documents Convex
// (camelCase, _id) vers les types historiques de l'UI (snake_case, id).
import type { Doc } from './convex';
import type {
  Country,
  MatchStatus,
  Product,
  ProductPrice,
  ProductWithPrices,
  QuotationItem,
  QuotationStatus,
  QuotationWithRelations,
} from '../types';

type OrderStatus = Doc<'orders'>['status'];

export const ORDER_TO_UI_STATUS: Record<OrderStatus, QuotationStatus> = {
  draft: 'REVIEW_REQUIRED',
  processing: 'PROCESSING',
  awaiting_supplier: 'AWAITING_SUPPLIER',
  po: 'PO',
  completed: 'READY',
  sent: 'SENT',
  archived: 'CANCELLED',
};

export const UI_TO_ORDER_STATUS: Partial<Record<QuotationStatus, OrderStatus>> = {
  REVIEW_REQUIRED: 'draft',
  PROCESSING: 'processing',
  AWAITING_SUPPLIER: 'awaiting_supplier',
  PO: 'po',
  READY: 'completed',
  SENT: 'sent',
  CANCELLED: 'archived',
};

const MATCH_TO_UI: Record<Doc<'orderItems'>['matchStatus'], MatchStatus> = {
  matched_impa: 'MATCHED',
  matched_name: 'MATCHED',
  manual: 'MATCHED',
  ambiguous: 'REVIEW',
  unmatched: 'NOT_FOUND',
};

export function mapCountry(c: Doc<'countries'>): Country {
  return { id: c._id, code: c.code, name: c.name, city: c.city ?? null, active: c.active };
}

export function mapProduct(p: Doc<'products'>): Product {
  return {
    id: p._id,
    reference: p.impaId ?? p.code ?? '',
    name: p.name,
    description: p.description ?? null,
    unit: p.unit,
    category: p.category ?? '',
    active: p.active,
  };
}

export function mapProductWithPrices(p: Doc<'products'>, prices: Doc<'productPrices'>[]): ProductWithPrices {
  const product_prices: ProductPrice[] = prices
    .filter((pr) => pr.productId === p._id)
    .map((pr) => ({
      id: pr._id,
      product_id: pr.productId,
      country_id: pr.countryId,
      base_price: pr.price,
      currency: pr.currency,
    }));
  return { ...mapProduct(p), product_prices };
}

export type OrderRow = Doc<'orders'> & {
  client: Doc<'clients'> | null;
  country: Doc<'countries'> | null;
  itemCount?: number;
  total?: number;
  unresolvedCount?: number;
  catalogUpdate?: { at: number; lines: number; by: string | null } | null;
};

export function mapOrder(
  o: OrderRow,
  items: QuotationItem[] = [],
  sourceFileName: string | null = null,
): QuotationWithRelations {
  // Les lignes décochées n'entrent pas dans les totaux ni dans les compteurs.
  const included = items.filter((it) => !it.excluded);
  // Discount global : appliqué une seule fois, sur le total de toute la commande.
  const discount = o.globalDiscountPercent ?? 0;
  const subtotal = items.length > 0 ? included.reduce((s, it) => s + (it.total_price ?? 0), 0) : (o.total ?? 0) / (1 - discount / 100 || 1);
  const total = Math.round(subtotal * (1 - discount / 100) * 100) / 100;
  const applied = included.find((it) => it.margin_percentage > 0)?.margin_percentage;
  return {
    id: o._id,
    quotation_number: o.reference,
    customer_name: o.client?.name ?? 'Client inconnu',
    customer_email: o.client?.contactEmail ?? null,
    country_id: o.countryId,
    source_file_name: sourceFileName,
    status: o.deletedAt !== undefined ? 'DELETED' : ORDER_TO_UI_STATUS[o.status],
    margin_percentage: o.quotationPercentOverride ?? applied ?? 0,
    total,
    subtotal: Math.round(subtotal * 100) / 100,
    created_at: new Date(o.createdAt).toISOString(),
    created_by: o.createdBy ?? null,
    export_currency: o.exportCurrency ?? null,
    export_rates: o.exportRates ?? [],
    catalog_update: o.catalogUpdate ?? null,
    document_info: o.documentInfo ?? {},
    vessel: o.vessel ?? null,
    eta: o.eta ?? null,
    supply_place: o.supplyPlace ?? null,
    client_order_number: o.clientOrderNumber ?? null,
    quotation_percent_override: o.quotationPercentOverride ?? null,
    global_discount_percent: o.globalDiscountPercent ?? null,
    item_count: items.length > 0 ? included.length : (o.itemCount ?? 0),
    unresolved_count: items.length > 0 ? included.filter((it) => it.match_status !== 'MATCHED').length : (o.unresolvedCount ?? 0),
    countries: o.country
      ? { id: o.country._id, code: o.country.code, name: o.country.name, city: o.country.city ?? null }
      : null,
    quotation_items: items,
  };
}

export type OrderItemRow = Doc<'orderItems'> & {
  product: Doc<'products'> | null;
  ambiguousProducts: (Doc<'products'> | null)[];
};

export function mapOrderItem(it: OrderItemRow): QuotationItem {
  const score =
    it.matchStatus === 'matched_impa' || it.matchStatus === 'manual'
      ? 100
      : it.matchConfidence !== undefined
        ? Math.round(it.matchConfidence * 100)
        : null;
  return {
    id: it._id,
    quotation_id: it.orderId,
    product_id: it.productId ?? null,
    original_description: it.rawDescription,
    quantity: it.quotedQuantity ?? it.rawQuantity ?? 1,
    base_price: it.unitPriceOriginal ?? null,
    price_currency: it.priceCurrency ?? null,
    margin_percentage: it.quotationPercentLine ?? it.quotationPercentApplied ?? 0,
    final_unit_price: it.finalUnitPrice ?? null,
    total_price: it.total ?? null,
    match_status: MATCH_TO_UI[it.matchStatus],
    match_score: score,
    line_no: it.lineNo,
    excluded: it.excluded === true,
    raw_code: it.rawCode ?? null,
    raw_quantity: it.rawQuantity ?? null,
    unit: it.rawUnit ?? null,
    origin: it.rawOrigin ?? null,
    req_notes: it.reqNotes ?? '',
    enq_notes: it.enqNotes ?? '',
    unit_price: it.priceAfterQuotation ?? null,
    unit_price_manual: it.unitPriceManual ?? null,
    line_discount_percent: it.lineDiscountPercent ?? 0,
    candidate_products: it.ambiguousProducts.filter((p): p is Doc<'products'> => p !== null).map(mapProduct),
  };
}

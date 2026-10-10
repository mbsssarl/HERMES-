// Hooks temps réel : chaque écran s'abonne aux requêtes Convex, les mises à jour
// (matching, prix ajoutés, validation fournisseur…) arrivent sans rechargement.
import { useQuery } from 'convex/react';
import React from 'react';
import { api, type Id } from './convex';
import { storedTheme } from './theme';
import { storedLanguage } from './i18n';
import { mapCountry, mapOrder, mapOrderItem, mapProductWithPrices, type OrderItemRow, type OrderRow } from './mappers';
import type { AppUser, Country, Currency, OrderValidation, PendingEdit, ProductCategory, ProductWithPrices, QuotationWithRelations } from '../types';

export function useMe(): AppUser | null | undefined {
  const me = useQuery(api.users.getCurrentUser);
  return React.useMemo(() => {
    if (me === undefined || me === null) return me;
    return { id: me._id, email: me.email ?? '', role: me.role, mustChangePassword: !!me.mustChangePassword, theme: me.theme ?? storedTheme(), language: me.language ?? storedLanguage() };
  }, [me]);
}

export function useCountries(): { countries: Country[]; loading: boolean } {
  const rows = useQuery(api.countries.list, {});
  const countries = React.useMemo(() => (rows ?? []).map(mapCountry), [rows]);
  return { countries, loading: rows === undefined };
}

export function useCurrencies(): { currencies: Currency[]; loading: boolean } {
  const rows = useQuery(api.currencies.list);
  const currencies = React.useMemo(() => (rows ?? []).map((c) => ({ id: c._id, code: c.code, name: c.name, active: c.active })), [rows]);
  return { currencies, loading: rows === undefined };
}

export function useProductCategories(): { categories: ProductCategory[]; loading: boolean } {
  const rows = useQuery(api.productCategories.list);
  const categories = React.useMemo(() => (rows ?? []).map((c) => ({ id: c._id, name: c.name, active: c.active })), [rows]);
  return { categories, loading: rows === undefined };
}

/**
 * Catalogue complet (produits + prix courants). `enabled=false` ne s'abonne à rien : le catalogue est
 * lourd (milliers de produits), inutile de le charger et de le tenir à jour sur les écrans qui n'en
 * ont pas besoin (tableau de bord, liste des quotations...).
 */
export function useProducts(enabled = true): { products: ProductWithPrices[]; loading: boolean } {
  const products = useQuery(api.products.list, enabled ? {} : 'skip');
  const prices = useQuery(api.productPrices.listAllCurrent, enabled ? {} : 'skip');
  const mapped = React.useMemo(() => {
    if (!products || !prices) return [];
    // Prix regroupés par produit en un seul passage (avant : un filter() complet par produit, quadratique).
    const byProduct = new Map<string, typeof prices>();
    for (const pr of prices) {
      const list = byProduct.get(pr.productId);
      if (list) list.push(pr);
      else byProduct.set(pr.productId, [pr]);
    }
    return products.map((p) => mapProductWithPrices(p, byProduct.get(p._id) ?? []));
  }, [products, prices]);
  return { products: mapped, loading: enabled && (products === undefined || prices === undefined) };
}

export function useQuotations(): { quotations: QuotationWithRelations[]; deleted: QuotationWithRelations[]; loading: boolean } {
  const orders = useQuery(api.orders.list, {});
  const deletedOrders = useQuery(api.orders.list, { deleted: true });
  const quotations = React.useMemo(() => (orders ?? []).map((o) => mapOrder(o as OrderRow)), [orders]);
  const deleted = React.useMemo(() => (deletedOrders ?? []).map((o) => mapOrder(o as OrderRow)), [deletedOrders]);
  return { quotations, deleted, loading: orders === undefined };
}

export function useQuotation(id: string | null): { quotation: QuotationWithRelations | null; edits: PendingEdit[]; validation: OrderValidation | null; loading: boolean } {
  const orderId = id as Id<'orders'> | null;
  const order = useQuery(api.orders.get, orderId ? { orderId } : 'skip');
  const items = useQuery(api.orderItems.listByOrder, orderId ? { orderId } : 'skip');
  const files = useQuery(api.files.listByOrder, orderId ? { orderId } : 'skip');
  const validationRow = useQuery(api.orderValidation.get, orderId ? { orderId } : 'skip');
  const validation = React.useMemo<OrderValidation | null>(
    () =>
      validationRow
        ? {
            validated_at: new Date(validationRow.validatedAt).toISOString(),
            validated_by: validationRow.validatedByEmail,
            file_name: validationRow.fileName,
            items: validationRow.items.map((it) => ({
              id: it._id,
              position: it.position,
              line_ref: it.lineRef ?? null,
              code: it.rawCode ?? null,
              description: it.description,
              quantity: it.quantity ?? null,
              unit: it.unit ?? null,
              unit_price: it.unitPrice ?? null,
              margin_percent: it.marginPercent,
              matched: it.matched,
            })),
          }
        : null,
    [validationRow],
  );
  const editRows = useQuery(api.orderItemEdits.listByOrder, orderId ? { orderId } : 'skip');
  const edits = React.useMemo<PendingEdit[]>(
    () =>
      (editRows ?? []).map((r) => ({
        id: r._id,
        item_id: r.orderItemId,
        proposed_by_id: r.proposedBy,
        proposed_by: r.proposedByEmail ?? 'Utilisateur',
        proposed_at: new Date(r.proposedAt).toISOString(),
        changes: r.changes as PendingEdit['changes'],
      })),
    [editRows],
  );
  const quotation = React.useMemo(() => {
    if (!order || !items) return null;
    const source = files?.find((f) => f.kind === 'client_request')?.fileName ?? null;
    return mapOrder(order as OrderRow, (items as OrderItemRow[]).map(mapOrderItem), source);
  }, [order, items, files]);
  return { quotation, edits, validation, loading: !!orderId && (order === undefined || items === undefined) };
}

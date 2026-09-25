// Hooks temps réel : chaque écran s'abonne aux requêtes Convex, les mises à jour
// (matching, prix ajoutés, validation fournisseur…) arrivent sans rechargement.
import { useQuery } from 'convex/react';
import React from 'react';
import { api, type Id } from './convex';
import { mapCountry, mapOrder, mapOrderItem, mapProductWithPrices, type OrderItemRow, type OrderRow } from './mappers';
import type { AppUser, Country, ProductWithPrices, QuotationWithRelations } from '../types';

export function useMe(): AppUser | null | undefined {
  const me = useQuery(api.users.getCurrentUser);
  return React.useMemo(() => {
    if (me === undefined || me === null) return me;
    return { id: me._id, email: me.email ?? '', role: me.role, mustChangePassword: !!me.mustChangePassword };
  }, [me]);
}

export function useCountries(): { countries: Country[]; loading: boolean } {
  const rows = useQuery(api.countries.list, {});
  const countries = React.useMemo(() => (rows ?? []).map(mapCountry), [rows]);
  return { countries, loading: rows === undefined };
}

export function useProducts(): { products: ProductWithPrices[]; loading: boolean } {
  const products = useQuery(api.products.list, {});
  const prices = useQuery(api.productPrices.listAllCurrent, {});
  const mapped = React.useMemo(
    () => (products ?? []).map((p) => mapProductWithPrices(p, prices ?? [])),
    [products, prices],
  );
  return { products: mapped, loading: products === undefined || prices === undefined };
}

export function useQuotations(): { quotations: QuotationWithRelations[]; deleted: QuotationWithRelations[]; loading: boolean } {
  const orders = useQuery(api.orders.list, {});
  const deletedOrders = useQuery(api.orders.list, { deleted: true });
  const quotations = React.useMemo(() => (orders ?? []).map((o) => mapOrder(o as OrderRow)), [orders]);
  const deleted = React.useMemo(() => (deletedOrders ?? []).map((o) => mapOrder(o as OrderRow)), [deletedOrders]);
  return { quotations, deleted, loading: orders === undefined };
}

export function useQuotation(id: string | null): { quotation: QuotationWithRelations | null; loading: boolean } {
  const orderId = id as Id<'orders'> | null;
  const order = useQuery(api.orders.get, orderId ? { orderId } : 'skip');
  const items = useQuery(api.orderItems.listByOrder, orderId ? { orderId } : 'skip');
  const files = useQuery(api.files.listByOrder, orderId ? { orderId } : 'skip');
  const quotation = React.useMemo(() => {
    if (!order || !items) return null;
    const source = files?.find((f) => f.kind === 'client_request')?.fileName ?? null;
    return mapOrder(order as OrderRow, (items as OrderItemRow[]).map(mapOrderItem), source);
  }, [order, items, files]);
  return { quotation, loading: !!orderId && (order === undefined || items === undefined) };
}

import { useMe } from './hooks';

/** Devise utilisée quand l'entreprise n'en a pas choisi une autre. */
export const DEFAULT_CURRENCY = 'USD';

/** Devise de l'entreprise du compte connecté : celle de ses prix et de ses quotations. */
export function useBaseCurrency(): string {
  return useMe()?.companyCurrency ?? DEFAULT_CURRENCY;
}

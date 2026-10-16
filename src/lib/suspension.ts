import React from 'react';

/** Ce que la page de connexion explique à quelqu'un dont l'entreprise est suspendue. */
export interface SuspensionNotice {
  name: string | null;
  /** « subscription » : abonnement échu ; « manual » : décision du super admin. */
  kind: 'manual' | 'subscription' | null;
  /** Motif saisi par le super admin (absent pour un abonnement échu). */
  reason: string | null;
  /** Fin de l'abonnement (ms). */
  endsAt: number | null;
}

let current: SuspensionNotice | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/**
 * Mémorise la raison de la suspension avant de renvoyer l'utilisateur à la page de connexion, qui l'affiche dans
 * une fenêtre d'information. Gardée en mémoire seulement : elle disparaît dès que la fenêtre est refermée.
 */
export function showSuspension(notice: SuspensionNotice): void {
  current = notice;
  emit();
}

export function clearSuspension(): void {
  current = null;
  emit();
}

export function useSuspension(): SuspensionNotice | null {
  return React.useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => current,
  );
}

import React from 'react';

/** Reste avant `endsAt`, décomposé (jamais négatif). */
function split(endsAt: number, now: number) {
  const total = Math.max(0, endsAt - now);
  const days = Math.floor(total / 86_400_000);
  const hours = Math.floor((total % 86_400_000) / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  return { total, days, hours, minutes, seconds };
}

/** Horloge qui se redessine chaque seconde tant que l'écran est affiché. */
function useNow(intervalMs = 1000): number {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Compte à rebours de l'abonnement : « 23 j 04 h 12 min 09 s ». Passe en orange sous 7 jours et en rouge sous
 * 24 heures ; affiche « Expiré » une fois l'échéance atteinte.
 */
export function SubscriptionCountdown({ endsAt, compact = false }: { endsAt: number; compact?: boolean }) {
  const now = useNow();
  const { total, days, hours, minutes, seconds } = split(endsAt, now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const color = total === 0 || total < 86_400_000 ? '#dc2626' : total < 7 * 86_400_000 ? '#d97706' : 'inherit';

  if (total === 0) {
    return <span className="mono" style={{ color, fontWeight: 600 }}>Expiré</span>;
  }
  const text = days > 0
    ? `${days} j ${pad(hours)} h ${pad(minutes)} min${compact ? '' : ` ${pad(seconds)} s`}`
    : `${pad(hours)} h ${pad(minutes)} min ${pad(seconds)} s`;
  return <span className="mono" style={{ color, fontWeight: 600 }} title={new Date(endsAt).toLocaleString('fr-FR')}>{text}</span>;
}

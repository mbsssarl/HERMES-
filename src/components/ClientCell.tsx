import { capitalizeWords, initials } from '../lib/format';

const HUES = [222, 262, 168, 28, 340, 196, 98, 14];

/** Pastille d'initiales + nom du client sur une seule ligne (nom complet au survol). */
export function ClientCell({ name }: { name: string }) {
  const hue = HUES[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % HUES.length];
  return (
    <div className="cell-client" title={name}>
      <span className="avatar" style={{ background: `hsl(${hue} 70% 94%)`, color: `hsl(${hue} 55% 38%)` }}>{initials(name)}</span>
      <span className="cell-client-name">{capitalizeWords(name)}</span>
    </div>
  );
}

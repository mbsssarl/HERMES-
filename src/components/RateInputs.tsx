import React from 'react';

export const fmtRate = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 6, useGrouping: false });
export const parseRate = (raw: string | undefined) => Number((raw ?? '').trim().replace(',', '.'));
/** Retire le préfixe technique « [CONVEX A(...)] [Request ID: ...] » d'un message d'erreur serveur. */
export const cleanServerError = (err: unknown) => {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split('\n')[0].replace(/^\[CONVEX[^\]]*\]\s*(\[Request ID: [^\]]*\]\s*)?/, '');
};
const significant = (n: number) => Number(n.toPrecision(12));

/**
 * Deux cases modifiables qui montrent la conversion : « [1] USD = [500] XAF ».
 * - Les DEUX cases se modifient : on tape directement ce qu'on veut (1 USD = 500 XAF, ou 100 XAF = 0,17 USD...).
 * - Le sens s'affiche par défaut avec la devise la plus forte à gauche (1 USD = 500 XAF plutôt que
 *   1 XAF = 0,002 USD) ; le bouton ⇄ l'inverse.
 * - Le parent reçoit toujours le taux « 1 `from` = X `to` » (texte ; vide = taux du jour), quel que soit le sens affiché.
 */
export function RateInputs({
  from,
  to,
  live,
  value,
  onChange,
  error,
  disabled,
}: {
  from: string;
  to: string;
  /** Taux du jour 1 `from` = `live` `to` (undefined tant qu'il n'est pas chargé ou indisponible). */
  live: number | undefined;
  /** Taux saisi : 1 `from` = `value` `to` (texte) ; vide = taux du jour. */
  value: string;
  onChange: (value: string) => void;
  /** Raison pour laquelle le taux du jour est indisponible (la saisie devient alors obligatoire). */
  error?: string;
  disabled?: boolean;
}) {
  const [flipOverride, setFlipOverride] = React.useState<boolean | undefined>(undefined);
  const [left, setLeft] = React.useState('1');
  const [right, setRight] = React.useState(''); // texte saisi à droite ; vide = taux du jour
  const lastEmitted = React.useRef<string | null>(null);

  const valueNum = parseRate(value);
  const overridden = value.trim() !== '';
  const effective = overridden && valueNum > 0 ? valueNum : live; // taux from -> to en vigueur
  const flipped = flipOverride ?? (effective !== undefined && effective < 1);
  const leftCur = flipped ? to : from;
  const rightCur = flipped ? from : to;
  const oriented = (rateFromTo: number) => (flipped ? 1 / rateFromTo : rateFromTo); // taux left -> right

  // Le parent change la valeur (remise à zéro, taux enregistré rechargé...) : les cases suivent.
  React.useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    setLeft('1');
    if (value.trim() === '') setRight('');
    else {
      const n = parseRate(value);
      setRight(n > 0 ? fmtRate(oriented(n)) : value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const emit = (next: string) => {
    lastEmitted.current = next;
    onChange(next);
  };
  // Taux affiché -> taux from -> to transmis au parent.
  const emitFromBoxes = (leftText: string, rightText: string) => {
    if (rightText.trim() === '') return emit('');
    const l = parseRate(leftText);
    const r = parseRate(rightText);
    if (!(l > 0) || !(r > 0)) return emit(rightText.trim() === '' ? '' : 'invalide');
    const leftToRight = r / l;
    emit(String(significant(flipped ? 1 / leftToRight : leftToRight)));
  };

  // Dès qu'on tape, le sens affiché est figé : sinon les cases s'échangeraient en cours de frappe (ex. en tapant « 0,5 »).
  const lockOrientation = () => { if (flipOverride === undefined) setFlipOverride(flipped); };
  const onRight = (text: string) => {
    lockOrientation();
    setRight(text);
    emitFromBoxes(left, text);
  };
  const onLeft = (text: string) => {
    lockOrientation();
    setLeft(text);
    if (overridden) emitFromBoxes(text, right);
  };
  const flip = () => {
    const next = !flipped;
    setFlipOverride(next);
    setLeft('1');
    setRight(overridden && valueNum > 0 ? fmtRate(next ? 1 / valueNum : valueNum) : '');
  };
  const reset = () => {
    setLeft('1');
    setRight('');
    emit('');
  };

  const leftNum = parseRate(left) > 0 ? parseRate(left) : 1;
  const shownRight = right !== '' ? right : live !== undefined ? fmtRate(oriented(live) * leftNum) : '';

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          inputMode="decimal"
          style={{ width: 90, textAlign: 'right' }}
          value={left}
          disabled={disabled}
          onChange={(e) => onLeft(e.target.value)}
          aria-label={`Quantité de ${leftCur}`}
        />
        <strong>{leftCur}</strong>
        <span>=</span>
        <input
          className="input"
          inputMode="decimal"
          style={{ width: 170 }}
          value={shownRight}
          disabled={disabled}
          placeholder={error ? 'Saisir le taux' : 'Calcul du taux…'}
          onChange={(e) => onRight(e.target.value)}
          aria-label={`Valeur en ${rightCur}`}
        />
        <strong>{rightCur}</strong>
        <button type="button" className="btn" onClick={flip} disabled={disabled} title={`Inverser le sens (1 ${rightCur} = … ${leftCur})`}>⇄</button>
        {overridden && live !== undefined && (
          <button type="button" className="btn" onClick={reset} disabled={disabled}>Taux du jour</button>
        )}
      </div>
      <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
        {live !== undefined
          ? `Taux du jour : 1 ${leftCur} = ${fmtRate(oriented(live))} ${rightCur}. Les deux cases sont modifiables : tapez la conversion exacte voulue.`
          : error
            ? `Pas de taux en ligne pour ${from} → ${to} (${error}) : saisissez la conversion voulue dans les cases.`
            : 'Récupération du taux du jour…'}
      </div>
    </div>
  );
}

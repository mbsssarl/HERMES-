/** Champ texte modifiable dans une cellule : envoyé à la sortie du champ ; la clé le réinitialise quand le serveur renvoie une nouvelle valeur. */
export function TextCell({
  value,
  width,
  onCommit,
  mono,
  placeholder,
  disabled,
}: {
  value: string;
  width: number | string;
  onCommit: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <input
      key={value}
      className={`input cell-input ${mono ? 'mono' : ''}`}
      style={{ width }}
      defaultValue={value}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={(e) => { if (e.target.value !== value) onCommit(e.target.value); }}
    />
  );
}

/** Champ numérique modifiable (virgule ou point accepté). `decimals` fixe l'affichage et l'arrondi. */
export function NumberCell({
  value,
  width,
  onCommit,
  placeholder,
  onClear,
  decimals,
  disabled,
}: {
  value: number | null;
  width: number;
  onCommit: (v: number) => void;
  placeholder?: string;
  /** Si fourni, vider le champ appelle onClear (sinon la valeur précédente est restaurée). */
  onClear?: () => void;
  decimals?: number;
  disabled?: boolean;
}) {
  const format = (n: number) => (decimals !== undefined ? n.toFixed(decimals) : String(n));
  const text = value === null ? '' : format(value);
  return (
    <input
      key={text}
      className="input cell-input mono"
      style={{ width, textAlign: 'right' }}
      inputMode="decimal"
      defaultValue={text}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value.trim().replace(',', '.');
        if (raw === '' && onClear) { if (text !== '') onClear(); return; }
        if (raw === '') { e.target.value = text; return; }
        let n = Number(raw);
        if (!Number.isFinite(n) || n < 0) { e.target.value = text; return; }
        if (decimals !== undefined) {
          const f = 10 ** decimals;
          n = Math.round(n * f) / f;
        }
        if (format(n) === text) { e.target.value = text; return; }
        e.target.value = format(n);
        onCommit(n);
      }}
    />
  );
}

/** Champ texte modifiable dans une cellule : envoyé à la sortie du champ ; la clé le réinitialise quand le serveur renvoie une nouvelle valeur. */
export function TextCell({
  value,
  width,
  onCommit,
  mono,
  placeholder,
  disabled,
  readOnly,
  resetKey,
}: {
  value: string;
  width: number | string;
  /** Change = le champ reprend la valeur du serveur (ex. modification proposée mais pas encore appliquée). */
  resetKey?: number;
  onCommit: (v: string) => void;
  mono?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Affiché comme un champ mais non modifiable (informations issues du catalogue). */
  readOnly?: boolean;
}) {
  return (
    <input
      key={`${value}|${resetKey ?? 0}`}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      className={`input cell-input ${mono ? 'mono' : ''} ${readOnly ? 'cell-readonly' : ''}`}
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
  readOnly,
  resetKey,
}: {
  value: number | null;
  width: number;
  resetKey?: number;
  onCommit: (v: number) => void;
  placeholder?: string;
  /** Si fourni, vider le champ appelle onClear (sinon la valeur précédente est restaurée). */
  onClear?: () => void;
  decimals?: number;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const format = (n: number) => (decimals !== undefined ? n.toFixed(decimals) : String(n));
  const text = value === null ? '' : format(value);
  return (
    <input
      key={`${text}|${resetKey ?? 0}`}
      readOnly={readOnly}
      tabIndex={readOnly ? -1 : undefined}
      className={`input cell-input mono ${readOnly ? 'cell-readonly' : ''}`}
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

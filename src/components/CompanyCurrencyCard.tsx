import React from 'react';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '../lib/convex';
import type { Currency } from '../types';
import { Modal } from './ui';
import { useToast } from './Toast';
import { RateInputs, cleanServerError, parseRate } from './RateInputs';

/**
 * Devise utilisée par l'entreprise (celle des prix et des quotations). L'admin peut la changer en choisissant de
 * ne changer que le libellé, ou de convertir tous les montants déjà enregistrés avec un taux.
 */
export function CompanyCurrencyCard({ currencies }: { currencies: Currency[] }) {
  const toast = useToast();
  const state = useQuery(api.companyCurrency.get);
  const change = useMutation(api.companyCurrency.change);
  const getRate = useAction(api.exchangeRates.getRate);

  const [open, setOpen] = React.useState(false);
  const [to, setTo] = React.useState('');
  const [mode, setMode] = React.useState<'relabel' | 'convert'>('relabel');
  const [rateText, setRateText] = React.useState('');
  const [live, setLive] = React.useState<number | undefined>(undefined);
  const [liveError, setLiveError] = React.useState<string | undefined>(undefined);
  const [saving, setSaving] = React.useState(false);

  const current = state?.currency ?? '';
  const options = currencies.filter((c) => c.active && c.code !== current);

  // Taux du jour de l'ancienne devise vers la nouvelle (aperçu ; rien n'est enregistré avant la validation).
  React.useEffect(() => {
    setLive(undefined);
    setLiveError(undefined);
    if (!open || mode !== 'convert' || !to || !current) return;
    let cancelled = false;
    getRate({ from: current, to })
      .then((r) => { if (!cancelled) setLive(r.rate); })
      .catch((err) => { if (!cancelled) setLiveError(cleanServerError(err)); });
    return () => { cancelled = true; };
  }, [open, mode, to, current, getRate]);

  if (state === undefined) return null;

  const overridden = rateText.trim() !== '';
  const typed = parseRate(rateText);
  const effectiveRate = overridden ? typed : live;
  const rateOk = mode === 'relabel' || (effectiveRate !== undefined && effectiveRate > 0);
  const canSubmit = Boolean(to) && rateOk && !saving;

  const close = () => { if (saving) return; setOpen(false); setTo(''); setMode('relabel'); setRateText(''); };

  const submit = async () => {
    setSaving(true);
    try {
      await change({ to, mode, rate: mode === 'convert' ? effectiveRate : undefined });
      toast(`Devise de l'entreprise : ${to}.`, 'success');
      setSaving(false);
      close();
    } catch (err) {
      toast('Erreur: ' + cleanServerError(err), 'error');
      setSaving(false);
    }
  };

  return (
    <>
      <div className="card card-pad" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="text-muted" style={{ fontSize: 13 }}>Devise utilisée</div>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{current}</div>
          {state.change && (
            <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
              Changement en cours : {state.change.from} → {state.change.to}…
            </div>
          )}
        </div>
        <button className="btn btn-primary" disabled={Boolean(state.change)} onClick={() => setOpen(true)}>Changer la devise</button>
      </div>

      {open && (
        <Modal
          title="Changer la devise"
          onClose={close}
          footer={<>
            <button className="btn" onClick={close} disabled={saving}>Annuler</button>
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!canSubmit}>{saving ? 'Application…' : 'Changer la devise'}</button>
          </>}
        >
          <div className="form-field">
            <label>Nouvelle devise</label>
            <select className="select" value={to} onChange={(e) => setTo(e.target.value)} autoFocus>
              <option value="">Choisir…</option>
              {options.map((c) => <option key={c.id} value={c.code}>{c.code} · {c.name}</option>)}
            </select>
          </div>

          <div className="form-field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <input type="radio" name="currency-mode" checked={mode === 'relabel'} onChange={() => setMode('relabel')} style={{ marginTop: 3 }} />
              <span>
                <strong>Changer seulement le libellé</strong>
                <span className="text-muted" style={{ display: 'block', fontSize: 13 }}>Les montants restent identiques{current && to ? ` : 100 ${current} deviennent 100 ${to}` : ''}.</span>
              </span>
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', marginTop: 10 }}>
              <input type="radio" name="currency-mode" checked={mode === 'convert'} onChange={() => setMode('convert')} style={{ marginTop: 3 }} />
              <span>
                <strong>Convertir tous les prix enregistrés</strong>
                <span className="text-muted" style={{ display: 'block', fontSize: 13 }}>Catalogue et quotations : les montants sont multipliés par le taux.</span>
              </span>
            </label>
          </div>

          {mode === 'convert' && to && (
            <div className="form-field">
              <RateInputs from={current} to={to} live={live} value={rateText} onChange={setRateText} error={liveError} disabled={saving} />
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

import React from 'react';
import type { QuotationWithRelations } from '../types';
import { locale, useT } from '../lib/i18n';

type Period = '7d' | '30d' | '12m';

interface Bucket { key: string; label: string; po: number; other: number }

/** Plus petit « beau » maximum d'axe (4, 5, 10, 20, 50...) au moins égal à la valeur. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= value) ?? value;
}

function buildBuckets(quotations: QuotationWithRelations[], period: Period): Bucket[] {
  const now = new Date();
  const buckets: Bucket[] = [];
  const byMonth = period === '12m';
  const count = period === '7d' ? 7 : period === '30d' ? 30 : 12;
  const keyOf = (d: Date) => (byMonth ? `${d.getFullYear()}-${d.getMonth()}` : `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`);
  for (let i = count - 1; i >= 0; i--) {
    const d = byMonth ? new Date(now.getFullYear(), now.getMonth() - i, 1) : new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const label = byMonth
      ? d.toLocaleDateString(locale(), { month: 'short' })
      : d.toLocaleDateString(locale(), period === '7d' ? { weekday: 'short', day: 'numeric' } : { day: 'numeric' });
    buckets.push({ key: keyOf(d), label, po: 0, other: 0 });
  }
  for (const q of quotations) {
    const bucket = buckets.find((b) => b.key === keyOf(new Date(q.created_at)));
    if (!bucket) continue;
    if (q.status === 'PO') bucket.po++;
    else bucket.other++;
  }
  return buckets;
}

const MUTED = 'var(--color-text-muted, #6b7390)';

/** Histogramme du nombre de quotations créées par jour / par mois, avec la part de PO reçus. */
export function QuotationsChart({ quotations }: { quotations: QuotationWithRelations[] }) {
  const t = useT();
  const [period, setPeriod] = React.useState<Period>('30d');
  const buckets = React.useMemo(() => buildBuckets(quotations, period), [quotations, period]);
  const total = buckets.reduce((s, b) => s + b.po + b.other, 0);
  const max = niceMax(Math.max(0, ...buckets.map((b) => b.po + b.other)));

  const [W, setW] = React.useState(520);
  const box = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setW(Math.max(260, Math.floor(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 150, left = 28, right = 4, top = 8, bottom = 22;
  const plotW = W - left - right, plotH = H - top - bottom;
  const slot = plotW / buckets.length;
  const barW = Math.min(slot * 0.62, 34);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const labelEvery = period === '30d' ? 3 : 1;
  const periods: Array<{ id: Period; label: string }> = [
    { id: '7d', label: t('dashboard.chart7d') },
    { id: '30d', label: t('dashboard.chart30d') },
    { id: '12m', label: t('dashboard.chart12m') },
  ];

  return (
    <div className="card stats-chart">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '16px 20px 4px' }}>
        <div>
          <h3 style={{ fontSize: 15 }}>{t('dashboard.chartTitle')}</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{t('dashboard.chartTotal', { n: total })}</p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {periods.map((p) => (
            <button key={p.id} className={`btn btn-sm ${period === p.id ? 'btn-primary' : ''}`} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>
      <div ref={box} style={{ padding: '0 20px 10px' }}>
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('dashboard.chartTitle')} width={W} height={H} style={{ display: 'block' }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={f}>
              <line x1={left} x2={W - right} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={left - 6} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{Math.round(max * f)}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = left + i * slot + (slot - barW) / 2;
            const otherH = (b.other / max) * plotH;
            const poH = (b.po / max) * plotH;
            return (
              <g key={b.key}>
                <title>{`${b.label} : ${b.po + b.other} (${t('dashboard.chartPo')} : ${b.po})`}</title>
                {b.other > 0 && <rect x={x} y={y(b.other + b.po)} width={barW} height={otherH} rx={3} fill="var(--color-primary)" opacity={0.45} />}
                {b.po > 0 && <rect x={x} y={y(b.po)} width={barW} height={poH} rx={3} fill="var(--color-primary)" />}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>{b.label}</text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="text-muted" style={{ display: 'flex', gap: 16, fontSize: 12, padding: '2px 0 0 28px' }}>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--color-primary)', opacity: 0.45, marginRight: 6 }} />{t('dashboard.chartOther')}</span>
          <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--color-primary)', marginRight: 6 }} />{t('dashboard.chartPo')}</span>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import type { QuotationWithRelations } from '../types';
import { locale, useT } from '../lib/i18n';

type Period = '7d' | '30d' | '12m';

interface Bucket { key: string; label: string; /** Deuxième ligne de l'étiquette (n° du jour sous le jour de la semaine). */ sub?: string; po: number; other: number }

/** Pas d'axe entier (1, 2, 5, 10, 20, 50...) pour que le sommet de l'échelle tienne en 4 intervalles. */
function niceStep(maxValue: number): number {
  const raw = maxValue / 4;
  if (raw <= 1) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
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
      : period === '7d'
        ? d.toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '')
        : d.toLocaleDateString(locale(), { day: 'numeric' });
    buckets.push({ key: keyOf(d), label, sub: period === '7d' ? String(d.getDate()) : undefined, po: 0, other: 0 });
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
const HEIGHT = 168;

/** Histogramme du nombre de quotations créées par jour / par mois, avec la part de PO reçus. */
export function QuotationsChart({ quotations }: { quotations: QuotationWithRelations[] }) {
  const t = useT();
  const [period, setPeriod] = React.useState<Period>('30d');
  const [active, setActive] = React.useState<number | null>(null);
  const buckets = React.useMemo(() => buildBuckets(quotations, period), [quotations, period]);
  const total = buckets.reduce((s, b) => s + b.po + b.other, 0);
  const peak = Math.max(0, ...buckets.map((b) => b.po + b.other));
  const step = niceStep(peak);
  const max = step * 4;

  // Largeur réelle du contenu (sans les marges internes) : le graphique ne déborde jamais de sa carte.
  const [W, setW] = React.useState(320);
  const box = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = Math.floor(entries[0].contentRect.width);
      if (width > 0) setW(width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = HEIGHT;
  const left = 10 + String(max).length * 7, right = 4, top = 16, bottom = period === '7d' ? 38 : 24;
  const plotW = Math.max(W - left - right, 40), plotH = H - top - bottom;
  const slot = plotW / buckets.length;
  const barW = Math.max(Math.min(slot * 0.6, 30), 3);
  const y = (v: number) => top + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(36 / slot));
  const showValues = slot >= 22;
  const periods: Array<{ id: Period; label: string }> = [
    { id: '7d', label: t('dashboard.chart7d') },
    { id: '30d', label: t('dashboard.chart30d') },
    { id: '12m', label: t('dashboard.chart12m') },
  ];
  const detail = active !== null ? buckets[active] : null;

  return (
    <div className="card stats-chart">
      <div className="chart-head">
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 15 }}>{t('dashboard.chartTitle')}</h3>
          <p className="text-muted" style={{ fontSize: 13, marginTop: 2 }}>{t('dashboard.chartTotal', { n: total })}</p>
        </div>
        <div className="chart-periods" role="group" aria-label={t('dashboard.chartTitle')}>
          {periods.map((p) => (
            <button
              key={p.id}
              className={`btn btn-sm ${period === p.id ? 'btn-primary' : ''}`}
              aria-pressed={period === p.id}
              onClick={() => { setPeriod(p.id); setActive(null); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={box} className="chart-body">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('dashboard.chartTitle')} style={{ display: 'block', maxWidth: '100%' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <g key={i}>
              <line x1={left} x2={W - right} y1={y(step * i)} y2={y(step * i)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={left - 6} y={y(step * i) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{step * i}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const x = left + i * slot + (slot - barW) / 2;
            const sum = b.po + b.other;
            return (
              <g
                key={b.key}
                className="chart-col"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onClick={() => setActive(i === active ? null : i)}
              >
                <title>{`${b.label}${b.sub ? ` ${b.sub}` : ''} : ${sum} (${t('dashboard.chartPo')} : ${b.po})`}</title>
                {/* Zone de survol / de toucher sur toute la hauteur de la colonne */}
                <rect x={left + i * slot} y={top} width={slot} height={plotH} fill="transparent" />
                {b.other > 0 && <rect x={x} y={y(sum)} width={barW} height={(b.other / max) * plotH} rx={3} fill="var(--color-primary)" opacity={0.42} />}
                {b.po > 0 && <rect x={x} y={y(b.po)} width={barW} height={(b.po / max) * plotH} rx={3} fill="var(--color-primary)" />}
                {showValues && sum > 0 && (
                  <text x={x + barW / 2} y={Math.max(y(sum) - 4, 11)} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-text, #1a2140)">{sum}</text>
                )}
                {i % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - (b.sub ? 21 : 7)} textAnchor="middle" fontSize={11} fill={active === i ? 'var(--color-text, #1a2140)' : MUTED}>
                    {b.label}
                    {b.sub && <tspan x={x + barW / 2} dy={14}>{b.sub}</tspan>}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {total === 0 && <p className="chart-empty text-muted">{t('dashboard.chartEmpty')}</p>}

        <div className="chart-legend text-muted">
          <span className="chart-key"><i style={{ opacity: 0.42 }} />{t('dashboard.chartOther')}</span>
          <span className="chart-key"><i />{t('dashboard.chartPo')}</span>
          <span className="chart-detail">{detail ? `${detail.label}${detail.sub ? ` ${detail.sub}` : ''} · ${detail.po + detail.other} (${t('dashboard.chartPo')} : ${detail.po})` : ''}</span>
        </div>
      </div>
    </div>
  );
}

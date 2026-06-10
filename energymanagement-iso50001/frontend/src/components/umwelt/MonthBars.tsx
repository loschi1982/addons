import { useMemo, useState } from 'react';

const nf = (n: number | null | undefined, d = 0) =>
  n == null
    ? '—'
    : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

interface MonthBarsProps {
  /** Werte je Monat (aktuelle Reihe). */
  data: number[];
  /** Optionale Vergleichsreihe (z. B. Vorjahr). */
  prev?: number[] | null;
  /** Monatslabels (gleiche Länge wie data). */
  months: string[];
  color?: string;
  prevColor?: string;
  /** Optionale Ziel-Linie. */
  target?: number | null;
  targetLabel?: string;
  unit?: string;
  height?: number;
  decimals?: number;
  tipTitle?: (m: string, i: number) => string;
}

/**
 * Balkendiagramm: ein Wert je Monat, optional Vergleichsreihe + Ziel-Linie.
 * Reines SVG, theme-aware über CSS-Variablen, Hover-Tooltip via `.chart-tip`.
 * Portiert aus dem Claude-Design-Handoff (umwelt-charts.jsx).
 */
export default function MonthBars({
  data,
  prev,
  months,
  color = 'var(--fw-fernwaerme)',
  prevColor,
  target,
  targetLabel,
  unit = '',
  height = 280,
  decimals = 0,
  tipTitle = (m) => m,
}: MonthBarsProps) {
  const padTop = 22;
  const padBottom = 30;
  const padL = 56;
  const padR = 14;
  const W = 760;
  const innerH = height - padTop - padBottom;
  const [hover, setHover] = useState<number | null>(null);
  const vals = data.concat(prev || []).concat(target != null ? [target] : []);
  const max = Math.max(...vals, 1) * 1.08;
  const colW = (W - padL - padR) / months.length;
  const y = (v: number) => padTop + innerH * (1 - v / max);
  const active = hover != null;
  const tipLeft = active ? ((padL + hover * colW + colW / 2) / W) * 100 : 50;
  const tipTop = active ? y(Math.max(data[hover], prev ? prev[hover] : 0)) : 0;
  const grad = useMemo(() => 'mb-' + Math.random().toString(36).slice(2, 7), []);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
      >
        <defs>
          <linearGradient id={grad} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.95" />
            <stop offset="100%" stopColor={color} stopOpacity="0.7" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => {
          const yy = padTop + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
              <text
                x={padL - 8}
                y={yy + 3}
                textAnchor="end"
                fontSize="10"
                style={{ fill: 'var(--chart-axis)' }}
                fontFamily="'Geist Mono', monospace"
              >
                {nf(max * p, decimals)}
              </text>
            </g>
          );
        })}
        {target != null && (
          <g>
            <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="var(--good)" strokeDasharray="4 3" strokeWidth={1.5} />
            <text x={W - padR} y={y(target) - 5} textAnchor="end" fontSize="10" fill="var(--good)" fontWeight={600}>
              {targetLabel || `Ziel ${nf(target, decimals)} ${unit}`}
            </text>
          </g>
        )}
        {months.map((m, i) => {
          const barW = colW * (prev ? 0.3 : 0.52);
          const gap = prev ? colW * 0.06 : 0;
          const baseX = padL + i * colW + colW / 2;
          const dim = active && hover !== i;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={padL + i * colW} y={padTop} width={colW} height={innerH} fill="transparent" />
              {hover === i && (
                <rect x={padL + i * colW + 1} y={padTop} width={colW - 2} height={innerH} rx={6} fill="var(--chart-ink)" opacity={0.05} />
              )}
              {prev && (
                <rect
                  style={{ transition: 'opacity 160ms' }}
                  x={baseX - barW - gap / 2}
                  y={y(prev[i])}
                  width={barW}
                  height={padTop + innerH - y(prev[i])}
                  rx={3}
                  fill={prevColor || 'var(--ink-4)'}
                  opacity={dim ? 0.18 : 0.4}
                />
              )}
              <rect
                style={{ transition: 'opacity 160ms' }}
                x={prev ? baseX + gap / 2 : baseX - barW / 2}
                y={y(data[i])}
                width={barW}
                height={padTop + innerH - y(data[i])}
                rx={Math.min(barW / 2, 4)}
                fill={`url(#${grad})`}
                opacity={dim ? 0.28 : 1}
              />
              <text
                x={baseX}
                y={padTop + innerH + 17}
                textAnchor="middle"
                fontSize="11"
                style={{ fill: hover === i ? 'var(--chart-ink)' : 'var(--chart-axis)' }}
                fontWeight={hover === i ? 600 : 400}
                fontFamily="'Geist Mono', monospace"
              >
                {m}
              </text>
            </g>
          );
        })}
      </svg>
      <div
        className="chart-tip"
        style={{
          left: `${tipLeft}%`,
          top: tipTop,
          opacity: active ? 1 : 0,
          transform: `translate(-50%, calc(-100% - 10px)) scale(${active ? 1 : 0.94})`,
          pointerEvents: 'none',
        }}
      >
        {active && (
          <>
            <div className="chart-tip-head">
              <span className="chart-tip-month">{tipTitle(months[hover], hover)}</span>
            </div>
            <div className="chart-tip-rows">
              <div className="chart-tip-row">
                <span className="chart-tip-dot" style={{ background: color }} />
                <span className="chart-tip-label">Aktuell</span>
                <span className="chart-tip-val">
                  {nf(data[hover], decimals)}
                  <span className="chart-tip-unit"> {unit}</span>
                </span>
              </div>
              {prev && (
                <div className="chart-tip-row">
                  <span className="chart-tip-dot" style={{ background: prevColor || 'var(--ink-4)' }} />
                  <span className="chart-tip-label">Vorjahr</span>
                  <span className="chart-tip-val">
                    {nf(prev[hover], decimals)}
                    <span className="chart-tip-unit"> {unit}</span>
                  </span>
                </div>
              )}
            </div>
            <span className="chart-tip-arrow" />
          </>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';

const nf = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export interface LineSeries {
  key: string;
  label: string;
  color: string;
  data: Array<number | null>;
  unit?: string;
  decimals?: number;
  dash?: boolean;
}

interface MultiLineProps {
  series: LineSeries[];
  labels: string[];
  height?: number;
  yUnit?: string;
  yMin?: number;
  yMax?: number;
  decimals?: number;
  bands?: Array<{ from: number; to: number; color: string; opacity?: number }>;
  xTickEvery?: number;
}

/**
 * Mehrere Zeitreihen mit gemeinsamer X-Achse, Hover-Crosshair und Tooltip.
 * Reines SVG, theme-aware über CSS-Variablen. Portiert aus umwelt-charts.jsx.
 */
export default function MultiLine({
  series,
  labels,
  height = 280,
  yUnit = '',
  yMin,
  yMax,
  decimals = 1,
  bands,
  xTickEvery = 1,
}: MultiLineProps) {
  const padTop = 18;
  const padBottom = 28;
  const padL = 48;
  const padR = 16;
  const W = 760;
  const innerH = height - padTop - padBottom;
  const innerW = W - padL - padR;
  const n = labels.length;
  const allVals = series.flatMap((s) => s.data).filter((v): v is number => v != null);
  const lo = yMin != null ? yMin : allVals.length ? Math.min(...allVals) : 0;
  const hi = yMax != null ? yMax : allVals.length ? Math.max(...allVals) : 1;
  const span = hi - lo || 1;
  const x = (i: number) => padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padTop + innerH * (1 - (v - lo) / span);
  const [hover, setHover] = useState<number | null>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let idx = Math.round(((px - padL) / innerW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  };
  const active = hover != null;
  const tipLeft = active ? (x(hover) / W) * 100 : 50;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((p) => lo + span * p);

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {bands &&
          bands.map((b, i) => (
            <rect
              key={i}
              x={padL}
              y={y(b.to)}
              width={innerW}
              height={Math.max(0, y(b.from) - y(b.to))}
              fill={b.color}
              opacity={b.opacity != null ? b.opacity : 0.08}
            />
          ))}
        {ticks.map((t, i) => {
          const yy = y(t);
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={yy} y2={yy} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
              <text
                x={padL - 8}
                y={yy + 3}
                textAnchor="end"
                fontSize="10"
                style={{ fill: 'var(--chart-axis)' }}
                fontFamily="'Geist Mono', monospace"
              >
                {nf(t, decimals)}
              </text>
            </g>
          );
        })}
        {labels.map(
          (lb, i) =>
            i % xTickEvery === 0 && (
              <text
                key={i}
                x={x(i)}
                y={height - 8}
                textAnchor="middle"
                fontSize="10"
                style={{ fill: hover === i ? 'var(--chart-ink)' : 'var(--chart-axis)' }}
                fontWeight={hover === i ? 600 : 400}
                fontFamily="'Geist Mono', monospace"
              >
                {lb}
              </text>
            )
        )}
        {active && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={padTop}
            y2={padTop + innerH}
            stroke="var(--chart-ink)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.35}
          />
        )}
        {series.map((s) => {
          const pts = s.data
            .map((v, i) => (v == null ? null : ([x(i), y(v)] as [number, number])))
            .filter((p): p is [number, number] => p != null);
          const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
          const hv = hover != null ? s.data[hover] : null;
          return (
            <g key={s.key}>
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={s.dash ? { strokeDasharray: '5 4' } : undefined}
              />
              {active && hv != null && (
                <circle cx={x(hover)} cy={y(hv)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={1.5} />
              )}
            </g>
          );
        })}
      </svg>
      <div
        className="chart-tip"
        style={{
          left: `${tipLeft}%`,
          top: padTop,
          opacity: active ? 1 : 0,
          transform: `translate(-50%, calc(-100% + 4px)) scale(${active ? 1 : 0.94})`,
          pointerEvents: 'none',
        }}
      >
        {active && (
          <>
            <div className="chart-tip-head">
              <span className="chart-tip-month">{labels[hover]}</span>
            </div>
            <div className="chart-tip-rows">
              {series.map(
                (s) =>
                  s.data[hover] != null && (
                    <div className="chart-tip-row" key={s.key}>
                      <span className="chart-tip-dot" style={{ background: s.color }} />
                      <span className="chart-tip-label">{s.label}</span>
                      <span className="chart-tip-val">
                        {nf(s.data[hover], s.decimals != null ? s.decimals : decimals)}
                        <span className="chart-tip-unit"> {s.unit || yUnit}</span>
                      </span>
                    </div>
                  )
              )}
            </div>
            <span className="chart-tip-arrow" />
          </>
        )}
      </div>
    </div>
  );
}

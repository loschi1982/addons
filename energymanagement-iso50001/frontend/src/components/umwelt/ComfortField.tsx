import { useState } from 'react';

const nf = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

export interface ComfortPoint {
  zone: string;
  t: number;
  rh: number;
  status: 'good' | 'warn' | 'alert';
}

/**
 * Behaglichkeitsfeld: operative Temperatur × rel. Feuchte je Zone, mit
 * Komfortzone nach DIN EN 16798-1. Portiert aus umwelt-charts.jsx.
 */
export default function ComfortField({ points, height = 320 }: { points: ComfortPoint[]; height?: number }) {
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 36;
  const W = 560;
  const innerW = W - padL - padR;
  const innerH = height - padT - padB;
  const tMin = 16;
  const tMax = 28;
  const rhMin = 20;
  const rhMax = 70;
  const x = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * innerW;
  const y = (rh: number) => padT + innerH * (1 - (rh - rhMin) / (rhMax - rhMin));
  const [hover, setHover] = useState<number | null>(null);

  const comfortPoly: Array<[number, number]> = [
    [20, 30],
    [22, 30],
    [26, 40],
    [26, 60],
    [22, 60],
    [20, 50],
  ];
  const polyStr = comfortPoly.map(([t, rh]) => `${x(t)},${y(rh)}`).join(' ');
  const statusColor: Record<string, string> = { good: 'var(--good)', warn: 'var(--warn)', alert: 'var(--alert)' };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height, display: 'block' }}>
        {[20, 30, 40, 50, 60, 70].map((rh) => (
          <g key={rh}>
            <line x1={padL} x2={W - padR} y1={y(rh)} y2={y(rh)} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
            <text x={padL - 8} y={y(rh) + 3} textAnchor="end" fontSize="10" style={{ fill: 'var(--chart-axis)' }} fontFamily="'Geist Mono', monospace">
              {rh}
            </text>
          </g>
        ))}
        {[16, 18, 20, 22, 24, 26, 28].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={padT} y2={padT + innerH} style={{ stroke: 'var(--chart-grid)' }} strokeWidth={1} />
            <text x={x(t)} y={height - 18} textAnchor="middle" fontSize="10" style={{ fill: 'var(--chart-axis)' }} fontFamily="'Geist Mono', monospace">
              {t}
            </text>
          </g>
        ))}
        <polygon points={polyStr} className="behag-zone" />
        <text x={x(24.4)} y={y(63)} textAnchor="middle" fontSize="10.5" fill="var(--good)" fontWeight={600} opacity={0.9}>
          Behaglichkeitsfeld
        </text>
        <text x={padL + innerW / 2} y={height - 2} textAnchor="middle" fontSize="10.5" style={{ fill: 'var(--chart-muted)' }}>
          Operative Temperatur (°C)
        </text>
        <text
          x={14}
          y={padT + innerH / 2}
          textAnchor="middle"
          fontSize="10.5"
          style={{ fill: 'var(--chart-muted)' }}
          transform={`rotate(-90 14 ${padT + innerH / 2})`}
        >
          rel. Feuchte (%)
        </text>
        {points.map((p, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }}>
            <circle cx={x(p.t)} cy={y(p.rh)} r={hover === i ? 11 : 8} fill={statusColor[p.status]} opacity={0.18} />
            <circle cx={x(p.t)} cy={y(p.rh)} r={5} fill={statusColor[p.status]} stroke="var(--surface)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      {points.length > 0 && (
        <div
          className="chart-tip"
          style={{
            left: `${(x(points[hover != null ? hover : 0].t) / W) * 100}%`,
            top: hover != null ? y(points[hover].rh) : 0,
            opacity: hover != null ? 1 : 0,
            transform: `translate(-50%, calc(-100% - 12px)) scale(${hover != null ? 1 : 0.94})`,
            pointerEvents: 'none',
          }}
        >
          {hover != null && (
            <>
              <div className="chart-tip-head">
                <span className="chart-tip-month">{points[hover].zone}</span>
              </div>
              <div className="chart-tip-rows">
                <div className="chart-tip-row">
                  <span className="chart-tip-dot" style={{ background: 'var(--fw-fernwaerme)' }} />
                  <span className="chart-tip-label">Temperatur</span>
                  <span className="chart-tip-val">
                    {nf(points[hover].t, 1)}
                    <span className="chart-tip-unit"> °C</span>
                  </span>
                </div>
                <div className="chart-tip-row">
                  <span className="chart-tip-dot" style={{ background: 'var(--fw-wasser)' }} />
                  <span className="chart-tip-label">rel. Feuchte</span>
                  <span className="chart-tip-val">
                    {nf(points[hover].rh, 0)}
                    <span className="chart-tip-unit"> %</span>
                  </span>
                </div>
              </div>
              <span className="chart-tip-arrow" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

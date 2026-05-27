import { useState } from 'react';

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' Mio.';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
}

interface HoverTooltipProps {
  hover: number;
  colW: number;
  padL: number;
  data: Record<string, number[]>;
  keys: string[];
  colors: Record<string, string>;
  names: Record<string, string>;
  units: Record<string, string>;
  chartWidth: number;
}

function HoverTooltip({ hover, colW, padL, data, keys, colors, names, units, chartWidth }: HoverTooltipProps) {
  const activeKeys = keys.filter((k) => (data[k]?.[hover] ?? 0) > 0);
  const tooltipW = 180;
  const lineH = 16;
  const paddingV = 8;
  const tooltipH = activeKeys.length * lineH + paddingV * 2;

  const rawCx = padL + hover * colW + colW / 2;
  const cx = Math.min(Math.max(rawCx, tooltipW / 2 + 4), chartWidth - tooltipW / 2 - 4);
  const ty = 4;

  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={cx - tooltipW / 2} y={ty}
        width={tooltipW} height={tooltipH}
        rx={4} fill="#0A0A0B"
      />
      {activeKeys.map((k, i) => {
        const val = data[k]?.[hover] ?? 0;
        const unit = units[k] ?? 'kWh';
        const ly = ty + paddingV + i * lineH + lineH / 2 + 2;
        return (
          <g key={k}>
            <rect
              x={cx - tooltipW / 2 + 8} y={ly - 5}
              width={6} height={6} rx={1}
              fill={colors[k] ?? '#888'}
            />
            <text
              x={cx - tooltipW / 2 + 18} y={ly}
              fontSize="10" fill="#D4D0C8"
              fontFamily="ui-monospace, 'Geist Mono', monospace"
            >
              {names[k] ?? k}
            </text>
            <text
              x={cx + tooltipW / 2 - 8} y={ly}
              textAnchor="end" fontSize="10" fill="#FFF"
              fontFamily="ui-monospace, 'Geist Mono', monospace"
            >
              {fmtNum(val)} {unit}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface StackedMonthlyProps {
  data: Record<string, number[]>;
  months: string[];
  colors: Record<string, string>;
  names?: Record<string, string>;
  units?: Record<string, string>;
  height?: number;
  currentMonthIdx?: number;
}

export default function StackedMonthly({
  data,
  months,
  colors,
  names = {},
  units = {},
  height = 260,
  currentMonthIdx = 4,
}: StackedMonthlyProps) {
  const keys = Object.keys(data);
  const totals = months.map((_, i) => keys.reduce((a, k) => a + (data[k]?.[i] ?? 0), 0));
  const max = Math.max(...totals, 1);
  const padTop = 24, padBottom = 28, padL = 56, padR = 12;
  const svgW = 720;
  const innerH = height - padTop - padBottom;
  const [hover, setHover] = useState<number | null>(null);

  return (
    <svg
      viewBox={`0 0 ${svgW} ${height}`}
      preserveAspectRatio="none"
      style={{ width: '100%', height, display: 'block' }}
    >
      {[0, 0.25, 0.5, 0.75, 1].map((p) => {
        const y = padTop + innerH * (1 - p);
        return (
          <g key={p}>
            <line x1={padL} x2={svgW - padR} y1={y} y2={y} stroke="#EDEAE3" strokeWidth={1} />
            <text
              x={padL - 8} y={y + 3}
              textAnchor="end" fontSize="10" fill="#8A8A8A"
              fontFamily="ui-monospace, 'Geist Mono', monospace"
            >
              {fmtNum(max * p)}
            </text>
          </g>
        );
      })}

      {months.map((m, i) => {
        const colW = (svgW - padL - padR) / months.length;
        const barW = colW * 0.62;
        const x = padL + i * colW + (colW - barW) / 2;
        let yCursor = padTop + innerH;
        const isCurrent = i === currentMonthIdx;
        return (
          <g
            key={i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <rect x={padL + i * colW} y={padTop} width={colW} height={innerH} fill="transparent" />
            {keys.map((k) => {
              const v = data[k]?.[i] ?? 0;
              const h = (v / max) * innerH;
              yCursor -= h;
              return (
                <rect
                  key={k}
                  x={x} y={yCursor} width={barW} height={h}
                  fill={colors[k]}
                  opacity={hover != null && hover !== i ? 0.35 : 1}
                />
              );
            })}
            {isCurrent && (
              <line
                x1={x + barW / 2} x2={x + barW / 2}
                y1={padTop} y2={padTop + innerH}
                stroke="#0A0A0B" strokeWidth={1} strokeDasharray="2 3" opacity={0.35}
              />
            )}
            <text
              x={padL + i * colW + colW / 2} y={padTop + innerH + 16}
              textAnchor="middle" fontSize="11"
              fill={isCurrent ? '#0A0A0B' : '#8A8A8A'}
              fontWeight={isCurrent ? 600 : 400}
              fontFamily="ui-monospace, 'Geist Mono', monospace"
            >{m}</text>
          </g>
        );
      })}

      {hover != null && totals[hover] > 0 && (
        <HoverTooltip
          hover={hover}
          colW={(svgW - padL - padR) / months.length}
          padL={padL}
          data={data}
          keys={keys}
          colors={colors}
          names={names}
          units={units}
          chartWidth={svgW}
        />
      )}
    </svg>
  );
}

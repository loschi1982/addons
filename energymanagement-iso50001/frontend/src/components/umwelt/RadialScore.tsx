interface RadialScoreProps {
  /** Wert 0–100. */
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: string;
  sub?: string;
}

/**
 * Komfort-Score-Bogen (0–100), 240°-Arc. Portiert aus umwelt-charts.jsx.
 */
export default function RadialScore({ value, size = 168, stroke = 14, color, label, sub }: RadialScoreProps) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const start = -210;
  const end = 30; // 240°-Bogen
  const frac = Math.max(0, Math.min(1, value / 100));
  const polar = (deg: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arc = (a0: number, a1: number) => {
    const [x0, y0] = polar(a0);
    const [x1, y1] = polar(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    return `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1}`;
  };
  const valDeg = start + (end - start) * frac;
  const c = color || (value >= 75 ? 'var(--good)' : value >= 50 ? 'var(--warn)' : 'var(--alert)');

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      <path d={arc(start, end)} fill="none" stroke="var(--line)" strokeWidth={stroke} strokeLinecap="round" />
      <path d={arc(start, valDeg)} fill="none" stroke={c} strokeWidth={stroke} strokeLinecap="round" />
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize={size * 0.3}
        fontWeight={600}
        fill="var(--ink)"
        fontFamily="'Geist Mono', monospace"
        style={{ letterSpacing: '-0.03em' }}
      >
        {Math.round(value)}
      </text>
      <text x={cx} y={cy + size * 0.16} textAnchor="middle" fontSize="11" fill="var(--ink-3)" fontWeight={500}>
        {label || 'von 100'}
      </text>
      {sub && (
        <text x={cx} y={cy + size * 0.3} textAnchor="middle" fontSize="10" fill="var(--ink-4)" fontFamily="'Geist Mono', monospace">
          {sub}
        </text>
      )}
    </svg>
  );
}

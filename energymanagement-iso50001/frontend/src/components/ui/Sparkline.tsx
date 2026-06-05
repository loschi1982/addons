interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Linien-Farbe (Default: Ink). */
  color?: string;
  /** Optionale Bereichsfüllung unter der Linie (Default: keine). */
  fill?: string;
  /** Strichstärke. */
  strokeWidth?: number;
  /** ARIA-Label. */
  label?: string;
}

/**
 * Schlanker SVG-Sparkline (kein Recharts), passt in KPI-Karten.
 */
export default function Sparkline({
  values,
  width = 120,
  height = 28,
  color = 'var(--ink)',
  fill,
  strokeWidth = 1.5,
  label = 'Trend',
}: SparklineProps) {
  if (!values || values.length === 0) {
    return <svg width={width} height={height} role="img" aria-label={label} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length === 1 ? 0 : width / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = i * stepX;
    const y = height - 2 - ((v - min) / range) * (height - 4);
    return [x, y] as const;
  });

  const linePath = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;

  return (
    <svg width={width} height={height} role="img" aria-label={label} style={{ display: 'block' }}>
      {fill && <path d={areaPath} fill={fill} opacity={0.18} className="anim-area" />}
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="anim-line"
        pathLength={1}
        style={{ strokeDasharray: 1 }}
      />
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r={2}
        fill={color}
        className="anim-dot"
      />
    </svg>
  );
}

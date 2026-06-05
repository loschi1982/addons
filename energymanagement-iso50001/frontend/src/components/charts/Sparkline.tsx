interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
  fill?: boolean;
  strokeW?: number;
}

export default function Sparkline({
  data,
  color = 'var(--ink)',
  width = 120,
  height = 32,
  fill = true,
  strokeW = 1.5,
}: SparklineProps) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => [
    i * stepX,
    height - ((v - min) / span) * (height - 4) - 2,
  ]);
  const path = points.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');
  const area = `${path} L${width},${height} L0,${height} Z`;
  const gradId = 'spark-' + color.replace('#', '');
  const last = points[points.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradId})`} />}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeW}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill={color} />
    </svg>
  );
}

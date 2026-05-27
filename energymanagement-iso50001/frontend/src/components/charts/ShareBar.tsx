interface Segment {
  key: string;
  label: string;
  value: number;
  color: string;
}

interface ShareBarProps {
  segments: Segment[];
  height?: number;
  radius?: number;
  showLabels?: boolean;
}

export default function ShareBar({
  segments,
  height = 14,
  radius = 4,
  showLabels = false,
}: ShareBarProps) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  let x = 0;
  return (
    <div style={{ width: '100%' }}>
      <svg
        width="100%"
        height={height}
        style={{ display: 'block', borderRadius: radius, overflow: 'hidden' }}
      >
        {segments.map((s) => {
          const w = (s.value / total) * 100;
          const rect = (
            <rect key={s.key} x={`${x}%`} y={0} width={`${w}%`} height={height} fill={s.color} />
          );
          x += w;
          return rect;
        })}
      </svg>
      {showLabels && (
        <div style={{ display: 'flex', marginTop: 8, gap: 16, flexWrap: 'wrap', fontSize: 12, color: '#525252' }}>
          {segments.map((s) => (
            <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              <span style={{ color: '#0A0A0B', fontWeight: 500 }}>{s.label}</span>
              <span style={{ color: '#8A8A8A' }}>{((s.value / total) * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

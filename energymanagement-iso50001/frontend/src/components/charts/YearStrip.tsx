interface YearStripProps {
  years: number[];
  totals: Record<number, number>;
  color: string;
  height?: number;
}

export default function YearStrip({ years, totals, color, height = 36 }: YearStripProps) {
  const values = years.map((y) => totals[y] ?? 0);
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
      {years.map((y, i) => {
        const h = (values[i] / max) * height;
        const isCurrent = i === years.length - 1;
        return (
          <div key={y} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
            <div
              style={{
                width: '100%',
                height: h,
                background: color,
                opacity: isCurrent ? 1 : 0.28,
                borderRadius: 2,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' Mio.';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'k';
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
}

interface CO2TrajectoryProps {
  baseline: number;
  current: number;
  target: number;
  baselineYear: number;
  currentYear: number;
  targetYear: number;
  height?: number;
}

export default function CO2Trajectory({
  baseline,
  current,
  target,
  baselineYear,
  currentYear,
  targetYear,
  height = 180,
}: CO2TrajectoryProps) {
  const yrs: number[] = [];
  for (let y = baselineYear; y <= targetYear; y++) yrs.push(y);
  const targetVal = baseline * (1 - target / 100);
  const padL = 36, padR = 16, padT = 24, padB = 24;
  const w = 420, innerW = w - padL - padR;
  const innerH = height - padT - padB;
  const ymax = baseline * 1.05, ymin = targetVal * 0.6;
  const yScale = (v: number) => padT + innerH * (1 - (v - ymin) / (ymax - ymin));
  const xScale = (yr: number) => padL + ((yr - baselineYear) / (targetYear - baselineYear)) * innerW;

  const ideal = yrs.map((y) => [
    xScale(y),
    yScale(baseline + ((targetVal - baseline) * (y - baselineYear) / (targetYear - baselineYear))),
  ]);
  const actualPts = [
    [xScale(baselineYear), yScale(baseline)],
    [xScale(currentYear), yScale(current)],
  ];
  const idealPath = ideal.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(' ');

  return (
    <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height, display: 'block' }}>
      <rect
        x={padL} y={yScale(targetVal)} width={innerW}
        height={padT + innerH - yScale(targetVal)}
        fill="var(--good)" opacity={0.06}
      />
      <line
        x1={padL} x2={padL + innerW}
        y1={yScale(targetVal)} y2={yScale(targetVal)}
        stroke="var(--good)" strokeDasharray="3 3" strokeWidth={1}
      />
      <text
        x={padL + innerW - 4} y={yScale(targetVal) - 4}
        textAnchor="end" fontSize="10" fill="var(--good)" fontWeight={600}
      >
        Ziel −{target}% bis {targetYear}
      </text>
      <path
        d={idealPath}
        fill="none" stroke="var(--ink-3)"
        strokeDasharray="2 3" strokeWidth={1.5}
      />
      <path
        d={`M${actualPts[0][0]},${actualPts[0][1]} L${actualPts[1][0]},${actualPts[1][1]}`}
        fill="none" stroke="var(--good)" strokeWidth={2.5} strokeLinecap="round"
      />
      <circle cx={actualPts[0][0]} cy={actualPts[0][1]} r={3} fill="var(--ink-3)" />
      <text
        x={actualPts[0][0]} y={actualPts[0][1] - 8}
        textAnchor="middle" fontSize="10" fill="#525252"
        fontFamily="ui-monospace, 'Geist Mono', monospace"
      >
        {baselineYear}
      </text>
      <circle cx={actualPts[1][0]} cy={actualPts[1][1]} r={5} fill="var(--good)" />
      <circle cx={actualPts[1][0]} cy={actualPts[1][1]} r={9} fill="var(--good)" opacity={0.18} />
      <text
        x={actualPts[1][0]} y={actualPts[1][1] - 12}
        textAnchor="middle" fontSize="11" fill="var(--ink)" fontWeight={600}
        fontFamily="ui-monospace, 'Geist Mono', monospace"
      >
        {fmtNum(current)} kg
      </text>
      {yrs.map((y) => (
        <text
          key={y} x={xScale(y)} y={height - 6}
          textAnchor="middle" fontSize="10" fill="var(--ink-3)"
          fontFamily="ui-monospace, 'Geist Mono', monospace"
        >
          {y}
        </text>
      ))}
    </svg>
  );
}

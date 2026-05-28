interface SankeySource { id: string; label: string; color: string; }
interface SankeyTarget { id: string; label: string; }
interface SankeyFlow   { source: string; target: string; value: number; }

interface SankeyProps {
  sources:       SankeySource[];
  targets:       SankeyTarget[];
  flows:         SankeyFlow[];
  height?:       number;
  width?:        number;
  labelLeft?:    number;
  labelRight?:   number;
  nodeWidth?:    number;
  minified?:     boolean;
  preserveAspect?: string;
}

export default function Sankey({
  sources, targets, flows,
  height = 220, width = 560,
  labelLeft = 110, labelRight = 130,
  nodeWidth = 7, minified = false,
  preserveAspect = 'xMidYMid meet',
}: SankeyProps) {
  const srcTotals: Record<string, number> = {};
  const tgtTotals: Record<string, number> = {};
  flows.forEach((f) => {
    srcTotals[f.source] = (srcTotals[f.source] ?? 0) + f.value;
    tgtTotals[f.target] = (tgtTotals[f.target] ?? 0) + f.value;
  });
  const total = flows.reduce((a, f) => a + f.value, 0);
  if (total === 0) return null;

  const padT    = minified ? 4 : 6;
  const padB    = minified ? 4 : 24;
  const innerH  = height - padT - padB;
  const gap     = 4;

  const actSrc = sources.filter((s) => (srcTotals[s.id] ?? 0) > 0);
  const actTgt = targets.filter((t) => (tgtTotals[t.id] ?? 0) > 0);

  const srcAvail = innerH - Math.max(0, (actSrc.length - 1) * gap);
  const tgtAvail = innerH - Math.max(0, (actTgt.length - 1) * gap);

  const srcPos: Record<string, { y: number; h: number }> = {};
  let y = padT;
  actSrc.forEach((s) => {
    const h = (srcTotals[s.id] / total) * srcAvail;
    srcPos[s.id] = { y, h };
    y += h + gap;
  });

  const tgtPos: Record<string, { y: number; h: number }> = {};
  y = padT;
  actTgt.forEach((t) => {
    const h = (tgtTotals[t.id] / total) * tgtAvail;
    tgtPos[t.id] = { y, h };
    y += h + gap;
  });

  const srcUsed: Record<string, number> = {};
  const tgtUsed: Record<string, number> = {};
  actSrc.forEach((s) => (srcUsed[s.id] = 0));
  actTgt.forEach((t) => (tgtUsed[t.id] = 0));

  const x0  = labelLeft + nodeWidth;
  const x1  = width - labelRight - nodeWidth;
  const mid = (x0 + x1) / 2;

  const srcOrder = Object.fromEntries(actSrc.map((s, i) => [s.id, i]));
  const tgtOrder = Object.fromEntries(actTgt.map((t, i) => [t.id, i]));

  const ribbons = [...flows]
    .filter((f) => srcPos[f.source] && tgtPos[f.target])
    .sort((a, b) => (srcOrder[a.source] - srcOrder[b.source]) || (tgtOrder[a.target] - tgtOrder[b.target]))
    .map((f) => {
      const src = srcPos[f.source];
      const tgt = tgtPos[f.target];
      const fH  = (f.value / total) * srcAvail;
      const fH2 = (f.value / total) * tgtAvail;
      const yS  = src.y + srcUsed[f.source];
      const yT  = tgt.y + tgtUsed[f.target];
      srcUsed[f.source] += fH;
      tgtUsed[f.target] += fH2;
      const d = `M ${x0} ${yS} C ${mid} ${yS}, ${mid} ${yT}, ${x1} ${yT} L ${x1} ${yT + fH2} C ${mid} ${yT + fH2}, ${mid} ${yS + fH}, ${x0} ${yS + fH} Z`;
      return { d, color: sources.find((s) => s.id === f.source)!.color, value: f.value };
    });

  const monoFont = "ui-monospace, 'Geist Mono', monospace";

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="sankey-svg" preserveAspectRatio={preserveAspect}>
      {ribbons.map((r, i) => (
        <path key={i} className="sankey-flow" d={r.d} fill={r.color} opacity={0.45}>
          <title>{r.value} Zähler</title>
        </path>
      ))}
      {actSrc.map((s) => {
        const p = srcPos[s.id];
        return (
          <g key={s.id}>
            <rect x={labelLeft} y={p.y} width={nodeWidth} height={p.h} fill={s.color} rx={1.5} />
            {!minified && (
              <>
                <text x={labelLeft - 6} y={p.y + p.h / 2 - 1} fontSize={11} textAnchor="end" fontWeight={500} fill="var(--dv-ink)">
                  {s.label}
                </text>
                <text x={labelLeft - 6} y={p.y + p.h / 2 + 11} fontSize={9.5} textAnchor="end" fill="var(--dv-ink-3)" fontFamily={monoFont}>
                  {srcTotals[s.id]} Zähler
                </text>
              </>
            )}
          </g>
        );
      })}
      {actTgt.map((t) => {
        const p  = tgtPos[t.id];
        const tx = width - labelRight + 6;
        const lbl = t.label.length > 22 ? t.label.slice(0, 21) + '…' : t.label;
        return (
          <g key={t.id}>
            <rect x={width - labelRight - nodeWidth} y={p.y} width={nodeWidth} height={p.h} fill="#0F1115" rx={1.5} />
            {!minified && (
              <>
                <text x={tx} y={p.y + p.h / 2 - 1} fontSize={11} textAnchor="start" fontWeight={500} fill="var(--dv-ink)">
                  {lbl}
                </text>
                <text x={tx} y={p.y + p.h / 2 + 11} fontSize={9.5} textAnchor="start" fill="var(--dv-ink-3)" fontFamily={monoFont}>
                  {tgtTotals[t.id]} Zähler
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

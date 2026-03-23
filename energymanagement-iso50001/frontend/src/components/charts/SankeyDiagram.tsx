/**
 * SankeyDiagram – SVG-basiertes Energieflussdiagramm.
 *
 * Berechnet das Layout selbst (ohne d3-sankey) und rendert
 * Knoten als Rechtecke und Links als gebogene Pfade.
 * Unterstützt bidirektionale Flüsse: Verbrauch (links→rechts)
 * und Einspeisung (rechts→links).
 */
import { useMemo, useState } from 'react';

interface SankeyNode {
  id: string;
  label: string;
  type: string;
  depth?: number;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
  direction?: 'consumption' | 'feed_in';
}

interface SankeyDiagramProps {
  nodes: SankeyNode[];
  links: SankeyLink[];
  width?: number;
  height?: number;
}

const NODE_COLORS: Record<string, string> = {
  quelle: '#94a3b8',
  hauptzaehler: '#1B5E7B',
  unterzaehler: '#3B82F6',
  verbraucher: '#10B981',
  eigenproduktion: '#F59E0B',
  einspeisung: '#EF4444',
};

const NODE_LABELS: Record<string, string> = {
  quelle: 'Energiebezug',
  hauptzaehler: 'Hauptzähler',
  unterzaehler: 'Unterzähler',
  verbraucher: 'Verbraucher',
  eigenproduktion: 'Eigenproduktion',
  einspeisung: 'Netzeinspeisung',
};

const FEED_IN_COLOR = '#F59E0B';

const NODE_WIDTH = 20;
const NODE_PADDING = 14;
const LABEL_MARGIN = 8;

interface LayoutNode extends SankeyNode {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  column: number;
}

interface LayoutLink extends SankeyLink {
  sy: number;
  ty: number;
  sw: number;
}

function formatValue(val: number): string {
  if (val >= 1000) return `${(val / 1000).toFixed(1)} MWh`;
  return `${val.toFixed(0)} kWh`;
}

/** Durchschnittliche Y-Mitte aller verbundenen Knoten (Barycenter-Heuristik). */
function avgConnectedY(
  nodeIdx: number,
  layoutNodes: LayoutNode[],
  links: SankeyLink[],
): number {
  let sumY = 0;
  let count = 0;
  for (const link of links) {
    if (link.source === nodeIdx) {
      const t = layoutNodes[link.target];
      sumY += t.y + t.h / 2;
      count++;
    } else if (link.target === nodeIdx) {
      const s = layoutNodes[link.source];
      sumY += s.y + s.h / 2;
      count++;
    }
  }
  return count > 0 ? sumY / count : layoutNodes[nodeIdx].y;
}

function computeLayout(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width: number,
  height: number,
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  if (nodes.length === 0) return { nodes: [], links: [] };

  const typeColumnFallback: Record<string, number> = {
    quelle: 0,
    hauptzaehler: 1,
    unterzaehler: 2,
    verbraucher: 3,
    eigenproduktion: 2,
    einspeisung: 0,
  };

  // Knotenwerte berechnen – Vorwärts- und Rückwärts-Links separat
  // Knotenwert = max(eingehend, ausgehend) pro Richtung, dann Summe
  const forwardIn = new Array(nodes.length).fill(0);
  const forwardOut = new Array(nodes.length).fill(0);
  const feedInIn = new Array(nodes.length).fill(0);
  const feedInOut = new Array(nodes.length).fill(0);

  for (const link of links) {
    if (link.direction === 'feed_in') {
      feedInOut[link.source] += link.value;
      feedInIn[link.target] += link.value;
    } else {
      forwardOut[link.source] += link.value;
      forwardIn[link.target] += link.value;
    }
  }

  const nodeValues = nodes.map((_, i) => {
    const fwd = Math.max(forwardIn[i], forwardOut[i]);
    const fi = Math.max(feedInIn[i], feedInOut[i]);
    return Math.max(fwd + fi, 1);
  });

  // Layout-Knoten erstellen
  const layoutNodes: LayoutNode[] = nodes.map((n, i) => ({
    ...n,
    x: 0,
    y: 0,
    w: NODE_WIDTH,
    h: 0,
    value: nodeValues[i],
    column: n.depth != null ? n.depth : (typeColumnFallback[n.type] ?? 1),
  }));

  // Alle Verbraucher in eine dedizierte Spalte ganz rechts verschieben
  const maxMeterCol = Math.max(
    ...layoutNodes.filter(n => n.type !== 'verbraucher').map(n => n.column),
    0,
  );
  const CONSUMER_COL = maxMeterCol + 1;
  for (const n of layoutNodes) {
    if (n.type === 'verbraucher') n.column = CONSUMER_COL;
  }

  // Spalten gruppieren
  const columns: Map<number, number[]> = new Map();
  layoutNodes.forEach((n, i) => {
    const col = columns.get(n.column) || [];
    col.push(i);
    columns.set(n.column, col);
  });

  const numCols = Math.max(...Array.from(columns.keys())) + 1;
  const colWidth = (width - NODE_WIDTH) / Math.max(numCols - 1, 1);

  const maxColValue = Math.max(
    ...Array.from(columns.values()).map((indices) =>
      indices.reduce((s, i) => s + layoutNodes[i].value, 0)
    ),
    1,
  );

  const availableHeight = height - 40;
  const scale = availableHeight / maxColValue * 0.6;

  // Erste Runde: vorläufige Y-Positionen zuweisen
  for (const [col, indices] of columns) {
    const totalH = indices.reduce((s, i) => s + Math.max(layoutNodes[i].value * scale, 4), 0)
      + (indices.length - 1) * NODE_PADDING;
    let y = (height - totalH) / 2;
    for (const i of indices) {
      layoutNodes[i].x = col * colWidth;
      layoutNodes[i].y = y;
      layoutNodes[i].h = Math.max(layoutNodes[i].value * scale, 4);
      y += layoutNodes[i].h + NODE_PADDING;
    }
  }

  // Barycenter-Sortierung: Knoten nach Schwerpunkt ihrer verbundenen Knoten ordnen
  // Minimiert Kreuzungen der Links
  const sortedCols = Array.from(columns.keys()).sort((a, b) => a - b);
  for (const col of sortedCols) {
    if (col === 0) continue;
    const indices = columns.get(col)!;
    if (indices.length <= 1) continue;

    indices.sort((a, b) => {
      const centerA = avgConnectedY(a, layoutNodes, links);
      const centerB = avgConnectedY(b, layoutNodes, links);
      return centerA - centerB;
    });

    // Y-Positionen nach Sortierung neu zuweisen
    const totalH = indices.reduce((s, i) => s + layoutNodes[i].h, 0)
      + (indices.length - 1) * NODE_PADDING;
    let y = (height - totalH) / 2;
    for (const i of indices) {
      layoutNodes[i].y = y;
      y += layoutNodes[i].h + NODE_PADDING;
    }
  }

  // Link-Positionen berechnen
  // Vorwärts-Links: rechte Kante Source → linke Kante Target (oben am Knoten)
  // Rückwärts-Links: linke Kante Source → rechte Kante Target (unten am Knoten)
  const fwdSourceOffsets = new Array(nodes.length).fill(0);
  const fwdTargetOffsets = new Array(nodes.length).fill(0);
  const fiSourceOffsets = new Array(nodes.length).fill(0);
  const fiTargetOffsets = new Array(nodes.length).fill(0);

  // Rückwärts-Links starten am unteren Ende des Knotens
  for (let i = 0; i < nodes.length; i++) {
    const fwdH = forwardOut[i] > 0
      ? (forwardOut[i] / nodeValues[i]) * layoutNodes[i].h
      : 0;
    fiSourceOffsets[i] = fwdH;

    const fwdInH = forwardIn[i] > 0
      ? (forwardIn[i] / nodeValues[i]) * layoutNodes[i].h
      : 0;
    fiTargetOffsets[i] = fwdInH;
  }

  const layoutLinks: LayoutLink[] = links.map((link) => {
    const sNode = layoutNodes[link.source];
    const tNode = layoutNodes[link.target];
    const isFeedIn = link.direction === 'feed_in';

    const linkW = link.value > 0
      ? Math.max((link.value / (sNode.value || 1)) * sNode.h, 2)
      : 2;

    let sy: number, ty: number;
    if (isFeedIn) {
      sy = sNode.y + fiSourceOffsets[link.source];
      ty = tNode.y + fiTargetOffsets[link.target];
      fiSourceOffsets[link.source] += linkW;
      fiTargetOffsets[link.target] += linkW;
    } else {
      sy = sNode.y + fwdSourceOffsets[link.source];
      ty = tNode.y + fwdTargetOffsets[link.target];
      fwdSourceOffsets[link.source] += linkW;
      fwdTargetOffsets[link.target] += linkW;
    }

    return { ...link, sy, ty, sw: linkW };
  });

  return { nodes: layoutNodes, links: layoutLinks };
}

export default function SankeyDiagram({ nodes, links, width = 800, height = 450 }: SankeyDiagramProps) {
  const [hoveredLink, setHoveredLink] = useState<number | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const layout = useMemo(() => computeLayout(nodes, links, width, height), [nodes, links, width, height]);

  if (layout.nodes.length === 0) {
    return (
      <div className="flex h-80 items-center justify-center text-gray-400">
        Keine Energiefluss-Daten vorhanden
      </div>
    );
  }

  return (
    <div className="relative">
      <svg width={width} height={height} className="overflow-visible">
        {/* Links */}
        {layout.links.map((link, idx) => {
          const sNode = layout.nodes[link.source];
          const tNode = layout.nodes[link.target];
          const isFeedIn = link.direction === 'feed_in';

          // Vorwärts: rechte Kante Source → linke Kante Target
          // Rückwärts: linke Kante Source → rechte Kante Target
          const x0 = isFeedIn ? sNode.x : sNode.x + NODE_WIDTH;
          const x1 = isFeedIn ? tNode.x + NODE_WIDTH : tNode.x;
          const mx = (x0 + x1) / 2;

          const path = `M ${x0} ${link.sy}
            C ${mx} ${link.sy}, ${mx} ${link.ty}, ${x1} ${link.ty}
            L ${x1} ${link.ty + link.sw}
            C ${mx} ${link.ty + link.sw}, ${mx} ${link.sy + link.sw}, ${x0} ${link.sy + link.sw}
            Z`;

          const color = isFeedIn ? FEED_IN_COLOR : (NODE_COLORS[sNode.type] || '#94a3b8');
          const isEmpty = link.value === 0;
          const tooltipSuffix = isFeedIn ? ' (Einspeisung)' : '';

          return (
            <path
              key={idx}
              d={path}
              fill={isEmpty ? 'none' : color}
              fillOpacity={isEmpty ? 0 : (hoveredLink === idx ? 0.5 : (isFeedIn ? 0.3 : 0.2))}
              stroke={color}
              strokeOpacity={isEmpty ? 0.3 : (hoveredLink === idx ? 0.8 : 0.4)}
              strokeWidth={isEmpty ? 1 : 0.5}
              strokeDasharray={isEmpty ? '4 3' : undefined}
              onMouseEnter={(e) => {
                setHoveredLink(idx);
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${sNode.label} → ${tNode.label}: ${formatValue(link.value)}${tooltipSuffix}`,
                });
              }}
              onMouseLeave={() => { setHoveredLink(null); setTooltip(null); }}
              className="cursor-pointer transition-opacity"
            />
          );
        })}

        {/* Trennlinie Zähler | Verbraucher */}
        {(() => {
          const consumerNodes = layout.nodes.filter(n => n.type === 'verbraucher');
          const meterNodes = layout.nodes.filter(n => n.type !== 'verbraucher');
          if (consumerNodes.length === 0 || meterNodes.length === 0) return null;
          const maxMeterX = Math.max(...meterNodes.map(n => n.x + NODE_WIDTH));
          const minConsumerX = Math.min(...consumerNodes.map(n => n.x));
          const sepX = (maxMeterX + minConsumerX) / 2;
          return (
            <g>
              <line
                x1={sepX} y1={8} x2={sepX} y2={height - 8}
                stroke="#cbd5e1" strokeWidth={1} strokeDasharray="6 4"
              />
              <text
                x={sepX + 6} y={14}
                className="fill-gray-400" style={{ fontSize: 10, fontWeight: 500 }}
              >
                Verbraucher (SEU)
              </text>
            </g>
          );
        })()}

        {/* Knoten */}
        {layout.nodes.map((node, idx) => {
          const color = NODE_COLORS[node.type] || '#94a3b8';
          const isProducer = node.type === 'eigenproduktion';
          return (
            <g key={idx}>
              <rect
                x={node.x}
                y={node.y}
                width={NODE_WIDTH}
                height={node.h}
                fill={color}
                rx={3}
              />
              {/* Einspeisungs-Pfeil bei Erzeugern: zeigt nach links (← Einspeisung) */}
              {isProducer && (
                <polygon
                  points={`${node.x - 2},${node.y + node.h / 2 - 5} ${node.x - 9},${node.y + node.h / 2} ${node.x - 2},${node.y + node.h / 2 + 5}`}
                  fill={color}
                />
              )}
              <text
                x={node.x + NODE_WIDTH + LABEL_MARGIN}
                y={node.y + node.h / 2}
                dominantBaseline="middle"
                className="text-xs fill-gray-700"
                style={{ fontSize: 11 }}
              >
                {node.label}
              </text>
              <text
                x={node.x + NODE_WIDTH + LABEL_MARGIN}
                y={node.y + node.h / 2 + 14}
                dominantBaseline="middle"
                className="fill-gray-400"
                style={{ fontSize: 10 }}
              >
                {formatValue(node.value)}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Legende */}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
        {Object.entries(NODE_COLORS).map(([type, color]) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
            <span>{NODE_LABELS[type] || type}</span>
          </div>
        ))}
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 rounded-lg bg-gray-800 px-3 py-1.5 text-xs text-white shadow-lg pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 20 }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

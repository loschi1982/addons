/**
 * SankeyDiagram – SVG-basiertes Energieflussdiagramm.
 *
 * Berechnet das Layout selbst (ohne d3-sankey) und rendert
 * Knoten als Rechtecke und Links als gebogene Pfade.
 * Die Spaltenplatzierung erfolgt über `depth` (Tiefe im Zähler-Baum),
 * nicht über den Knotentyp.
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
};

const NODE_LABELS: Record<string, string> = {
  quelle: 'Energiebezug',
  hauptzaehler: 'Hauptzähler',
  unterzaehler: 'Unterzähler',
  verbraucher: 'Verbraucher',
  eigenproduktion: 'Eigenproduktion',
};

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

function computeLayout(
  nodes: SankeyNode[],
  links: SankeyLink[],
  width: number,
  height: number,
): { nodes: LayoutNode[]; links: LayoutLink[] } {
  if (nodes.length === 0) return { nodes: [], links: [] };

  // Spalte aus depth verwenden (vom Backend geliefert)
  // Fallback auf Typ-basierte Zuordnung für Rückwärtskompatibilität
  const typeColumnFallback: Record<string, number> = {
    quelle: 0,
    hauptzaehler: 1,
    unterzaehler: 2,
    verbraucher: 3,
    eigenproduktion: 0,
  };

  // Knotenwerte berechnen (max aus ein-/ausgehenden Links)
  const nodeValues = new Array(nodes.length).fill(0);
  for (const link of links) {
    nodeValues[link.source] = Math.max(nodeValues[link.source], 0) + link.value;
    nodeValues[link.target] = Math.max(nodeValues[link.target], 0) + link.value;
  }

  // Layout-Knoten erstellen – Spalte aus depth oder Typ-Fallback
  const layoutNodes: LayoutNode[] = nodes.map((n, i) => ({
    ...n,
    x: 0,
    y: 0,
    w: NODE_WIDTH,
    h: 0,
    value: nodeValues[i] || 1,
    column: n.depth != null ? n.depth : (typeColumnFallback[n.type] ?? 1),
  }));

  // Spalten gruppieren
  const columns: Map<number, number[]> = new Map();
  layoutNodes.forEach((n, i) => {
    const col = columns.get(n.column) || [];
    col.push(i);
    columns.set(n.column, col);
  });

  const numCols = Math.max(...Array.from(columns.keys())) + 1;
  const colWidth = (width - NODE_WIDTH) / Math.max(numCols - 1, 1);

  // Gesamtwert für Skalierung
  const maxColValue = Math.max(
    ...Array.from(columns.values()).map((indices) =>
      indices.reduce((s, i) => s + layoutNodes[i].value, 0)
    ),
    1,
  );

  const availableHeight = height - 40;
  const scale = availableHeight / maxColValue * 0.6;

  // Position berechnen
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

  // Link-Positionen berechnen
  const sourceOffsets = new Array(nodes.length).fill(0);
  const targetOffsets = new Array(nodes.length).fill(0);

  const layoutLinks: LayoutLink[] = links
    .map((link) => {
      const sNode = layoutNodes[link.source];
      const tNode = layoutNodes[link.target];
      // Mindestbreite 2px für strukturelle Verbindungen ohne Verbrauch
      const linkW = link.value > 0
        ? Math.max((link.value / (sNode.value || 1)) * sNode.h, 2)
        : 2;

      const sy = sNode.y + sourceOffsets[link.source];
      const ty = tNode.y + targetOffsets[link.target];

      sourceOffsets[link.source] += linkW;
      targetOffsets[link.target] += linkW;

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
          const x0 = sNode.x + NODE_WIDTH;
          const x1 = tNode.x;
          const mx = (x0 + x1) / 2;

          const path = `M ${x0} ${link.sy}
            C ${mx} ${link.sy}, ${mx} ${link.ty}, ${x1} ${link.ty}
            L ${x1} ${link.ty + link.sw}
            C ${mx} ${link.ty + link.sw}, ${mx} ${link.sy + link.sw}, ${x0} ${link.sy + link.sw}
            Z`;

          const color = NODE_COLORS[sNode.type] || '#94a3b8';
          const isEmpty = link.value === 0;
          return (
            <path
              key={idx}
              d={path}
              fill={isEmpty ? 'none' : color}
              fillOpacity={isEmpty ? 0 : (hoveredLink === idx ? 0.5 : 0.2)}
              stroke={color}
              strokeOpacity={isEmpty ? 0.3 : (hoveredLink === idx ? 0.8 : 0.3)}
              strokeWidth={isEmpty ? 1 : 0.5}
              strokeDasharray={isEmpty ? '4 3' : undefined}
              onMouseEnter={(e) => {
                setHoveredLink(idx);
                setTooltip({
                  x: e.clientX,
                  y: e.clientY,
                  text: `${sNode.label} → ${tNode.label}: ${formatValue(link.value)}`,
                });
              }}
              onMouseLeave={() => { setHoveredLink(null); setTooltip(null); }}
              className="cursor-pointer transition-opacity"
            />
          );
        })}

        {/* Knoten */}
        {layout.nodes.map((node, idx) => {
          const color = NODE_COLORS[node.type] || '#94a3b8';
          // Eigenproduktion: Label links, Pfeil-Symbol zeigt Einspeisungsrichtung
          const isProducer = node.type === 'eigenproduktion';
          const labelX = isProducer
            ? node.x - LABEL_MARGIN
            : node.x + NODE_WIDTH + LABEL_MARGIN;
          const textAnchor = isProducer ? 'end' : 'start';
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
              {/* Einspeisungs-Pfeil bei Erzeugern */}
              {isProducer && (
                <polygon
                  points={`${node.x + NODE_WIDTH + 2},${node.y + node.h / 2 - 4} ${node.x + NODE_WIDTH + 8},${node.y + node.h / 2} ${node.x + NODE_WIDTH + 2},${node.y + node.h / 2 + 4}`}
                  fill={color}
                />
              )}
              <text
                x={labelX}
                y={node.y + node.h / 2}
                dominantBaseline="middle"
                textAnchor={textAnchor}
                className="text-xs fill-gray-700"
                style={{ fontSize: 11 }}
              >
                {node.label}
              </text>
              <text
                x={labelX}
                y={node.y + node.h / 2 + 14}
                dominantBaseline="middle"
                textAnchor={textAnchor}
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

/**
 * meterMapLayout – Dagre-basiertes Auto-Layout für die Zähler-Mindmap.
 *
 * Berechnet x/y-Positionen für alle Nodes in einem hierarchischen
 * Top-Down-Baum (Standort → Gebäude → Nutzungseinheit → Zähler).
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/** Node-Größen pro Typ */
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  siteNode: { width: 220, height: 80 },
  buildingNode: { width: 200, height: 70 },
  unitNode: { width: 200, height: 60 },
  meterNode: { width: 180, height: 55 },
};

const DEFAULT_DIMENSIONS = { width: 180, height: 60 };

/**
 * Berechnet hierarchisches Layout mit dagre.
 * Gibt neue Node-Array mit aktualisierten x/y-Positionen zurück.
 */
export function layoutHierarchy(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: 50,
    ranksep: 100,
    marginx: 40,
    marginy: 40,
  });

  // Nodes registrieren
  for (const node of nodes) {
    const dims = NODE_DIMENSIONS[node.type || ''] || DEFAULT_DIMENSIONS;
    g.setNode(node.id, { width: dims.width, height: dims.height });
  }

  // Edges registrieren
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  // Positionen übernehmen (dagre gibt Mittelpunkt, ReactFlow braucht linke obere Ecke)
  return nodes.map((node) => {
    const dagreNode = g.node(node.id);
    if (!dagreNode) return node;

    const dims = NODE_DIMENSIONS[node.type || ''] || DEFAULT_DIMENSIONS;
    return {
      ...node,
      position: {
        x: dagreNode.x - dims.width / 2,
        y: dagreNode.y - dims.height / 2,
      },
    };
  });
}

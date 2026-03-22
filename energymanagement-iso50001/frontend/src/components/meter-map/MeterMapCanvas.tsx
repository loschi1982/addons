/**
 * MeterMapCanvas – ReactFlow-Wrapper für die Zähler-Mindmap.
 *
 * Registriert die Custom-Nodes, zeigt Minimap + Controls,
 * und behandelt Drag & Drop zum Verschieben von Zählern.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { SiteNode } from './nodes/SiteNode';
import { BuildingNode } from './nodes/BuildingNode';
import { UsageUnitNode } from './nodes/UsageUnitNode';
import { MeterNode } from './nodes/MeterNode';
import { savePositions } from '@/hooks/useMeterMapData';
import { apiClient } from '@/utils/api';

interface MeterMapCanvasProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onAddMeter: (unitId: string) => void;
  onRefetch: () => void;
}

export default function MeterMapCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onAddMeter,
  onRefetch,
}: MeterMapCanvasProps) {
  const { getIntersectingNodes } = useReactFlow();
  const [reassignDialog, setReassignDialog] = useState<{
    meterId: string;
    meterName: string;
    targetUnitId: string;
    targetUnitName: string;
  } | null>(null);
  const [reassigning, setReassigning] = useState(false);

  // onAddMeter Callback in UnitNode-Daten injizieren
  const nodesWithCallbacks = useMemo(
    () =>
      nodes.map((node) => {
        if (node.type === 'unitNode') {
          return {
            ...node,
            data: { ...node.data, onAddMeter },
          };
        }
        return node;
      }),
    [nodes, onAddMeter]
  );

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      siteNode: SiteNode,
      buildingNode: BuildingNode,
      unitNode: UsageUnitNode,
      meterNode: MeterNode,
    }),
    []
  );

  /** Nach Drag: Positionen speichern + Prüfen ob Zähler auf Unit gezogen */
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      // Positionen speichern
      savePositions(nodes);

      // Nur Meter-Nodes prüfen
      if (node.type !== 'meterNode') return;

      const intersecting = getIntersectingNodes(node);
      const targetUnit = intersecting.find((n) => n.type === 'unitNode');

      if (!targetUnit) return;

      const currentUnitId = node.data.unitId as string;
      const targetUnitId = targetUnit.data.unitId as string;

      // Gleiche Unit → nichts tun
      if (currentUnitId === targetUnitId) return;

      setReassignDialog({
        meterId: node.data.meterId as string,
        meterName: node.data.label as string,
        targetUnitId,
        targetUnitName: targetUnit.data.label as string,
      });
    },
    [nodes, getIntersectingNodes]
  );

  /** Zähler-Zuordnung aktualisieren */
  const confirmReassign = useCallback(async () => {
    if (!reassignDialog) return;
    setReassigning(true);
    try {
      await apiClient.put(`/api/v1/meters/${reassignDialog.meterId}`, {
        usage_unit_id: reassignDialog.targetUnitId,
      });
      setReassignDialog(null);
      onRefetch();
    } catch {
      alert('Fehler beim Verschieben des Zählers.');
    } finally {
      setReassigning(false);
    }
  }, [reassignDialog, onRefetch]);

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodesWithCallbacks}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="#e5e7eb" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          nodeColor={(node) => {
            if (node.type === 'siteNode') return '#1B5E7B';
            if (node.type === 'buildingNode') return '#9CA3AF';
            if (node.type === 'unitNode') return '#1B5E7B';
            return '#F59E0B';
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
        />
      </ReactFlow>

      {/* Bestätigungs-Dialog für Zähler-Verschiebung */}
      {reassignDialog && (
        <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">Zähler verschieben?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Zähler <strong>„{reassignDialog.meterName}"</strong> zu{' '}
              <strong>„{reassignDialog.targetUnitName}"</strong> verschieben?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="btn-secondary text-sm"
                onClick={() => setReassignDialog(null)}
                disabled={reassigning}
              >
                Abbrechen
              </button>
              <button
                className="btn-primary text-sm"
                onClick={confirmReassign}
                disabled={reassigning}
              >
                {reassigning ? 'Wird verschoben...' : 'Verschieben'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

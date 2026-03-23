/**
 * MeterMapCanvas – ReactFlow-Wrapper für die Zähler-Mindmap.
 *
 * Registriert die Custom-Nodes, zeigt Minimap + Controls,
 * und behandelt Drag & Drop zum Verschieben von Zählern in der Messtopologie.
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
  onRefetch: () => void;
}

export default function MeterMapCanvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onRefetch,
}: MeterMapCanvasProps) {
  const { getIntersectingNodes } = useReactFlow();
  const [reassignDialog, setReassignDialog] = useState<{
    meterId: string;
    meterName: string;
    targetId: string;
    targetName: string;
    targetType: 'meter' | 'site';
  } | null>(null);
  const [reassigning, setReassigning] = useState(false);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      siteNode: SiteNode,
      buildingNode: BuildingNode,
      unitNode: UsageUnitNode,
      meterNode: MeterNode,
    }),
    []
  );

  /** Nach Drag: Positionen speichern + Prüfen ob Zähler auf anderen Node gezogen */
  const handleNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      savePositions(nodes);

      // Nur Meter-Nodes prüfen
      if (node.type !== 'meterNode') return;

      const intersecting = getIntersectingNodes(node);

      // Priorität: anderer Meter-Node → Site-Node
      const targetMeter = intersecting.find(
        (n) => n.type === 'meterNode' && n.id !== node.id
      );
      const targetSite = intersecting.find((n) => n.type === 'siteNode');

      if (targetMeter) {
        const currentParent = node.data.parentMeterId as string | null;
        const targetMeterId = targetMeter.data.meterId as string;

        // Gleicher Elternzähler → nichts tun
        if (currentParent === targetMeterId) return;

        setReassignDialog({
          meterId: node.data.meterId as string,
          meterName: node.data.label as string,
          targetId: targetMeterId,
          targetName: targetMeter.data.label as string,
          targetType: 'meter',
        });
      } else if (targetSite) {
        // Auf Site gezogen → Root-Zähler machen (parent_meter_id entfernen)
        const currentParent = node.data.parentMeterId as string | null;
        if (!currentParent) return; // Ist bereits Root

        setReassignDialog({
          meterId: node.data.meterId as string,
          meterName: node.data.label as string,
          targetId: targetSite.data.siteId as string,
          targetName: targetSite.data.label as string,
          targetType: 'site',
        });
      }
    },
    [nodes, getIntersectingNodes]
  );

  /** Zähler-Zuordnung in der Messtopologie aktualisieren */
  const confirmReassign = useCallback(async () => {
    if (!reassignDialog) return;
    setReassigning(true);
    try {
      if (reassignDialog.targetType === 'meter') {
        // Unterzähler von Ziel-Meter machen
        await apiClient.put(`/api/v1/meters/${reassignDialog.meterId}`, {
          parent_meter_id: reassignDialog.targetId,
        });
      } else {
        // Root-Zähler am Standort → parent_meter_id entfernen
        await apiClient.put(`/api/v1/meters/${reassignDialog.meterId}`, {
          parent_meter_id: null,
          site_id: reassignDialog.targetId,
        });
      }
      setReassignDialog(null);
      onRefetch();
    } catch {
      alert('Fehler beim Verschieben des Zählers.');
    } finally {
      setReassigning(false);
    }
  }, [reassignDialog, onRefetch]);

  const dialogMessage =
    reassignDialog?.targetType === 'meter'
      ? <>Zähler <strong>„{reassignDialog.meterName}"</strong> als Unterzähler von <strong>„{reassignDialog.targetName}"</strong> zuordnen?</>
      : <>Zähler <strong>„{reassignDialog?.meterName}"</strong> als Hauptzähler an <strong>„{reassignDialog?.targetName}"</strong> setzen?</>;

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
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
            <p className="text-sm text-gray-600 mb-4">{dialogMessage}</p>
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

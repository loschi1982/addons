/**
 * UsageUnitNode – Custom ReactFlow-Node für Nutzungseinheiten.
 * Enthält einen "+" Button zum Anlegen neuer Zähler.
 */

import { Handle, Position } from '@xyflow/react';
import { Home, Plus } from 'lucide-react';

interface UsageUnitNodeData {
  label: string;
  usageType?: string;
  unitId: string;
  onAddMeter?: (unitId: string) => void;
  [key: string]: unknown;
}

export function UsageUnitNode({ data }: { data: UsageUnitNodeData }) {
  return (
    <div className="rounded-lg border-2 border-[#1B5E7B] bg-white px-4 py-3 shadow-md min-w-[200px]">
      <Handle type="target" position={Position.Top} className="!bg-[#1B5E7B] !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Home className="h-4 w-4 text-[#1B5E7B] shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="font-medium text-gray-800 text-sm truncate">{data.label}</div>
          {data.usageType && (
            <div className="text-xs text-gray-500 truncate">{data.usageType}</div>
          )}
        </div>
        <button
          className="nopan nodrag p-1 rounded hover:bg-[#1B5E7B]/10 text-[#1B5E7B] transition-colors shrink-0"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            data.onAddMeter?.(data.unitId);
          }}
          title="Neuen Zähler anlegen"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#1B5E7B] !w-2 !h-2" />
    </div>
  );
}

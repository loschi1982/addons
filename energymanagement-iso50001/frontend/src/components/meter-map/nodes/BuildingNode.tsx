/**
 * BuildingNode – Custom ReactFlow-Node für Gebäude.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Building } from 'lucide-react';

interface BuildingNodeData {
  label: string;
  buildingType?: string;
  area?: number;
  [key: string]: unknown;
}

function BuildingNodeComponent({ data }: { data: BuildingNodeData }) {
  return (
    <div className="rounded-lg border-2 border-gray-400 bg-gray-50 px-4 py-3 shadow-md min-w-[200px]">
      <Handle type="target" position={Position.Top} className="!bg-gray-400 !w-2 !h-2" />
      <div className="flex items-center gap-2">
        <Building className="h-5 w-5 text-gray-600 shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-gray-700 text-sm truncate">{data.label}</div>
          {(data.buildingType || data.area) && (
            <div className="text-xs text-gray-500 truncate">
              {data.buildingType}{data.buildingType && data.area ? ' · ' : ''}
              {data.area ? `${data.area} m²` : ''}
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-gray-400 !w-2 !h-2" />
    </div>
  );
}

export const BuildingNode = memo(BuildingNodeComponent);

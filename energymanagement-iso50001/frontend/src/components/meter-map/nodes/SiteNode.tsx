/**
 * SiteNode – Custom ReactFlow-Node für Standorte.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Building2 } from 'lucide-react';

interface SiteNodeData {
  label: string;
  city?: string;
  [key: string]: unknown;
}

function SiteNodeComponent({ data }: { data: SiteNodeData }) {
  return (
    <div className="rounded-lg border-2 border-[#1B5E7B] bg-[#1B5E7B]/10 px-4 py-3 shadow-md min-w-[220px]">
      <div className="flex items-center gap-2">
        <Building2 className="h-5 w-5 text-[#1B5E7B] shrink-0" />
        <div className="min-w-0">
          <div className="font-semibold text-[#1B5E7B] text-sm truncate">{data.label}</div>
          {data.city && (
            <div className="text-xs text-gray-500 truncate">{data.city}</div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-[#1B5E7B] !w-2 !h-2" />
    </div>
  );
}

export const SiteNode = memo(SiteNodeComponent);

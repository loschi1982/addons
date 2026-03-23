/**
 * MeterNode – Custom ReactFlow-Node für Zähler.
 * Farbig nach Energieart, zeigt Name und Zählernummer.
 */

import { memo } from 'react';
import { Handle, Position } from '@xyflow/react';
import { Zap, Flame, Droplets, Sun, Thermometer, Wind, TreePine, Fuel, Gauge } from 'lucide-react';
import { ENERGY_TYPE_COLORS, ENERGY_TYPE_LABELS } from '@/types';
import type { EnergyType } from '@/types';

interface MeterNodeData {
  label: string;
  meterId: string;
  meterNumber?: string | null;
  energyType: string;
  dataSource?: string;
  isVirtual?: boolean;
  isFeedIn?: boolean;
  buildingName?: string;
  parentMeterId?: string | null;
  [key: string]: unknown;
}

/** Icon pro Energieart */
const ENERGY_ICONS: Record<string, typeof Zap> = {
  electricity: Zap,
  natural_gas: Flame,
  heating_oil: Fuel,
  district_heating: Thermometer,
  water: Droplets,
  solar: Sun,
  lpg: Wind,
  wood_pellets: TreePine,
};

function MeterNodeComponent({ data }: { data: MeterNodeData }) {
  const color = ENERGY_TYPE_COLORS[data.energyType as EnergyType] || '#6B7280';
  const label = ENERGY_TYPE_LABELS[data.energyType as EnergyType] || data.energyType;
  const Icon = ENERGY_ICONS[data.energyType] || Gauge;

  // Visuell: gestrichelt für virtuelle Zähler, grüner Hintergrund für PV/Einspeisung
  const borderStyle = data.isVirtual ? 'dashed' : 'solid';
  const bgColor = data.isFeedIn ? '#f0fdf4' : 'white';

  return (
    <div
      className="rounded-lg border bg-white shadow-sm min-w-[180px] overflow-hidden"
      style={{ borderColor: color, borderStyle, backgroundColor: bgColor }}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2" style={{ background: color }} />
      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2" style={{ background: color }} />
      {/* Farbiger Akzent oben */}
      <div className="h-1" style={{ backgroundColor: color }} />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0" style={{ color }} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-gray-800 text-xs truncate">
              {data.isFeedIn && <span className="text-green-600 mr-1" title="Einspeisezähler">&#9652;</span>}
              {data.isVirtual && <span className="text-indigo-500 mr-1" title="Virtueller Zähler">&#8776;</span>}
              {data.label}
            </div>
            <div className="text-[10px] text-gray-500 truncate">
              {label}
              {data.meterNumber ? ` · ${data.meterNumber}` : ''}
            </div>
            {data.buildingName && (
              <div className="text-[10px] text-gray-400 truncate">
                &#127968; {data.buildingName as string}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export const MeterNode = memo(MeterNodeComponent);

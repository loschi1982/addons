/**
 * MeterMapToolbar – Werkzeugleiste für die Zähler-Mindmap.
 */

import { Link } from 'react-router-dom';
import { LayoutGrid, List } from 'lucide-react';
import { ENERGY_TYPE_COLORS, ENERGY_TYPE_LABELS } from '@/types';
import type { EnergyType } from '@/types';

interface MeterMapToolbarProps {
  onResetLayout: () => void;
  energyFilter: Set<string>;
  onToggleEnergyFilter: (type: string) => void;
  meterCount: number;
}

const ENERGY_TYPES = Object.keys(ENERGY_TYPE_LABELS) as EnergyType[];

export default function MeterMapToolbar({
  onResetLayout,
  energyFilter,
  onToggleEnergyFilter,
  meterCount,
}: MeterMapToolbarProps) {
  return (
    <div className="bg-white border-b px-4 py-2 flex items-center gap-4 flex-wrap">
      {/* Titel */}
      <div className="flex items-center gap-2 mr-auto">
        <h1 className="text-lg font-semibold text-gray-900">Zähler-Karte</h1>
        <span className="text-sm text-gray-500">({meterCount} Zähler)</span>
      </div>

      {/* Energieart-Filter */}
      <div className="flex items-center gap-1 flex-wrap">
        {ENERGY_TYPES.map((type) => {
          const active = energyFilter.has(type);
          const color = ENERGY_TYPE_COLORS[type];
          return (
            <button
              key={type}
              className="px-2 py-1 rounded text-xs font-medium transition-all border"
              style={{
                backgroundColor: active ? color + '20' : 'transparent',
                borderColor: active ? color : '#e5e7eb',
                color: active ? color : '#9CA3AF',
              }}
              onClick={() => onToggleEnergyFilter(type)}
              title={ENERGY_TYPE_LABELS[type]}
            >
              {ENERGY_TYPE_LABELS[type]}
            </button>
          );
        })}
      </div>

      {/* Aktionen */}
      <div className="flex items-center gap-2">
        <button
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          onClick={onResetLayout}
          title="Auto-Layout zurücksetzen"
        >
          <LayoutGrid className="h-4 w-4" />
          <span className="hidden sm:inline">Auto-Layout</span>
        </button>
        <Link
          to="/meters"
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          title="Tabellenansicht"
        >
          <List className="h-4 w-4" />
          <span className="hidden sm:inline">Tabelle</span>
        </Link>
      </div>
    </div>
  );
}

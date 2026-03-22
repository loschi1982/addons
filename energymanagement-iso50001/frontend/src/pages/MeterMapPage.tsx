/**
 * MeterMapPage – Interaktive Mindmap der Standort-Hierarchie mit Zählern.
 *
 * Zeigt Standorte → Gebäude → Nutzungseinheiten → Zähler als Baumstruktur.
 * Zähler können per Drag & Drop verschoben und direkt angelegt werden.
 */

import { useState, useCallback, useMemo } from 'react';
import { ReactFlowProvider, useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react';
import { useEffect } from 'react';
import { Loader2, X } from 'lucide-react';

import { useMeterMapData } from '@/hooks/useMeterMapData';
import MeterMapCanvas from '@/components/meter-map/MeterMapCanvas';
import MeterMapToolbar from '@/components/meter-map/MeterMapToolbar';
import { ENERGY_TYPE_LABELS, type EnergyType } from '@/types';
import { apiClient } from '@/utils/api';

// ── Quick-Meter-Formular ──

interface QuickMeterForm {
  name: string;
  meter_number: string;
  energy_type: string;
  unit: string;
  data_source: string;
}

const UNITS_BY_ENERGY: Record<string, string[]> = {
  electricity: ['kWh', 'MWh'],
  natural_gas: ['kWh', 'm³'],
  heating_oil: ['kWh', 'l'],
  district_heating: ['kWh', 'MWh'],
  water: ['m³', 'l'],
  solar: ['kWh'],
  lpg: ['kWh', 'kg'],
  wood_pellets: ['kWh', 'kg'],
};

function MeterMapContent() {
  const { nodes: initialNodes, edges: initialEdges, loading, error, refetch, resetLayout } = useMeterMapData();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Energieart-Filter
  const [energyFilter, setEnergyFilter] = useState<Set<string>>(
    new Set(Object.keys(ENERGY_TYPE_LABELS))
  );

  // Quick-Create Modal
  const [quickCreateUnitId, setQuickCreateUnitId] = useState<string | null>(null);
  const [quickForm, setQuickForm] = useState<QuickMeterForm>({
    name: '',
    meter_number: '',
    energy_type: 'electricity',
    unit: 'kWh',
    data_source: 'manual',
  });
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  // Initiale Daten setzen
  useEffect(() => {
    if (initialNodes.length > 0) {
      setNodes(initialNodes);
      setEdges(initialEdges);
    }
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  // Gefilterte Nodes/Edges (Meter-Nodes nach Energieart filtern)
  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (node.type !== 'meterNode') return true;
      return energyFilter.has(node.data.energyType as string);
    });
  }, [nodes, energyFilter]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return edges.filter(
      (edge) => filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target)
    );
  }, [edges, filteredNodeIds]);

  // Zähler zählen
  const meterCount = useMemo(
    () => nodes.filter((n) => n.type === 'meterNode').length,
    [nodes]
  );

  const handleToggleEnergyFilter = useCallback((type: string) => {
    setEnergyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleAddMeter = useCallback((unitId: string) => {
    setQuickCreateUnitId(unitId);
    setQuickForm({
      name: '',
      meter_number: '',
      energy_type: 'electricity',
      unit: 'kWh',
      data_source: 'manual',
    });
    setQuickError(null);
  }, []);

  const handleQuickSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!quickCreateUnitId) return;

      if (!quickForm.name.trim()) {
        setQuickError('Name ist erforderlich.');
        return;
      }

      setQuickSaving(true);
      setQuickError(null);

      try {
        await apiClient.post('/api/v1/meters', {
          name: quickForm.name.trim(),
          meter_number: quickForm.meter_number.trim() || null,
          energy_type: quickForm.energy_type,
          unit: quickForm.unit,
          data_source: quickForm.data_source,
          usage_unit_id: quickCreateUnitId,
        });
        setQuickCreateUnitId(null);
        refetch();
      } catch {
        setQuickError('Fehler beim Anlegen des Zählers.');
      } finally {
        setQuickSaving(false);
      }
    },
    [quickCreateUnitId, quickForm, refetch]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-[#1B5E7B]" />
        <span className="ml-3 text-gray-500">Lade Standort-Hierarchie...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-red-600 mb-2">{error}</p>
          <button className="btn-primary text-sm" onClick={refetch}>
            Erneut versuchen
          </button>
        </div>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500">
          <p className="text-lg mb-2">Keine Standorte vorhanden</p>
          <p className="text-sm">Legen Sie zunächst Standorte, Gebäude und Nutzungseinheiten an.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col -m-6" style={{ height: 'calc(100vh - 4rem)' }}>
      <MeterMapToolbar
        onResetLayout={resetLayout}
        energyFilter={energyFilter}
        onToggleEnergyFilter={handleToggleEnergyFilter}
        meterCount={meterCount}
      />
      <div className="flex-1">
        <MeterMapCanvas
          nodes={filteredNodes}
          edges={filteredEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onAddMeter={handleAddMeter}
          onRefetch={refetch}
        />
      </div>

      {/* Quick-Create Modal */}
      {quickCreateUnitId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">Neuen Zähler anlegen</h3>
              <button
                onClick={() => setQuickCreateUnitId(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleQuickSubmit} className="space-y-4">
              {/* Name */}
              <div>
                <label className="label">Name *</label>
                <input
                  className="input"
                  value={quickForm.name}
                  onChange={(e) => setQuickForm({ ...quickForm, name: e.target.value })}
                  placeholder="z.B. Hauptzähler Strom"
                  autoFocus
                />
              </div>

              {/* Zählernummer */}
              <div>
                <label className="label">Zählernummer</label>
                <input
                  className="input"
                  value={quickForm.meter_number}
                  onChange={(e) => setQuickForm({ ...quickForm, meter_number: e.target.value })}
                  placeholder="optional"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Energieart */}
                <div>
                  <label className="label">Energieart</label>
                  <select
                    className="input"
                    value={quickForm.energy_type}
                    onChange={(e) => {
                      const type = e.target.value;
                      const units = UNITS_BY_ENERGY[type] || ['kWh'];
                      setQuickForm({
                        ...quickForm,
                        energy_type: type,
                        unit: units[0],
                      });
                    }}
                  >
                    {(Object.keys(ENERGY_TYPE_LABELS) as EnergyType[]).map((type) => (
                      <option key={type} value={type}>
                        {ENERGY_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Einheit */}
                <div>
                  <label className="label">Einheit</label>
                  <select
                    className="input"
                    value={quickForm.unit}
                    onChange={(e) => setQuickForm({ ...quickForm, unit: e.target.value })}
                  >
                    {(UNITS_BY_ENERGY[quickForm.energy_type] || ['kWh']).map((u) => (
                      <option key={u} value={u}>
                        {u}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Datenquelle */}
              <div>
                <label className="label">Datenquelle</label>
                <select
                  className="input"
                  value={quickForm.data_source}
                  onChange={(e) => setQuickForm({ ...quickForm, data_source: e.target.value })}
                >
                  <option value="manual">Manuell</option>
                  <option value="shelly">Shelly</option>
                  <option value="modbus">Modbus</option>
                  <option value="homeassistant">Home Assistant</option>
                </select>
              </div>

              {quickError && (
                <p className="text-sm text-red-600">{quickError}</p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setQuickCreateUnitId(null)}
                  disabled={quickSaving}
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn-primary" disabled={quickSaving}>
                  {quickSaving ? 'Wird angelegt...' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MeterMapPage() {
  return (
    <ReactFlowProvider>
      <MeterMapContent />
    </ReactFlowProvider>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Trash2, Flag, TrendingDown, RefreshCw, ChevronUp, ChevronDown } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';

// ── Typen ──

interface OutlierItem {
  reading_id: string;
  meter_id: string;
  meter_name: string;
  energy_type: string;
  timestamp: string;
  value: number;
  consumption: number;
  median_consumption: number;
  factor: number;
  quality: string;
}

type Action = 'delete' | 'flag' | 'interpolate';
type SortField = 'factor' | 'meter_name' | 'timestamp' | 'consumption';

const ENERGY_TYPE_COLORS: Record<string, string> = {
  electricity: 'bg-yellow-100 text-yellow-800',
  gas: 'bg-blue-100 text-blue-800',
  district_heating: 'bg-red-100 text-red-800',
  district_cooling: 'bg-cyan-100 text-cyan-800',
  water: 'bg-teal-100 text-teal-800',
};

const ACTION_LABELS: Record<Action, string> = {
  delete: 'Löschen',
  flag: 'Markieren',
  interpolate: 'Interpolieren',
};

const ACTION_DESCRIPTIONS: Record<Action, string> = {
  delete: 'Messwert dauerhaft löschen',
  flag: 'Als Ausreißer markieren, Verbrauch auf NULL setzen',
  interpolate: 'Verbrauch durch Mittelwert der Nachbarwerte ersetzen',
};

// ── Komponente ──

export default function OutliersPage() {
  const [outliers, setOutliers] = useState<OutlierItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter
  const [factorThreshold, setFactorThreshold] = useState(10);
  const [minValue, setMinValue] = useState(100);
  const [energyTypeFilter, setEnergyTypeFilter] = useState('');

  // Sortierung
  const [sortField, setSortField] = useState<SortField>('factor');
  const [sortAsc, setSortAsc] = useState(false);

  // Selektion
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Aktionsstatus
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Ausreißer laden
  const loadOutliers = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const params = new URLSearchParams({
        factor_threshold: factorThreshold.toString(),
        min_value: minValue.toString(),
      });
      if (energyTypeFilter) params.set('energy_type', energyTypeFilter);
      const res = await apiClient.get<OutlierItem[]>(`/api/v1/readings/outliers?${params}`);
      setOutliers(res.data);
    } catch {
      setError('Ausreißer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [factorThreshold, minValue, energyTypeFilter]);

  useEffect(() => {
    loadOutliers();
  }, [loadOutliers]);

  // Einzelaktion
  const handleAction = async (readingId: string, action: Action) => {
    setActionLoading((prev) => new Set(prev).add(readingId));
    setSuccessMsg(null);
    try {
      await apiClient.post(`/api/v1/readings/outliers/${readingId}/action`, { action });
      setOutliers((prev) => prev.filter((o) => o.reading_id !== readingId));
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(readingId); return s; });
      setSuccessMsg(`Aktion "${ACTION_LABELS[action]}" erfolgreich ausgeführt.`);
    } catch {
      setError(`Aktion "${ACTION_LABELS[action]}" fehlgeschlagen.`);
    } finally {
      setActionLoading((prev) => { const s = new Set(prev); s.delete(readingId); return s; });
    }
  };

  // Massenaktion
  const handleBulkAction = async (action: 'delete' | 'flag') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setSuccessMsg(null);
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      await apiClient.post(`/api/v1/readings/outliers/bulk-action?action=${action}`, ids);
      setOutliers((prev) => prev.filter((o) => !selectedIds.has(o.reading_id)));
      setSuccessMsg(`${ids.length} Messwert(e) "${ACTION_LABELS[action]}" erfolgreich.`);
      setSelectedIds(new Set());
    } catch {
      setError('Massenaktion fehlgeschlagen.');
    } finally {
      setBulkLoading(false);
    }
  };

  // Sortierung
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(false); }
  };

  const sorted = [...outliers].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'factor') cmp = a.factor - b.factor;
    else if (sortField === 'meter_name') cmp = a.meter_name.localeCompare(b.meter_name);
    else if (sortField === 'timestamp') cmp = a.timestamp.localeCompare(b.timestamp);
    else if (sortField === 'consumption') cmp = a.consumption - b.consumption;
    return sortAsc ? cmp : -cmp;
  });

  const allSelected = sorted.length > 0 && sorted.every((o) => selectedIds.has(o.reading_id));
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(sorted.map((o) => o.reading_id)));
  };
  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortAsc ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const fmtNum = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });

  return (
    <div className="p-6 space-y-6">
      {/* Kopfzeile */}
      <div className="flex items-center gap-3">
        <AlertTriangle className="w-7 h-7 text-orange-500" />
        <div>
          <h1 className="page-title">Ausreißer-Erkennung</h1>
          <p className="text-sm text-gray-500">
            Messwerte mit ungewöhnlich hohem Verbrauch erkennen und bereinigen
          </p>
        </div>
      </div>

      {/* Filter-Panel */}
      <div className="card p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Energieart</label>
            <select
              className="input w-48"
              value={energyTypeFilter}
              onChange={(e) => setEnergyTypeFilter(e.target.value)}
            >
              <option value="">Alle Energiearten</option>
              {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Faktor-Schwellwert (× Median)</label>
            <input
              type="number"
              className="input w-32"
              value={factorThreshold}
              min={2}
              max={100}
              onChange={(e) => setFactorThreshold(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">Mindestwert (kWh/m³)</label>
            <input
              type="number"
              className="input w-32"
              value={minValue}
              min={0}
              onChange={(e) => setMinValue(Number(e.target.value))}
            />
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={loadOutliers}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Analysieren
          </button>
        </div>
      </div>

      {/* Statusmeldungen */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
          {error}
        </div>
      )}
      {successMsg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-green-700 text-sm">
          {successMsg}
        </div>
      )}

      {/* Ergebnis-Header */}
      {!loading && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-600">
            {outliers.length === 0
              ? 'Keine Ausreißer gefunden – alle Messwerte im Normalbereich.'
              : (
                <>
                  <span className="font-semibold text-orange-600">{outliers.length}</span> Ausreißer gefunden
                  {selectedIds.size > 0 && (
                    <span className="ml-2 text-gray-400">({selectedIds.size} ausgewählt)</span>
                  )}
                </>
              )}
          </div>

          {/* Massenaktionen */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500 mr-1">{selectedIds.size} ausgewählt:</span>
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm font-medium transition"
                onClick={() => handleBulkAction('delete')}
                disabled={bulkLoading}
              >
                <Trash2 className="w-3.5 h-3.5" /> Alle löschen
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 hover:bg-orange-200 text-orange-700 rounded text-sm font-medium transition"
                onClick={() => handleBulkAction('flag')}
                disabled={bulkLoading}
              >
                <Flag className="w-3.5 h-3.5" /> Alle markieren
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tabelle */}
      {!loading && outliers.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-3 text-left w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th
                    className="px-3 py-3 text-left cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleSort('meter_name')}
                  >
                    <span className="flex items-center gap-1">Zähler <SortIcon field="meter_name" /></span>
                  </th>
                  <th className="px-3 py-3 text-left">Energieart</th>
                  <th
                    className="px-3 py-3 text-left cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleSort('timestamp')}
                  >
                    <span className="flex items-center gap-1">Zeitstempel <SortIcon field="timestamp" /></span>
                  </th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleSort('consumption')}
                  >
                    <span className="flex items-center gap-1 justify-end">Verbrauch <SortIcon field="consumption" /></span>
                  </th>
                  <th className="px-3 py-3 text-right">Median</th>
                  <th
                    className="px-3 py-3 text-right cursor-pointer hover:bg-gray-100 select-none"
                    onClick={() => toggleSort('factor')}
                  >
                    <span className="flex items-center gap-1 justify-end">Faktor <SortIcon field="factor" /></span>
                  </th>
                  <th className="px-3 py-3 text-center">Status</th>
                  <th className="px-3 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((o) => {
                  const isProcessing = actionLoading.has(o.reading_id);
                  const isSelected = selectedIds.has(o.reading_id);
                  const factorColor =
                    o.factor >= 100 ? 'text-red-700 font-bold' :
                    o.factor >= 50  ? 'text-red-600 font-semibold' :
                    o.factor >= 20  ? 'text-orange-600 font-semibold' :
                                      'text-orange-500';
                  return (
                    <tr
                      key={o.reading_id}
                      className={`${isSelected ? 'bg-orange-50' : 'hover:bg-gray-50'} transition`}
                    >
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(o.reading_id)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-medium text-gray-900 max-w-xs truncate" title={o.meter_name}>
                        {o.meter_name}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ENERGY_TYPE_COLORS[o.energy_type] || 'bg-gray-100 text-gray-700'}`}>
                          {ENERGY_TYPE_LABELS[o.energy_type as keyof typeof ENERGY_TYPE_LABELS] || o.energy_type}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        {fmtDate(o.timestamp)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-900">
                        {fmtNum(o.consumption)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-gray-500">
                        {fmtNum(o.median_consumption)}
                      </td>
                      <td className={`px-3 py-2.5 text-right font-mono ${factorColor}`}>
                        ×{fmtNum(o.factor)}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium
                          ${o.quality === 'outlier' ? 'bg-red-100 text-red-700' :
                            o.quality === 'interpolated' ? 'bg-blue-100 text-blue-700' :
                            'bg-gray-100 text-gray-600'}`}>
                          {o.quality === 'outlier' ? 'Ausreißer' :
                           o.quality === 'interpolated' ? 'Interpoliert' :
                           o.quality === 'measured' ? 'Gemessen' : o.quality}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex justify-end gap-1.5">
                          <ActionButton
                            icon={<TrendingDown className="w-3.5 h-3.5" />}
                            label="Interpolieren"
                            title={ACTION_DESCRIPTIONS.interpolate}
                            color="blue"
                            onClick={() => handleAction(o.reading_id, 'interpolate')}
                            disabled={isProcessing}
                          />
                          <ActionButton
                            icon={<Flag className="w-3.5 h-3.5" />}
                            label="Markieren"
                            title={ACTION_DESCRIPTIONS.flag}
                            color="orange"
                            onClick={() => handleAction(o.reading_id, 'flag')}
                            disabled={isProcessing}
                          />
                          <ActionButton
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            label="Löschen"
                            title={ACTION_DESCRIPTIONS.delete}
                            color="red"
                            onClick={() => handleAction(o.reading_id, 'delete')}
                            disabled={isProcessing}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="flex flex-col items-center gap-3 text-gray-500">
            <RefreshCw className="w-8 h-8 animate-spin text-primary-500" />
            <span className="text-sm">Analysiere {outliers.length > 0 ? `(${outliers.length} bisher)` : '...'}</span>
          </div>
        </div>
      )}

      {/* Legende */}
      {!loading && outliers.length > 0 && (
        <div className="text-xs text-gray-400 space-y-1">
          <p><strong>Interpolieren:</strong> Verbrauch wird durch den Mittelwert der beiden Nachbarwerte ersetzt, Status → "Interpoliert"</p>
          <p><strong>Markieren:</strong> Messwert bleibt erhalten, Verbrauch wird auf NULL gesetzt, Status → "Ausreißer"</p>
          <p><strong>Löschen:</strong> Messwert wird dauerhaft aus der Datenbank entfernt</p>
        </div>
      )}
    </div>
  );
}

// ── ActionButton-Hilfskomponente ──

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  title: string;
  color: 'red' | 'orange' | 'blue';
  onClick: () => void;
  disabled?: boolean;
}

function ActionButton({ icon, label, title, color, onClick, disabled }: ActionButtonProps) {
  const colors = {
    red: 'bg-red-50 hover:bg-red-100 text-red-600 border-red-200',
    orange: 'bg-orange-50 hover:bg-orange-100 text-orange-600 border-orange-200',
    blue: 'bg-blue-50 hover:bg-blue-100 text-blue-600 border-blue-200',
  };
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 px-2 py-1 rounded border text-xs font-medium transition
        ${colors[color]} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {icon}
      {label}
    </button>
  );
}

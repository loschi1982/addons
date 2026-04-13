/**
 * BenchmarkingPage – Externe Referenzwerte (VDI 3807, GEFMA 124, BAFA)
 * und EnPI-Vergleich mit Branchenstandards.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { BookOpen, Search, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { apiClient } from '@/utils/api';

interface BenchmarkRef {
  id: string;
  building_type: string;
  energy_type: string;
  source: string;
  unit: string;
  value_good: number;
  value_medium: number;
  value_poor: number;
  description: string;
  is_active: boolean;
}

interface CompareResult {
  building_type: string;
  energy_type: string;
  actual_value: number;
  unit: string;
  rating: string; // good | medium | poor
  value_good: number;
  value_medium: number;
  value_poor: number;
  percentile_vs_good: number;
  source: string;
  description: string;
}

interface Overview {
  building_types: string[];
  energy_types: string[];
  sources: string[];
  total_references: number;
}

const BUILDING_TYPE_LABELS: Record<string, string> = {
  office: 'Büro',
  school: 'Schule',
  hospital: 'Krankenhaus',
  residential: 'Wohngebäude',
  retail: 'Einzelhandel',
  warehouse: 'Lager/Logistik',
  production: 'Produktion',
  hotel: 'Hotel',
  sports_hall: 'Sporthalle',
  data_center: 'Rechenzentrum',
  public_building: 'Öffentliches Gebäude',
};

const ENERGY_TYPE_LABELS: Record<string, string> = {
  electricity: 'Strom',
  gas: 'Erdgas',
  heating: 'Wärme',
  cooling: 'Kälte',
  total: 'Gesamt',
  water: 'Wasser',
};

const SOURCE_COLORS: Record<string, string> = {
  VDI_3807: '#1B5E7B',
  GEFMA_124: '#2196F3',
  BAFA: '#4CAF50',
  DIN_18599: '#FF9800',
  EnEV: '#9C27B0',
  custom: '#607D8B',
};

function RatingBadge({ rating }: { rating: string }) {
  const styles: Record<string, string> = {
    good: 'bg-green-100 text-green-800',
    medium: 'bg-yellow-100 text-yellow-800',
    poor: 'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = {
    good: 'Gut',
    medium: 'Mittel',
    poor: 'Schlecht',
  };
  const icons: Record<string, React.ReactNode> = {
    good: <TrendingDown size={14} />,
    medium: <Minus size={14} />,
    poor: <TrendingUp size={14} />,
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${styles[rating] ?? 'bg-gray-100 text-gray-700'}`}>
      {icons[rating]}
      {labels[rating] ?? rating}
    </span>
  );
}

export default function BenchmarkingPage() {
  const [refs, setRefs] = useState<BenchmarkRef[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter
  const [buildingType, setBuildingType] = useState('');
  const [energyType, setEnergyType] = useState('');
  const [source, setSource] = useState('');

  // Vergleich
  const [compareBuilding, setCompareBuilding] = useState('office');
  const [compareEnergy, setCompareEnergy] = useState('electricity');
  const [compareValue, setCompareValue] = useState('');
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [comparing, setComparing] = useState(false);

  const loadRefs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (buildingType) params.set('building_type', buildingType);
      if (energyType) params.set('energy_type', energyType);
      if (source) params.set('source', source);
      const res = await apiClient.get<BenchmarkRef[]>(`/api/v1/benchmarks?${params}`);
      setRefs(res.data);
    } catch {
      setError('Referenzwerte konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [buildingType, energyType, source]);

  useEffect(() => {
    apiClient.get<Overview>('/api/v1/benchmarks/overview').then(r => setOverview(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const handleCompare = async () => {
    if (!compareValue) return;
    setComparing(true);
    try {
      const params = new URLSearchParams({
        building_type: compareBuilding,
        energy_type: compareEnergy,
        actual_value: compareValue,
      });
      const res = await apiClient.get<CompareResult>(`/api/v1/benchmarks/compare?${params}`);
      setCompareResult(res.data);
    } catch {
      setError('Vergleich fehlgeschlagen.');
    } finally {
      setComparing(false);
    }
  };

  // Daten für Balkendiagramm (Vergleich)
  const chartData = compareResult
    ? [
        { name: 'Gut', value: compareResult.value_good, fill: '#4CAF50' },
        { name: 'Mittel', value: compareResult.value_medium, fill: '#FF9800' },
        { name: 'Schlecht', value: compareResult.value_poor, fill: '#F44336' },
      ]
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen size={24} className="text-primary-600" />
        <h1 className="page-title">Benchmarking</h1>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <div className="text-2xl font-bold text-primary-700">{overview.total_references}</div>
            <div className="text-sm text-gray-500">Referenzwerte gesamt</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-primary-700">{overview.building_types.length}</div>
            <div className="text-sm text-gray-500">Gebäudetypen</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-primary-700">{overview.energy_types.length}</div>
            <div className="text-sm text-gray-500">Energieträger</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-primary-700">{overview.sources.length}</div>
            <div className="text-sm text-gray-500">Quellen</div>
          </div>
        </div>
      )}

      {/* Vergleichsrechner */}
      <div className="card">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Eigenen Wert vergleichen</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
          <div>
            <label className="label">Gebäudetyp</label>
            <select
              className="input"
              value={compareBuilding}
              onChange={(e) => setCompareBuilding(e.target.value)}
            >
              {Object.entries(BUILDING_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Energieträger</label>
            <select
              className="input"
              value={compareEnergy}
              onChange={(e) => setCompareEnergy(e.target.value)}
            >
              {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Eigener Wert (kWh/m²·a)</label>
            <input
              type="number"
              className="input"
              placeholder="z.B. 120"
              value={compareValue}
              onChange={(e) => setCompareValue(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <button
              className="btn-primary w-full flex items-center justify-center gap-2"
              onClick={handleCompare}
              disabled={comparing || !compareValue}
            >
              <Search size={16} />
              {comparing ? 'Vergleiche...' : 'Vergleichen'}
            </button>
          </div>
        </div>

        {compareResult && (
          <div className="border-t pt-4 space-y-4">
            <div className="flex items-center gap-4">
              <span className="font-medium">Bewertung:</span>
              <RatingBadge rating={compareResult.rating} />
              <span className="text-gray-600 text-sm">
                Eigener Wert: <strong>{compareResult.actual_value}</strong> {compareResult.unit}
                {' · '}Quelle: {compareResult.source}
              </span>
            </div>
            <p className="text-sm text-gray-600">{compareResult.description}</p>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis unit=" kWh/m²" />
                  <Tooltip formatter={(v) => `${v} kWh/m²·a`} />
                  <ReferenceLine
                    y={compareResult.actual_value}
                    stroke="#1B5E7B"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    label={{ value: 'Eigener Wert', position: 'insideTopRight', fill: '#1B5E7B', fontSize: 12 }}
                  />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Referenzwert-Tabelle */}
      <div className="card">
        <div className="flex flex-wrap gap-3 mb-4">
          <div>
            <label className="label">Gebäudetyp</label>
            <select className="input" value={buildingType} onChange={(e) => setBuildingType(e.target.value)}>
              <option value="">Alle</option>
              {Object.entries(BUILDING_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Energieträger</label>
            <select className="input" value={energyType} onChange={(e) => setEnergyType(e.target.value)}>
              <option value="">Alle</option>
              {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Quelle</label>
            <select className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Alle</option>
              {Object.keys(SOURCE_COLORS).map((s) => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500">Laden...</div>
        ) : refs.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Keine Referenzwerte gefunden.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="pb-2 pr-4">Gebäudetyp</th>
                  <th className="pb-2 pr-4">Energieträger</th>
                  <th className="pb-2 pr-4">Quelle</th>
                  <th className="pb-2 pr-4">Einheit</th>
                  <th className="pb-2 pr-4 text-right">Gut</th>
                  <th className="pb-2 pr-4 text-right">Mittel</th>
                  <th className="pb-2 text-right">Schlecht</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {refs.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="py-2 pr-4">{BUILDING_TYPE_LABELS[r.building_type] ?? r.building_type}</td>
                    <td className="py-2 pr-4">{ENERGY_TYPE_LABELS[r.energy_type] ?? r.energy_type}</td>
                    <td className="py-2 pr-4">
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-xs text-white"
                        style={{ backgroundColor: SOURCE_COLORS[r.source] ?? '#607D8B' }}
                      >
                        {r.source.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.unit}</td>
                    <td className="py-2 pr-4 text-right font-medium text-green-700">{r.value_good.toFixed(0)}</td>
                    <td className="py-2 pr-4 text-right font-medium text-yellow-700">{r.value_medium.toFixed(0)}</td>
                    <td className="py-2 text-right font-medium text-red-700">{r.value_poor.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

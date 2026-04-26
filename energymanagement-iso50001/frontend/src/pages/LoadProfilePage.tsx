import { useState, useEffect, useCallback } from 'react';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, BarChart,
} from 'recharts';
import { RefreshCw, Zap, AlertTriangle, TrendingUp, Activity } from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface Meter {
  id: string;
  name: string;
  energy_type: string;
  location: string | null;
}

interface DataPoint {
  ts: string;
  consumption: number;
  demand_kw: number | null;
}

interface DailyPeak {
  date: string;
  peak_kw: number;
}

interface LoadProfileData {
  period_start: string;
  period_end: string;
  meter_count: number;
  data_points: DataPoint[];
  peak_demand_kw: number | null;
  peak_timestamp: string | null;
  avg_demand_kw: number | null;
  daily_peaks: DailyPeak[];
  total_kwh: number;
  resolution_minutes: number | null;
  max_demand_kw_contract: number | null;
  contract_exceeded: boolean;
}

/* ── Hilfsfunktionen ── */

function fmt(v: number, d = 1) {
  return v.toLocaleString('de-DE', { maximumFractionDigits: d });
}

function shortTs(ts: string): string {
  // "2025-03-15T08:30:00+00:00" → "15.03 08:30"
  try {
    const d = new Date(ts);
    return d.toLocaleString('de-DE', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return ts.slice(5, 16);
  }
}

/* ── Hauptkomponente ── */

export default function LoadProfilePage() {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const lastDayOfMonth = new Date(currentYear, currentMonth, 0).getDate();

  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedEnergyType, setSelectedEnergyType] = useState('electricity');
  const [selectedMeters, setSelectedMeters] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(
    `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`
  );
  const [endDate, setEndDate] = useState(
    `${currentYear}-${String(currentMonth).padStart(2, '0')}-${lastDayOfMonth}`
  );
  const [maxDemandContract, setMaxDemandContract] = useState('');
  const [data, setData] = useState<LoadProfileData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zähler laden
  useEffect(() => {
    apiClient.get<{ items: Meter[] }>('/api/v1/meters?page_size=500').then(res => {
      setMeters(res.data.items);
    }).catch(() => {});
  }, []);

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  const handleEnergyTypeChange = (et: string) => {
    setSelectedEnergyType(et);
    setSelectedMeters([]);
  };

  const toggleMeter = (id: string) => {
    setSelectedMeters(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    );
  };

  const load = useCallback(async () => {
    if (selectedMeters.length === 0) {
      setError('Bitte mindestens einen Zähler auswählen.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        meter_ids: selectedMeters.join(','),
        start_date: startDate,
        end_date: endDate,
      });
      if (maxDemandContract) {
        params.set('max_demand_kw_contract', maxDemandContract);
      }
      const res = await apiClient.get<LoadProfileData>(
        `/api/v1/analytics/load-profile?${params}`
      );
      setData(res.data);
    } catch {
      setError('Lastprofil konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [selectedMeters, startDate, endDate, maxDemandContract]);

  // Chartdaten vorbereiten: Zeitstempel kürzen für X-Achse
  const chartPoints = data?.data_points.map(p => ({
    ts: shortTs(p.ts),
    rawTs: p.ts,
    demand_kw: p.demand_kw,
    consumption: p.consumption,
  })) ?? [];

  const hasDemand = chartPoints.some(p => p.demand_kw != null);
  const contractKw = maxDemandContract ? Number(maxDemandContract) : null;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Lastprofil & Spitzenlast</h1>
        <p className="text-sm text-gray-500 mt-1">
          Leistungsverlauf (kW) aus Zählerständen – Peak-Erkennung und Vergleich mit Vertragslimit
        </p>
      </div>

      {/* Filter */}
      <div className="card p-4 space-y-4">
        {/* Energieträger-Filter */}
        <div>
          <label className="label mb-2">Energieträger</label>
          <div className="flex flex-wrap gap-2">
            {energyTypes.map(et => (
              <button
                key={et}
                onClick={() => handleEnergyTypeChange(et)}
                className={`px-3 py-1 text-sm rounded-full border transition-all ${
                  selectedEnergyType === et
                    ? 'bg-[#1B5E7B] text-white border-[#1B5E7B]'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E7B]'
                }`}
              >
                {et === 'electricity' ? 'Strom' : et === 'district_heating' ? 'Fernwärme' : et === 'district_cooling' ? 'Kälte' : et === 'water' ? 'Wasser' : et}
              </button>
            ))}
          </div>
        </div>

        {/* Zähler-Auswahl */}
        <div>
          <label className="label mb-2">Zähler auswählen (mind. 1)</label>
          <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
            {filteredMeters.map(m => (
              <button
                key={m.id}
                onClick={() => toggleMeter(m.id)}
                className={`px-3 py-1 text-sm rounded-full border transition-all ${
                  selectedMeters.includes(m.id)
                    ? 'bg-[#1B5E7B] text-white border-[#1B5E7B]'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-[#1B5E7B]'
                }`}
              >
                {m.name}
                {m.location && <span className="opacity-60 ml-1 text-xs">· {m.location}</span>}
              </button>
            ))}
            {filteredMeters.length === 0 && (
              <p className="text-sm text-gray-400">Keine Zähler für diesen Energieträger</p>
            )}
          </div>
        </div>

        {/* Zeitraum + Limit */}
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="label">Von</label>
            <input type="date" className="input w-40" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Bis</label>
            <input type="date" className="input w-40" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Vertragslimit kW (opt.)</label>
            <input
              type="number"
              className="input w-36"
              min="0"
              step="any"
              placeholder="z.B. 100"
              value={maxDemandContract}
              onChange={e => setMaxDemandContract(e.target.value)}
            />
          </div>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={load}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            Laden
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
      )}

      {data && (
        <>
          {/* Contract-Überschreitung */}
          {data.contract_exceeded && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-center gap-3 text-red-700">
              <AlertTriangle size={18} />
              <div>
                <p className="font-semibold">Vertragliche Leistungsgrenze überschritten!</p>
                <p className="text-sm">
                  Spitzenlast {fmt(data.peak_demand_kw!, 1)} kW &gt; Vertragslimit {fmt(contractKw!, 1)} kW
                  {' '}→ mögliche Lastspitzen-Entgelte prüfen.
                </p>
              </div>
            </div>
          )}

          {/* Kein Lastprofil (zu grobe Ablesungen) */}
          {data.data_points.length > 0 && !hasDemand && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-amber-700 text-sm">
              <AlertTriangle size={14} className="inline mr-1" />
              Ablesungen vorhanden, aber keine Leistungsberechnung möglich – Zeitdeltas &gt; 2 Stunden
              (z.B. Tagesablesungen). Für Lastprofile werden Ablesungen im 15-min- bis 60-min-Intervall benötigt.
            </div>
          )}

          {/* KPI-Karten */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Activity size={14} /> Spitzenlast
              </div>
              <p className={`text-2xl font-bold ${data.contract_exceeded ? 'text-red-600' : 'text-[#1B5E7B]'}`}>
                {data.peak_demand_kw != null ? `${fmt(data.peak_demand_kw, 1)} kW` : '–'}
              </p>
              {data.peak_timestamp && (
                <p className="text-xs text-gray-400 mt-1">{shortTs(data.peak_timestamp)}</p>
              )}
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <TrendingUp size={14} /> Mittlere Last
              </div>
              <p className="text-2xl font-bold text-gray-800">
                {data.avg_demand_kw != null ? `${fmt(data.avg_demand_kw, 1)} kW` : '–'}
              </p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Zap size={14} /> Gesamtverbrauch
              </div>
              <p className="text-2xl font-bold text-gray-800">{fmt(data.total_kwh)} kWh</p>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 text-gray-500 text-xs mb-1">
                <Activity size={14} /> Auflösung
              </div>
              <p className="text-2xl font-bold text-gray-800">
                {data.resolution_minutes != null ? `${data.resolution_minutes} min` : '–'}
              </p>
              <p className="text-xs text-gray-400 mt-1">{data.data_points.length} Messpunkte</p>
            </div>
          </div>

          {/* Lastprofil-Chart */}
          {hasDemand && chartPoints.length > 0 && (
            <div className="card p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                Leistungsverlauf (kW)
                {data.resolution_minutes && data.resolution_minutes > 60 && (
                  <span className="ml-2 text-xs text-amber-600 font-normal">
                    · auf Stundenwerte aggregiert
                  </span>
                )}
              </h2>
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartPoints} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis
                    dataKey="ts"
                    tick={{ fontSize: 10 }}
                    interval={Math.max(0, Math.floor(chartPoints.length / 12) - 1)}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => `${v.toFixed(0)} kW`}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'demand_kw') return [`${fmt(value, 2)} kW`, 'Leistung'];
                      return [`${fmt(value, 3)} kWh`, 'Verbrauch'];
                    }}
                    labelFormatter={(label: string) => label}
                  />
                  {contractKw != null && (
                    <ReferenceLine
                      y={contractKw}
                      stroke="#DC2626"
                      strokeDasharray="6 3"
                      label={{
                        value: `Limit ${fmt(contractKw, 0)} kW`,
                        position: 'insideTopRight',
                        fontSize: 11,
                        fill: '#DC2626',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="demand_kw"
                    stroke="#1B5E7B"
                    strokeWidth={1.5}
                    dot={false}
                    connectNulls={false}
                    name="demand_kw"
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tages-Peaks */}
          {data.daily_peaks.length > 0 && (
            <div className="card p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                Tägliche Spitzenlast (kW)
              </h2>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={data.daily_peaks} margin={{ top: 5, right: 20, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10 }}
                    angle={-40}
                    textAnchor="end"
                    height={50}
                    interval={Math.max(0, Math.floor(data.daily_peaks.length / 10) - 1)}
                  />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}`} />
                  <Tooltip formatter={(v: number) => [`${fmt(v, 2)} kW`, 'Spitzenlast']} />
                  {contractKw != null && (
                    <ReferenceLine y={contractKw} stroke="#DC2626" strokeDasharray="4 2" />
                  )}
                  <Bar
                    dataKey="peak_kw"
                    fill="#1B5E7B"
                    radius={[2, 2, 0, 0]}
                    name="Spitzenlast kW"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Keine Daten */}
          {data.data_points.length === 0 && (
            <div className="card p-8 text-center text-gray-400">
              <Activity size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Keine Ablesungen im Zeitraum</p>
              <p className="text-sm mt-1">
                Für die gewählten Zähler liegen im angegebenen Zeitraum keine Verbrauchsdaten vor.
              </p>
            </div>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <Activity size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Lastprofil laden</p>
          <p className="text-sm mt-1">
            Zähler und Zeitraum wählen, dann „Laden" klicken.
          </p>
          <p className="text-xs mt-2 text-gray-300">
            Für Leistungswerte (kW) werden Ablesungen im 15–60-Minuten-Intervall benötigt.
          </p>
        </div>
      )}
    </div>
  );
}

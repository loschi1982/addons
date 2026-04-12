import { useState, useCallback } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface EtMeta {
  key: string;
  label: string;
  unit: string;
  color: string;
}

interface MonthValues {
  year_a: number;
  year_b: number;
  delta_pct: number | null;
  unit: string;
}

interface ComparisonRow {
  month: number;
  label: string;
  values: Record<string, MonthValues>;
}

interface ComparisonData {
  year_a: number;
  year_b: number;
  energy_types: EtMeta[];
  months: { month: number; label: string }[];
  rows: ComparisonRow[];
}

/* ── Hilfsfunktionen ── */

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-gray-400">–</span>;
  const up = delta > 5;
  const down = delta < -5;
  const color = up ? 'text-red-600' : down ? 'text-green-600' : 'text-gray-700';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${color}`}>
      <Icon size={12} />
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

const MONTH_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

/* ── Hauptkomponente ── */

export default function MonthlyComparisonPage() {
  const currentYear = new Date().getFullYear();
  const [yearA, setYearA] = useState(currentYear - 1);
  const [yearB, setYearB] = useState(currentYear);
  const [selectedEts, setSelectedEts] = useState<string[]>([]);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEt, setActiveEt] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        year_a: String(yearA),
        year_b: String(yearB),
      });
      if (selectedEts.length > 0) {
        params.set('energy_types', selectedEts.join(','));
      }
      const res = await apiClient.get<ComparisonData>(
        `/api/v1/analytics/monthly-comparison?${params}`
      );
      setData(res.data);
      if (res.data.energy_types.length > 0 && activeEt === null) {
        setActiveEt(res.data.energy_types[0].key);
      }
    } catch {
      setError('Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [yearA, yearB, selectedEts, activeEt]);

  const toggleEt = (key: string) => {
    setSelectedEts(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  // Chartdaten für aktive Energieart aufbereiten
  const chartData = data && activeEt
    ? data.rows.map(row => {
        const v = row.values[activeEt];
        return {
          label: row.label,
          [String(yearA)]: v?.year_a ?? 0,
          [String(yearB)]: v?.year_b ?? 0,
          delta_pct: v?.delta_pct ?? null,
        };
      })
    : [];

  const activeEtMeta = data?.energy_types.find(e => e.key === activeEt);

  // Jahressummen je Energieart
  const yearSums = data
    ? data.energy_types.map(et => {
        const sumA = data.rows.reduce((s, r) => s + (r.values[et.key]?.year_a ?? 0), 0);
        const sumB = data.rows.reduce((s, r) => s + (r.values[et.key]?.year_b ?? 0), 0);
        const delta = sumA > 0 ? ((sumB - sumA) / sumA) * 100 : null;
        return { ...et, sumA, sumB, delta };
      })
    : [];

  const years = Array.from({ length: 10 }, (_, i) => currentYear - 5 + i);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Monatlicher Jahresvergleich</h1>
          <p className="text-sm text-gray-500 mt-1">
            Verbrauchsvergleich zweier Jahre nach Energieträgern – grafisch und tabellarisch
          </p>
        </div>
      </div>

      {/* Filter-Panel */}
      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Jahr A (Basis)</label>
          <select
            className="input w-32"
            value={yearA}
            onChange={e => setYearA(Number(e.target.value))}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Jahr B (Vergleich)</label>
          <select
            className="input w-32"
            value={yearB}
            onChange={e => setYearB(Number(e.target.value))}
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
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

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
      )}

      {data && (
        <>
          {/* Energieträger-Filter */}
          {data.energy_types.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {data.energy_types.map(et => (
                <button
                  key={et.key}
                  onClick={() => toggleEt(et.key)}
                  className={`px-3 py-1 rounded-full text-sm font-medium border transition-all ${
                    selectedEts.length === 0 || selectedEts.includes(et.key)
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-500 border-gray-300'
                  }`}
                  style={
                    selectedEts.length === 0 || selectedEts.includes(et.key)
                      ? { backgroundColor: et.color, borderColor: et.color }
                      : {}
                  }
                >
                  {et.label}
                </button>
              ))}
            </div>
          )}

          {/* KPI-Karten: Jahressummen */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {yearSums.map(et => (
              <div
                key={et.key}
                className={`card p-4 cursor-pointer transition-all ${
                  activeEt === et.key ? 'ring-2 ring-offset-1' : 'hover:shadow-md'
                }`}
                style={activeEt === et.key ? { outlineColor: et.color, outline: `2px solid ${et.color}` } : {}}
                onClick={() => setActiveEt(et.key)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">{et.label}</span>
                  <DeltaBadge delta={et.delta ?? null} />
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{yearA}</span>
                    <span className="font-medium text-gray-800">
                      {et.sumA.toLocaleString('de-DE', { maximumFractionDigits: 1 })} {et.unit}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{yearB}</span>
                    <span className="font-semibold" style={{ color: et.color }}>
                      {et.sumB.toLocaleString('de-DE', { maximumFractionDigits: 1 })} {et.unit}
                    </span>
                  </div>
                </div>
                {/* Mini-Fortschrittsbalken */}
                <div className="mt-2 h-1 bg-gray-100 rounded">
                  <div
                    className="h-1 rounded transition-all"
                    style={{
                      backgroundColor: et.color,
                      width: `${Math.min(100, et.sumA > 0 ? (et.sumB / et.sumA) * 100 : 0)}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Chart: aktive Energieart */}
          {activeEt && chartData.length > 0 && (
            <div className="card p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                {activeEtMeta?.label} – Monatlicher Vergleich {yearA} vs. {yearB}
                <span className="ml-2 text-sm text-gray-400 font-normal">({activeEtMeta?.unit})</span>
              </h2>
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={chartData} margin={{ top: 10, right: 40, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)
                    }
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 10, fill: '#6B7280' }}
                    tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      if (name === 'delta_pct')
                        return [`${value > 0 ? '+' : ''}${value?.toFixed(1)}%`, 'Δ %'];
                      return [
                        `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${activeEtMeta?.unit}`,
                        name,
                      ];
                    }}
                  />
                  <ReferenceLine yAxisId="right" y={0} stroke="#D1D5DB" />
                  <Bar yAxisId="left" dataKey={String(yearA)} fill="#9CA3AF" name={String(yearA)} radius={[2, 2, 0, 0]} />
                  <Bar
                    yAxisId="left"
                    dataKey={String(yearB)}
                    fill={activeEtMeta?.color ?? '#1B5E7B'}
                    name={String(yearB)}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="delta_pct"
                    stroke="#DC2626"
                    strokeWidth={1.5}
                    dot={{ r: 3, fill: '#DC2626' }}
                    name="Δ %"
                    connectNulls={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabelle: alle Energieträger × Monate */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1B5E7B] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Monat</th>
                  {data.energy_types.map(et => (
                    <th key={et.key} colSpan={3} className="px-3 py-2 text-center font-semibold">
                      {et.label} ({et.unit})
                    </th>
                  ))}
                </tr>
                <tr className="bg-[#155068] text-white text-xs">
                  <th className="px-3 py-2 text-left">&nbsp;</th>
                  {data.energy_types.map(et => (
                    <>
                      <th key={`${et.key}-a`} className="px-2 py-1 text-right">{yearA}</th>
                      <th key={`${et.key}-b`} className="px-2 py-1 text-right">{yearB}</th>
                      <th key={`${et.key}-d`} className="px-2 py-1 text-right">Δ %</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.month} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium text-gray-700">{MONTH_NAMES[row.month - 1]}</td>
                    {data.energy_types.map(et => {
                      const v = row.values[et.key];
                      return (
                        <>
                          <td key={`${et.key}-a`} className="px-2 py-2 text-right text-gray-600">
                            {v?.year_a ? v.year_a.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–'}
                          </td>
                          <td key={`${et.key}-b`} className="px-2 py-2 text-right font-medium">
                            {v?.year_b ? v.year_b.toLocaleString('de-DE', { maximumFractionDigits: 1 }) : '–'}
                          </td>
                          <td key={`${et.key}-d`} className="px-2 py-2 text-right">
                            <DeltaBadge delta={v?.delta_pct ?? null} />
                          </td>
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {/* Summenzeile */}
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-gray-800">Gesamt</td>
                  {yearSums.map(et => (
                    <>
                      <td key={`${et.key}-sa`} className="px-2 py-2 text-right text-gray-600">
                        {et.sumA.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
                      </td>
                      <td key={`${et.key}-sb`} className="px-2 py-2 text-right" style={{ color: et.color }}>
                        {et.sumB.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
                      </td>
                      <td key={`${et.key}-sd`} className="px-2 py-2 text-right">
                        <DeltaBadge delta={et.delta ?? null} />
                      </td>
                    </>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {!data && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <TrendingUp size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Jahresvergleich laden</p>
          <p className="text-sm mt-1">
            Jahre auswählen und auf „Laden" klicken, um den Vergleich zu starten.
          </p>
        </div>
      )}
    </div>
  );
}

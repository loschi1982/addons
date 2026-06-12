import { useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { apiClient } from '@/utils/api';
import PageHead from '@/components/ui/PageHead';

/* ── Typen ── */

interface EtMeta {
  key: string;
  label: string;
  unit: string;
  color: string;
}

interface MonthValues {
  by_year: Record<string, number>;
  unit: string;
}

interface ComparisonRow {
  month: number;
  label: string;
  values: Record<string, MonthValues>;
}

interface ComparisonData {
  years: number[];
  energy_types: EtMeta[];
  months: { month: number; label: string }[];
  rows: ComparisonRow[];
}

/* ── Hilfsfunktionen ── */

const MONTH_NAMES = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

// Farbpalette für bis zu 8 Jahre (ältestes → neuestes)
const YEAR_PALETTE = ['#CBD5E1','#94A3B8','#60A5FA','#34D399','#FBBF24','#F472B6','#A78BFA','#FB923C'];

function yearColor(years: number[], year: number, etColor?: string): string {
  const idx = years.indexOf(year);
  // jüngstes Jahr in der Energieart-Farbe hervorheben, sonst Palette
  if (idx === years.length - 1 && etColor) return etColor;
  return YEAR_PALETTE[idx % YEAR_PALETTE.length];
}

function fmt(n: number): string {
  return n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null || delta === undefined) return <span className="text-gray-400">–</span>;
  const up = delta > 5;
  const down = delta < -5;
  const color = up ? 'text-red-600' : down ? 'text-green-600' : 'text-gray-600';
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-semibold ${color}`}>
      <Icon size={11} />
      {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

/* ── Hauptkomponente ── */

export default function MonthlyComparisonPage({ siteId }: { siteId?: string }) {
  const currentYear = new Date().getFullYear();
  const selectableYears = Array.from({ length: 9 }, (_, i) => currentYear - 7 + i); // currentYear-7 … +1

  const [mode, setMode] = useState<'years' | 'range'>('years');
  const [selectedYears, setSelectedYears] = useState<number[]>([currentYear - 1, currentYear]);
  const [fromYear, setFromYear] = useState(currentYear - 2);
  const [toYear, setToYear] = useState(currentYear);
  const [deltaMode, setDeltaMode] = useState<'previous' | 'baseline'>('previous');

  const [selectedEts, setSelectedEts] = useState<string[]>([]);
  const [data, setData] = useState<ComparisonData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEt, setActiveEt] = useState<string | null>(null);

  const buildYears = useCallback((): number[] => {
    if (mode === 'range') {
      const lo = Math.min(fromYear, toYear);
      const hi = Math.max(fromYear, toYear);
      return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).slice(0, 8);
    }
    return [...selectedYears].sort((a, b) => a - b).slice(0, 8);
  }, [mode, fromYear, toYear, selectedYears]);

  const load = useCallback(async () => {
    const ys = buildYears();
    if (ys.length === 0) { setError('Bitte mindestens ein Jahr wählen.'); return; }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ years: ys.join(',') });
      if (selectedEts.length > 0) params.set('energy_types', selectedEts.join(','));
      if (siteId) params.set('site_id', siteId);
      const res = await apiClient.get<ComparisonData>(`/api/v1/analytics/monthly-comparison?${params}`);
      setData(res.data);
      if (res.data.energy_types.length > 0 && activeEt === null) {
        setActiveEt(res.data.energy_types[0].key);
      }
    } catch {
      setError('Daten konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [buildYears, selectedEts, activeEt, siteId]);

  const toggleEt = (key: string) => {
    setSelectedEts(prev => (prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]));
  };

  const toggleYear = (y: number) => {
    setSelectedYears(prev => {
      if (prev.includes(y)) return prev.filter(v => v !== y);
      if (prev.length >= 8) return prev; // Cap
      return [...prev, y];
    });
  };

  const years = data?.years ?? [];
  const activeEtMeta = data?.energy_types.find(e => e.key === activeEt);

  // Jahressummen je Energieart
  const sumsForEt = (etKey: string): Record<number, number> => {
    const out: Record<number, number> = {};
    years.forEach(y => {
      out[y] = (data?.rows ?? []).reduce(
        (s, r) => s + (r.values[etKey]?.by_year[String(y)] ?? 0), 0,
      );
    });
    return out;
  };

  // Δ% gemäß Modus (gegen Vorjahr in der Liste / gegen Basisjahr = erstes Jahr)
  const deltaFor = (sums: Record<number, number>, y: number): number | null => {
    if (deltaMode === 'baseline') {
      const base = years[0];
      if (y === base || !sums[base]) return null;
      return ((sums[y] - sums[base]) / sums[base]) * 100;
    }
    const idx = years.indexOf(y);
    if (idx <= 0) return null;
    const prev = years[idx - 1];
    if (!sums[prev]) return null;
    return ((sums[y] - sums[prev]) / sums[prev]) * 100;
  };

  // Chartdaten für aktive Energieart
  const chartData = data && activeEt
    ? data.rows.map(row => {
        const o: Record<string, number | string> = { label: row.label };
        years.forEach(y => { o[String(y)] = row.values[activeEt]?.by_year[String(y)] ?? 0; });
        return o;
      })
    : [];

  return (
    <div className="p-6 space-y-6">
      <PageHead eyebrow="Analyse" title="Monatlicher Jahresvergleich" />
      <p style={{ marginTop: -4, fontSize: 12, color: 'var(--ink-3)' }}>
        Verbrauch mehrerer Jahre je Monat nach Energieträgern – grafisch und tabellarisch
      </p>

      {/* Filter-Panel */}
      <div className="card p-4 flex flex-wrap gap-4 items-end">
        {/* Modus-Umschalter */}
        <div>
          <label className="label">Auswahl</label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${mode === 'years' ? 'bg-[var(--ink)] text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setMode('years')}
            >Einzeljahre</button>
            <button
              className={`px-3 py-1.5 text-sm ${mode === 'range' ? 'bg-[var(--ink)] text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setMode('range')}
            >Bereich</button>
          </div>
        </div>

        {mode === 'years' ? (
          <div>
            <label className="label">Jahre (max. 8)</label>
            <div className="flex flex-wrap gap-1.5">
              {selectableYears.map(y => {
                const on = selectedYears.includes(y);
                return (
                  <button
                    key={y}
                    onClick={() => toggleYear(y)}
                    className={`px-2.5 py-1 rounded-md text-sm border transition-colors ${
                      on ? 'bg-[var(--ink)] text-white border-transparent' : 'bg-white text-gray-600 border-gray-300'
                    }`}
                  >{y}</button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div>
              <label className="label">von Jahr</label>
              <select className="input w-28" value={fromYear} onChange={e => setFromYear(Number(e.target.value))}>
                {selectableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="label">bis Jahr</label>
              <select className="input w-28" value={toYear} onChange={e => setToYear(Number(e.target.value))}>
                {selectableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </>
        )}

        {/* Δ%-Bezug */}
        <div>
          <label className="label">Δ%-Bezug</label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            <button
              className={`px-3 py-1.5 text-sm ${deltaMode === 'previous' ? 'bg-[var(--ink)] text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setDeltaMode('previous')}
            >gegen Vorjahr</button>
            <button
              className={`px-3 py-1.5 text-sm ${deltaMode === 'baseline' ? 'bg-[var(--ink)] text-white' : 'bg-white text-gray-600'}`}
              onClick={() => setDeltaMode('baseline')}
            >gegen Basisjahr</button>
          </div>
        </div>

        <button className="btn-primary flex items-center gap-2" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          Laden
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
      )}

      {data && years.length > 0 && (
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

          {/* KPI-Karten: Jahressummen je Energieart */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {data.energy_types.map(et => {
              const sums = sumsForEt(et.key);
              return (
                <div
                  key={et.key}
                  className={`card p-4 cursor-pointer transition-all ${activeEt === et.key ? '' : 'hover:shadow-md'}`}
                  style={activeEt === et.key ? { outline: `2px solid ${et.color}` } : {}}
                  onClick={() => setActiveEt(et.key)}
                >
                  <div className="text-sm font-medium text-gray-700 mb-2">{et.label} <span className="text-gray-400">({et.unit})</span></div>
                  <div className="space-y-1">
                    {years.map(y => (
                      <div key={y} className="flex items-center justify-between text-xs">
                        <span className="text-gray-500" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ width: 8, height: 8, borderRadius: 2, background: yearColor(years, y, et.color), display: 'inline-block' }} />
                          {y}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="font-medium text-gray-800">{fmt(sums[y] ?? 0)}</span>
                          <span style={{ minWidth: 56, textAlign: 'right' }}><DeltaBadge delta={deltaFor(sums, y)} /></span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chart: aktive Energieart, gruppierte Balken je Jahr */}
          {activeEt && chartData.length > 0 && (
            <div className="card p-4">
              <h2 className="text-base font-semibold text-gray-900 mb-4">
                {activeEtMeta?.label} – Monatsvergleich {years[0]}–{years[years.length - 1]}
                <span className="ml-2 text-sm text-gray-400 font-normal">({activeEtMeta?.unit})</span>
              </h2>
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0))}
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${fmt(value)} ${activeEtMeta?.unit ?? ''}`, name,
                    ]}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {years.map(y => (
                    <Bar
                      key={y}
                      dataKey={String(y)}
                      name={String(y)}
                      fill={yearColor(years, y, activeEtMeta?.color)}
                      radius={[2, 2, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Tabelle: Monate × (Energieart × Jahre) */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--ink)] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Monat</th>
                  {data.energy_types.map(et => (
                    <th key={et.key} colSpan={years.length} className="px-3 py-2 text-center font-semibold border-l border-white/20">
                      {et.label} ({et.unit})
                    </th>
                  ))}
                </tr>
                <tr className="bg-[var(--ink)] text-white text-xs">
                  <th className="px-3 py-1 text-left">&nbsp;</th>
                  {data.energy_types.map(et =>
                    years.map((y, i) => (
                      <th key={`${et.key}-${y}`} className={`px-2 py-1 text-right ${i === 0 ? 'border-l border-white/20' : ''}`}>{y}</th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, ri) => (
                  <tr key={row.month} className={ri % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium text-gray-700">{MONTH_NAMES[row.month - 1]}</td>
                    {data.energy_types.map(et =>
                      years.map((y, i) => {
                        const v = row.values[et.key]?.by_year[String(y)];
                        return (
                          <td key={`${et.key}-${y}`} className={`px-2 py-2 text-right ${i === 0 ? 'border-l border-gray-200' : ''} ${i === years.length - 1 ? 'font-medium' : 'text-gray-600'}`}>
                            {v ? fmt(v) : '–'}
                          </td>
                        );
                      }),
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-gray-800">Gesamt</td>
                  {data.energy_types.map(et => {
                    const sums = sumsForEt(et.key);
                    return years.map((y, i) => (
                      <td key={`${et.key}-sum-${y}`} className={`px-2 py-2 text-right ${i === 0 ? 'border-l border-gray-200' : ''}`}>
                        {fmt(sums[y] ?? 0)}
                      </td>
                    ));
                  })}
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
            Jahre (oder einen Bereich) auswählen und auf „Laden" klicken.
          </p>
        </div>
      )}
    </div>
  );
}

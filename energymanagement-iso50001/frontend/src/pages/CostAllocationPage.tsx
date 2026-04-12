import { useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { RefreshCw, Euro, Zap, Building2 } from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface AllocationUnit {
  usage_unit_id: string;
  usage_unit_name: string;
  code: string | null;
  area_m2: number | null;
  tenant_name: string | null;
  kwh: number;
  cost_net: number;
  cost_gross: number;
  kwh_per_m2: number | null;
  cost_per_m2: number | null;
  meter_count: number;
}

interface AllocationData {
  period_start: string;
  period_end: string;
  units: AllocationUnit[];
  grand_total_kwh: number;
  grand_total_cost_net: number;
  data_available: boolean;
}

/* ── Farbenpalette ── */
const CHART_COLORS = [
  '#1B5E7B', '#2E86AB', '#A23B72', '#F18F01', '#C73E1D',
  '#3B1F2B', '#44BBA4', '#E94F37', '#393E41', '#84A98C',
];

/* ── Hilfsfunktionen ── */

function fmt(value: number, digits = 1): string {
  return value.toLocaleString('de-DE', { maximumFractionDigits: digits });
}

function fmtEur(value: number): string {
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

/* ── Hauptkomponente ── */

export default function CostAllocationPage() {
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`);
  const [data, setData] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'cost' | 'kwh'>('cost');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const res = await apiClient.get<AllocationData>(
        `/api/v1/analytics/cost-allocation?${params}`
      );
      setData(res.data);
    } catch {
      setError('Kostenumlage konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const chartData = data?.units.map((u, i) => ({
    name: u.code ?? u.usage_unit_name.slice(0, 20),
    fullName: u.usage_unit_name,
    value: view === 'cost' ? u.cost_net : u.kwh,
    color: CHART_COLORS[i % CHART_COLORS.length],
  })) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="page-title">Kostenumlage</h1>
        <p className="text-sm text-gray-500 mt-1">
          Anteilige Energie- und Kostenverteilung auf Nutzungseinheiten (basierend auf Zähler-Zuordnungen)
        </p>
      </div>

      {/* Filter */}
      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Von</label>
          <input
            type="date"
            className="input w-40"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Bis</label>
          <input
            type="date"
            className="input w-40"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
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

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-4 text-red-700">{error}</div>
      )}

      {data && (
        <>
          {!data.data_available && (
            <div className="card p-8 text-center text-gray-400">
              <Building2 size={40} className="mx-auto mb-3 opacity-30" />
              <p className="font-medium">Keine Zuordnungsdaten vorhanden</p>
              <p className="text-sm mt-1">
                Zähler müssen Nutzungseinheiten zugeordnet sein und Ablesungen mit Kostendaten enthalten.
              </p>
            </div>
          )}

          {data.data_available && (
            <>
              {/* KPI-Karten */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                    <Euro size={16} />
                    Gesamtkosten (netto)
                  </div>
                  <p className="text-2xl font-bold text-[#1B5E7B]">
                    {fmtEur(data.grand_total_cost_net)}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {data.period_start} – {data.period_end}
                  </p>
                </div>
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                    <Zap size={16} />
                    Gesamtverbrauch
                  </div>
                  <p className="text-2xl font-bold text-gray-800">
                    {fmt(data.grand_total_kwh)} kWh
                  </p>
                </div>
                <div className="card p-4">
                  <div className="flex items-center gap-2 text-gray-500 text-sm mb-1">
                    <Building2 size={16} />
                    Nutzungseinheiten
                  </div>
                  <p className="text-2xl font-bold text-gray-800">{data.units.length}</p>
                </div>
              </div>

              {/* Chart */}
              <div className="card p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-gray-900">
                    Verteilung nach Nutzungseinheit
                  </h2>
                  <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                    <button
                      className={`px-3 py-1 transition-colors ${
                        view === 'cost'
                          ? 'bg-[#1B5E7B] text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => setView('cost')}
                    >
                      Kosten €
                    </button>
                    <button
                      className={`px-3 py-1 transition-colors ${
                        view === 'kwh'
                          ? 'bg-[#1B5E7B] text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                      onClick={() => setView('kwh')}
                    >
                      Verbrauch kWh
                    </button>
                  </div>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11 }}
                      angle={-40}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v: number) =>
                        view === 'cost'
                          ? `${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)} €`
                          : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)
                      }
                    />
                    <Tooltip
                      formatter={(value: number) =>
                        view === 'cost'
                          ? [fmtEur(value), 'Kosten netto']
                          : [`${fmt(value)} kWh`, 'Verbrauch']
                      }
                      labelFormatter={(label: string) => {
                        const unit = chartData.find(d => d.name === label);
                        return unit?.fullName ?? label;
                      }}
                    />
                    <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Tabelle */}
              <div className="card overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#1B5E7B] text-white">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Nutzungseinheit</th>
                      <th className="px-3 py-2 text-left font-semibold">Code</th>
                      <th className="px-3 py-2 text-left font-semibold">Mieter</th>
                      <th className="px-3 py-2 text-right font-semibold">Fläche m²</th>
                      <th className="px-3 py-2 text-right font-semibold">Verbrauch kWh</th>
                      <th className="px-3 py-2 text-right font-semibold">kWh/m²</th>
                      <th className="px-3 py-2 text-right font-semibold">Kosten netto €</th>
                      <th className="px-3 py-2 text-right font-semibold">€/m²</th>
                      <th className="px-3 py-2 text-right font-semibold">Zähler</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.units.map((u, i) => (
                      <tr key={u.usage_unit_id} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-3 py-2 font-medium text-gray-800">{u.usage_unit_name}</td>
                        <td className="px-3 py-2 text-gray-500">{u.code ?? '–'}</td>
                        <td className="px-3 py-2 text-gray-600">{u.tenant_name ?? '–'}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {u.area_m2 != null ? fmt(u.area_m2, 0) : '–'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium">{fmt(u.kwh)}</td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {u.kwh_per_m2 != null ? fmt(u.kwh_per_m2) : '–'}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-[#1B5E7B]">
                          {fmtEur(u.cost_net)}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-600">
                          {u.cost_per_m2 != null ? `${fmt(u.cost_per_m2)} €` : '–'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-400">{u.meter_count}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-gray-800" colSpan={4}>Gesamt</td>
                      <td className="px-3 py-2 text-right">{fmt(data.grand_total_kwh)}</td>
                      <td className="px-3 py-2 text-right">–</td>
                      <td className="px-3 py-2 text-right text-[#1B5E7B]">
                        {fmtEur(data.grand_total_cost_net)}
                      </td>
                      <td className="px-3 py-2 text-right">–</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {!data && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <Euro size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Kostenumlage laden</p>
          <p className="text-sm mt-1">
            Zeitraum wählen und „Laden" klicken, um die Kostenverteilung anzuzeigen.
          </p>
        </div>
      )}
    </div>
  );
}

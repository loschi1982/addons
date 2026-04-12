import { useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { RefreshCw, Download, BarChart3 } from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface EtMeta {
  key: string;
  label: string;
  unit: string;
  color: string;
}

interface RowValues {
  native: number;
  kwh: number;
  cost_net: number;
}

interface BalanceRow {
  month: string;
  label: string;
  values: Record<string, RowValues>;
  total_kwh: number;
  total_cost_net: number;
}

interface BalanceData {
  period_start: string;
  period_end: string;
  energy_types: EtMeta[];
  rows: BalanceRow[];
  totals: Record<string, { native: number; kwh: number; cost_net: number }>;
  grand_total_kwh: number;
  grand_total_cost_net: number;
}

/* ── CSV-Export ── */

function exportCsv(data: BalanceData) {
  const headers = ['Monat', ...data.energy_types.flatMap(et => [
    `${et.label} (${et.unit})`,
    `${et.label} (kWh-Äquiv.)`,
    `${et.label} (€ netto)`,
  ]), 'Gesamt kWh', 'Gesamt € netto'];

  const rows = data.rows.map(row => [
    row.label,
    ...data.energy_types.flatMap(et => {
      const v = row.values[et.key] ?? { native: 0, kwh: 0, cost_net: 0 };
      return [
        v.native.toFixed(2),
        v.kwh.toFixed(2),
        v.cost_net.toFixed(2),
      ];
    }),
    row.total_kwh.toFixed(2),
    row.total_cost_net.toFixed(2),
  ]);

  const totalRow = [
    'Gesamt',
    ...data.energy_types.flatMap(et => {
      const t = data.totals[et.key] ?? { native: 0, kwh: 0, cost_net: 0 };
      return [t.native.toFixed(2), t.kwh.toFixed(2), t.cost_net.toFixed(2)];
    }),
    data.grand_total_kwh.toFixed(2),
    data.grand_total_cost_net.toFixed(2),
  ];

  const csv = [headers, ...rows, totalRow]
    .map(r => r.map(c => `"${c}"`).join(';'))
    .join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `energiebilanz_${data.period_start}_${data.period_end}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Hauptkomponente ── */

export default function EnergyBalancePage() {
  const today = new Date();
  const firstOfYear = `${today.getFullYear()}-01-01`;
  const todayStr = today.toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(firstOfYear);
  const [endDate, setEndDate] = useState(todayStr);
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartView, setChartView] = useState<'kwh' | 'cost'>('kwh');

  const load = useCallback(async () => {
    if (!startDate || !endDate) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const res = await apiClient.get<BalanceData>(
        `/api/v1/analytics/energy-balance?${params}`
      );
      setData(res.data);
    } catch {
      setError('Energiebilanz konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  // Chart-Daten aufbereiten
  const chartData = data
    ? data.rows.map(row => {
        const entry: Record<string, number | string> = { label: row.label };
        data.energy_types.forEach(et => {
          const v = row.values[et.key];
          entry[et.key] = chartView === 'kwh' ? (v?.kwh ?? 0) : (v?.cost_net ?? 0);
        });
        return entry;
      })
    : [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Energiebilanz</h1>
          <p className="text-sm text-gray-500 mt-1">
            Verbrauchsstatistik nach Energieträgern – monatlich aufgeschlüsselt
          </p>
        </div>
        {data && (
          <button
            className="btn-secondary flex items-center gap-2"
            onClick={() => exportCsv(data)}
          >
            <Download size={16} />
            CSV-Export
          </button>
        )}
      </div>

      {/* Filter */}
      <div className="card p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="label">Von</label>
          <input
            type="date"
            className="input"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Bis</label>
          <input
            type="date"
            className="input"
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
          {/* KPI-Karten */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {data.energy_types.map(et => {
              const t = data.totals[et.key] ?? { native: 0, kwh: 0, cost_net: 0 };
              return (
                <div key={et.key} className="card p-4">
                  <div
                    className="text-xs font-semibold uppercase tracking-wide mb-1"
                    style={{ color: et.color }}
                  >
                    {et.label}
                  </div>
                  <div className="text-2xl font-bold text-gray-900">
                    {t.native.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
                  </div>
                  <div className="text-xs text-gray-500">{et.unit}</div>
                  {t.cost_net > 0 && (
                    <div className="text-sm text-gray-600 mt-1">
                      {t.cost_net.toLocaleString('de-DE', {
                        style: 'currency',
                        currency: 'EUR',
                        maximumFractionDigits: 0,
                      })}{' '}
                      netto
                    </div>
                  )}
                </div>
              );
            })}
            <div className="card p-4 bg-[#1B5E7B] text-white">
              <div className="text-xs font-semibold uppercase tracking-wide mb-1 opacity-80">
                Gesamt kWh-Äquiv.
              </div>
              <div className="text-2xl font-bold">
                {data.grand_total_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
              </div>
              <div className="text-xs opacity-70">kWh</div>
              {data.grand_total_cost_net > 0 && (
                <div className="text-sm mt-1 opacity-90">
                  {data.grand_total_cost_net.toLocaleString('de-DE', {
                    style: 'currency',
                    currency: 'EUR',
                    maximumFractionDigits: 0,
                  })}{' '}
                  netto
                </div>
              )}
            </div>
          </div>

          {/* Chart */}
          {data.rows.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-semibold text-gray-900">Monatlicher Verlauf</h2>
                <div className="flex gap-2">
                  <button
                    className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                      chartView === 'kwh'
                        ? 'bg-[#1B5E7B] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setChartView('kwh')}
                  >
                    kWh
                  </button>
                  <button
                    className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                      chartView === 'cost'
                        ? 'bg-[#1B5E7B] text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                    onClick={() => setChartView('cost')}
                  >
                    Kosten (€)
                  </button>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: number) =>
                      v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)
                    }
                  />
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const et = data.energy_types.find(e => e.key === name);
                      if (chartView === 'cost') {
                        return [
                          `${value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}`,
                          et?.label ?? name,
                        ];
                      }
                      return [
                        `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} kWh`,
                        et?.label ?? name,
                      ];
                    }}
                  />
                  {data.energy_types.map(et => (
                    <Bar
                      key={et.key}
                      dataKey={et.key}
                      stackId="stack"
                      fill={et.color}
                      name={et.label}
                      radius={[0, 0, 0, 0]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              {/* Legende */}
              <div className="flex flex-wrap gap-4 mt-3 justify-center">
                {data.energy_types.map(et => (
                  <span key={et.key} className="flex items-center gap-1 text-xs text-gray-600">
                    <span
                      className="inline-block w-3 h-3 rounded-sm"
                      style={{ backgroundColor: et.color }}
                    />
                    {et.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Tabelle */}
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1B5E7B] text-white">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Monat</th>
                  {data.energy_types.map(et => (
                    <th
                      key={et.key}
                      colSpan={et.unit !== 'kWh' ? 2 : 1}
                      className="px-3 py-2 text-center font-semibold"
                    >
                      {et.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Gesamt kWh</th>
                  <th className="px-3 py-2 text-right font-semibold">Kosten netto</th>
                </tr>
                <tr className="bg-[#155068] text-white text-xs">
                  <th className="px-3 py-1 text-left">&nbsp;</th>
                  {data.energy_types.map(et => (
                    <>
                      <th key={`${et.key}-nat`} className="px-2 py-1 text-right">{et.unit}</th>
                      {et.unit !== 'kWh' && (
                        <th key={`${et.key}-kwh`} className="px-2 py-1 text-right">kWh</th>
                      )}
                    </>
                  ))}
                  <th className="px-2 py-1 text-right">kWh</th>
                  <th className="px-2 py-1 text-right">€</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <tr key={row.month} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-3 py-2 font-medium text-gray-700">{row.label}</td>
                    {data.energy_types.map(et => {
                      const v = row.values[et.key] ?? { native: 0, kwh: 0, cost_net: 0 };
                      return (
                        <>
                          <td key={`${et.key}-n`} className="px-2 py-2 text-right text-gray-800">
                            {v.native > 0
                              ? v.native.toLocaleString('de-DE', { maximumFractionDigits: 1 })
                              : '–'}
                          </td>
                          {et.unit !== 'kWh' && (
                            <td key={`${et.key}-k`} className="px-2 py-2 text-right text-gray-500 text-xs">
                              {v.kwh > 0
                                ? v.kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })
                                : '–'}
                            </td>
                          )}
                        </>
                      );
                    })}
                    <td className="px-2 py-2 text-right font-medium text-gray-800">
                      {row.total_kwh > 0
                        ? row.total_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })
                        : '–'}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-600">
                      {row.total_cost_net > 0
                        ? row.total_cost_net.toLocaleString('de-DE', {
                            style: 'currency',
                            currency: 'EUR',
                            maximumFractionDigits: 0,
                          })
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-100 font-semibold border-t-2 border-[#1B5E7B]">
                <tr>
                  <td className="px-3 py-2 text-gray-800">Gesamt</td>
                  {data.energy_types.map(et => {
                    const t = data.totals[et.key] ?? { native: 0, kwh: 0, cost_net: 0 };
                    return (
                      <>
                        <td key={`${et.key}-tn`} className="px-2 py-2 text-right" style={{ color: et.color }}>
                          {t.native.toLocaleString('de-DE', { maximumFractionDigits: 1 })}
                        </td>
                        {et.unit !== 'kWh' && (
                          <td key={`${et.key}-tk`} className="px-2 py-2 text-right text-gray-600 text-xs">
                            {t.kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                          </td>
                        )}
                      </>
                    );
                  })}
                  <td className="px-2 py-2 text-right text-[#1B5E7B]">
                    {data.grand_total_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="px-2 py-2 text-right text-[#1B5E7B]">
                    {data.grand_total_cost_net > 0
                      ? data.grand_total_cost_net.toLocaleString('de-DE', {
                          style: 'currency',
                          currency: 'EUR',
                          maximumFractionDigits: 0,
                        })
                      : '–'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {!data && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Energiebilanz laden</p>
          <p className="text-sm mt-1">
            Zeitraum auswählen und auf „Laden" klicken.
          </p>
        </div>
      )}
    </div>
  );
}

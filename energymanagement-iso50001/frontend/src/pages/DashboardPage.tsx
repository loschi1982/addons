import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Activity,
  Zap, Leaf, Euro, Gauge, Sun, BatteryCharging,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import InfoTip from '@/components/ui/InfoTip';
import { ENERGY_TYPE_LABELS, ENERGY_TYPE_COLORS } from '@/types';

/* ── Typen ── */

interface KPICard {
  label: string;
  value: number;
  unit: string;
  trend_percent: number | null;
  trend_direction: string | null;
  comparison_value: number | null;
  comparison_label: string | null;
}

interface EnergyBreakdown {
  energy_type: string;
  consumption_kwh: number;
  original_value?: number;
  original_unit?: string;
  share_percent: number;
}

interface TimeSeriesPoint {
  label: string;
  value: number;
}

interface ConsumptionChart {
  meter_id: string;
  meter_name: string;
  energy_type: string;
  unit: string;
  data: TimeSeriesPoint[];
}

interface TopConsumer {
  meter_id: string;
  name: string;
  energy_type: string;
  consumption_kwh: number;
}

interface Alert {
  type: string;
  severity: string;
  message: string;
  meter_id: string;
}

interface DashboardData {
  period_start: string;
  period_end: string;
  kpi_cards: KPICard[];
  energy_breakdown: EnergyBreakdown[];
  consumption_chart: ConsumptionChart[];
  top_consumers: TopConsumer[];
  enpi_overview: Record<string, unknown>[];
  alerts: Alert[];
}

/* ── Hilfsfunktionen ── */

function formatNumber(value: unknown, decimals = 1): string {
  const num = Number(value) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)} Mio.`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)} k`;
  return num.toFixed(decimals);
}

const KPI_ICONS: Record<string, React.ElementType> = {
  'Gesamtverbrauch': Zap,
  'CO₂-Emissionen': Leaf,
  'Energiekosten': Euro,
  'Aktive Zähler': Gauge,
  'Eigenproduktion': Sun,
  'Autarkiegrad': BatteryCharging,
};

const KPI_INFO: Record<string, { formula: string; text: string }> = {
  'Gesamtverbrauch': {
    formula: 'Σ Zählerstand × Umrechnungsfaktor',
    text: 'Summe aller aktiven Hauptzähler, umgerechnet in kWh (m³×10.3, l×9.8, kg×4.8, MWh×1000).',
  },
  'CO₂-Emissionen': {
    formula: 'Σ (Verbrauch_kWh × Faktor_g/kWh) ÷ 1000',
    text: 'Emissionsfaktor je Energieträger und Jahr (Quelle: BAFA/UBA). Ergebnis in kg CO₂.',
  },
  'Energiekosten': {
    formula: 'Σ (Verbrauch_kWh × Tarif_€/kWh)',
    text: 'Tarif aus Zähler-Einstellung (Fixpreis) oder effektiver Preis aus Abrechnungsdaten.',
  },
  'Eigenproduktion': {
    formula: 'Σ Einspeisezähler im Zeitraum',
    text: 'Summe aller Zähler mit Einspeise-Kennzeichnung (z.B. PV-Anlage).',
  },
  'Autarkiegrad': {
    formula: 'Eigenproduktion ÷ (Eigen + Netzbezug) × 100',
    text: 'Anteil selbst erzeugter Energie am Gesamtverbrauch in Prozent.',
  },
};

const PIE_COLORS = [
  '#1B5E7B', '#F59E0B', '#3B82F6', '#10B981',
  '#8B5CF6', '#F97316', '#EC4899', '#84CC16',
];

/* ── Komponenten ── */

function KPICardComponent({ card }: { card: KPICard }) {
  const Icon = KPI_ICONS[card.label] || Activity;
  // Für Eigenproduktion/Autarkiegrad: Anstieg ist positiv (grün)
  const invertTrend = card.label === 'Eigenproduktion' || card.label === 'Autarkiegrad';
  const trendColor = invertTrend
    ? (card.trend_direction === 'up' ? 'text-green-600' : card.trend_direction === 'down' ? 'text-red-500' : 'text-gray-400')
    : (card.trend_direction === 'down' ? 'text-green-600' : card.trend_direction === 'up' ? 'text-red-500' : 'text-gray-400');
  const TrendIcon = card.trend_direction === 'up' ? TrendingUp : card.trend_direction === 'down' ? TrendingDown : Minus;

  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {card.label}
            {KPI_INFO[card.label] && (
              <InfoTip title={card.label} formula={KPI_INFO[card.label].formula}>
                {KPI_INFO[card.label].text}
              </InfoTip>
            )}
          </p>
          <p className="mt-1 text-2xl font-bold text-gray-900">
            {formatNumber(card.value)}
            <span className="ml-1 text-sm font-normal text-gray-500">{card.unit}</span>
          </p>
        </div>
        <div className="rounded-lg bg-primary-50 p-2">
          <Icon className="h-5 w-5 text-primary-600" />
        </div>
      </div>
      {card.trend_percent !== null && (
        <div className="mt-3 flex items-center gap-1.5">
          <TrendIcon className={`h-4 w-4 ${trendColor}`} />
          <span className={`text-sm font-medium ${trendColor}`}>
            {(Math.abs(Number(card.trend_percent) || 0)).toFixed(1)}%
          </span>
          {card.comparison_label && (
            <span className="text-xs text-gray-400">vs. {card.comparison_label}</span>
          )}
        </div>
      )}
    </div>
  );
}

function AlertBanner({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <h3 className="font-medium text-amber-800">
          {alerts.length} Warnung{alerts.length > 1 ? 'en' : ''}
        </h3>
      </div>
      <ul className="space-y-1">
        {alerts.slice(0, 5).map((a, i) => (
          <li key={i} className="text-sm text-amber-700">• {a.message}</li>
        ))}
      </ul>
    </div>
  );
}

/* ── Hauptseite ── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [granularity, setGranularity] = useState('monthly');

  useEffect(() => {
    fetchDashboard();
  }, [granularity]);

  const fetchDashboard = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/v1/dashboard', {
        params: { granularity },
      });
      setData(res.data);
      setError('');
    } catch {
      setError('Dashboard-Daten konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <p className="text-red-600">{error || 'Keine Daten verfügbar'}</p>
        <button onClick={fetchDashboard} className="btn-primary mt-3">
          Erneut laden
        </button>
      </div>
    );
  }

  // Daten für kombinierten Chart vorbereiten
  const chartLabels: string[] = [];
  const combinedData: Record<string, number>[] = [];
  if (data.consumption_chart.length > 0) {
    const firstSeries = data.consumption_chart[0];
    firstSeries.data.forEach((dp, idx) => {
      const row: Record<string, number> = {};
      data.consumption_chart.forEach((s) => {
        if (s.data[idx]) {
          row[s.meter_name] = s.data[idx].value;
        }
      });
      chartLabels.push(dp.label);
      combinedData.push(row);
    });
  }

  const barChartData = combinedData.map((row, idx) => ({
    label: chartLabels[idx],
    ...row,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data.period_start} bis {data.period_end}
          </p>
        </div>
        <select
          value={granularity}
          onChange={(e) => setGranularity(e.target.value)}
          className="input w-auto"
        >
          <option value="daily">Täglich</option>
          <option value="weekly">Wöchentlich</option>
          <option value="monthly">Monatlich</option>
          <option value="yearly">Jährlich</option>
        </select>
      </div>

      {/* Warnungen */}
      {data.alerts.length > 0 && (
        <div className="mt-4">
          <AlertBanner alerts={data.alerts} />
        </div>
      )}

      {/* KPI-Karten */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.kpi_cards.map((card) => (
          <KPICardComponent key={card.label} card={card} />
        ))}
      </div>

      {/* Charts-Bereich */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Verbrauchschart */}
        <div className="card lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Verbrauchsentwicklung</h2>
          {barChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={barChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => [`${formatNumber(value)} kWh`, '']}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <Legend />
                {data.consumption_chart.map((series, idx) => (
                  <Bar
                    key={series.meter_id}
                    dataKey={series.meter_name}
                    fill={PIE_COLORS[idx % PIE_COLORS.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-64 items-center justify-center text-gray-400">
              Keine Verbrauchsdaten vorhanden
            </div>
          )}
        </div>

        {/* Energieaufteilung */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Energieaufteilung</h2>
          {data.energy_breakdown.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={data.energy_breakdown}
                    dataKey="consumption_kwh"
                    nameKey="energy_type"
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {data.energy_breakdown.map((entry, idx) => (
                      <Cell
                        key={entry.energy_type}
                        fill={
                          ENERGY_TYPE_COLORS[entry.energy_type as keyof typeof ENERGY_TYPE_COLORS]
                          || PIE_COLORS[idx % PIE_COLORS.length]
                        }
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => {
                      const entry = data.energy_breakdown.find(b => b.energy_type === name);
                      const label = ENERGY_TYPE_LABELS[name as keyof typeof ENERGY_TYPE_LABELS] || name;
                      if (entry?.original_unit && entry.original_unit !== 'kWh') {
                        return [`${formatNumber(entry.original_value)} ${entry.original_unit} (${formatNumber(value)} kWh)`, label];
                      }
                      return [`${formatNumber(value)} kWh`, label];
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-2">
                {data.energy_breakdown.map((b, idx) => (
                  <div key={b.energy_type} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-full"
                        style={{
                          backgroundColor:
                            ENERGY_TYPE_COLORS[b.energy_type as keyof typeof ENERGY_TYPE_COLORS]
                            || PIE_COLORS[idx % PIE_COLORS.length],
                        }}
                      />
                      <span className="text-gray-600">
                        {ENERGY_TYPE_LABELS[b.energy_type as keyof typeof ENERGY_TYPE_LABELS] || b.energy_type}
                      </span>
                    </div>
                    <span className="font-medium text-gray-900">
                      {b.original_unit && b.original_unit !== 'kWh'
                        ? `${formatNumber(b.original_value)} ${b.original_unit} · `
                        : ''
                      }
                      {(Number(b.share_percent) || 0).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex h-64 items-center justify-center text-gray-400">
              Keine Daten vorhanden
            </div>
          )}
        </div>
      </div>

      {/* Untere Reihe: Top-Verbraucher + EnPI */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top-5 Verbraucher */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Top-5 Verbraucher</h2>
          {data.top_consumers.length > 0 ? (
            <div className="space-y-3">
              {data.top_consumers.map((tc) => {
                const maxConsumption = data.top_consumers[0]?.consumption_kwh || 1;
                const pct = (tc.consumption_kwh / maxConsumption) * 100;
                return (
                  <div key={tc.meter_id}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-gray-700">{tc.name}</span>
                      <span className="text-gray-500">{formatNumber(tc.consumption_kwh)} kWh</span>
                    </div>
                    <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-primary-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-gray-400">Keine Verbrauchsdaten vorhanden</p>
          )}
        </div>

        {/* EnPI-Übersicht */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Energiekennzahlen (EnPI)</h2>
          {data.enpi_overview.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Zähler</th>
                    <th className="pb-2 font-medium">Typ</th>
                    <th className="pb-2 font-medium text-right">Verbrauch</th>
                    <th className="pb-2 font-medium text-center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.enpi_overview.map((enpi: Record<string, unknown>, idx: number) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 font-medium text-gray-700">
                        {enpi.meter_name as string}
                      </td>
                      <td className="py-2 text-gray-500">
                        {ENERGY_TYPE_LABELS[(enpi.energy_type as string) as keyof typeof ENERGY_TYPE_LABELS] || (enpi.energy_type as string)}
                      </td>
                      <td className="py-2 text-right text-gray-700">
                        {formatNumber(enpi.enpi_value as number)} {enpi.enpi_unit as string}
                      </td>
                      <td className="py-2 text-center">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            enpi.status === 'on_track'
                              ? 'bg-green-100 text-green-700'
                              : enpi.status === 'at_risk'
                              ? 'bg-amber-100 text-amber-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {enpi.status === 'on_track' ? 'Auf Kurs' : enpi.status === 'at_risk' ? 'Gefährdet' : 'Abweichung'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-center text-gray-400">Keine EnPI-Daten vorhanden</p>
          )}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Activity,
  Zap, Leaf, Euro, Gauge, Sun, BatteryCharging,
  Flame, Thermometer, Droplets, Snowflake, Fuel,
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

interface TopConsumerMeter {
  meter_id: string;
  name: string;
  energy_type: string;
  consumption: number;
  unit: string;
  consumption_kwh: number;
}

interface TopConsumerGroup {
  energy_type: string;
  energy_type_label: string;
  meters: TopConsumerMeter[];
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
  top_consumers: TopConsumerGroup[];
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
  'Strom': Zap,
  'Gas': Flame,
  'Fernwärme': Thermometer,
  'Wasser': Droplets,
  'Kälte': Snowflake,
  'Öl': Fuel,
  'Pellets': Flame,
  'Solar': Sun,
  'CO₂-Emissionen': Leaf,
  'Energiekosten': Euro,
  'Aktive Zähler': Gauge,
  'Eigenproduktion': Sun,
  'Autarkiegrad': BatteryCharging,
};

const KPI_INFO: Record<string, { formula: string; text: string }> = {
  'Strom': {
    formula: 'Σ Zählerstand (kWh)',
    text: 'Summe aller aktiven Stromzähler im gewählten Zeitraum.',
  },
  'Gas': {
    formula: 'Σ Zählerstand (m³)',
    text: 'Summe aller aktiven Gaszähler in Kubikmeter.',
  },
  'Fernwärme': {
    formula: 'Σ Zählerstand (kWh)',
    text: 'Summe aller aktiven Fernwärmezähler im gewählten Zeitraum.',
  },
  'Wasser': {
    formula: 'Σ Zählerstand (m³)',
    text: 'Summe aller aktiven Wasserzähler in Kubikmeter.',
  },
  'Kälte': {
    formula: 'Σ Zählerstand (kWh)',
    text: 'Summe aller aktiven Kältezähler im gewählten Zeitraum.',
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

/* ── Jahresvergleich-Mini-Chart ── */

interface YearComparisonPoint {
  label: string;
  [year: string]: number | string;
}

// Farben für die 5 Jahre: ältestes hellgrau → aktuelles Petrol
const YEAR_COLORS = ['#CBD5E1', '#94A3B8', '#64748B', '#334155', '#1B5E7B'];
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

function YearComparisonCard({ energyType, siteId }: { energyType: string; siteId: string }) {
  const [data, setData] = useState<YearComparisonPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 4, thisYear - 3, thisYear - 2, thisYear - 1, thisYear];

  useEffect(() => {
    setLoading(true);
    Promise.all(years.map(y =>
      apiClient.get('/api/v1/analytics/comparison', {
        params: {
          period1_start: `${y}-01-01`,
          period1_end: `${y}-12-31`,
          period2_start: `${y}-01-01`,
          period2_end: `${y}-12-31`,
          granularity: 'monthly',
          energy_type: energyType,
          ...(siteId ? { site_id: siteId } : {}),
        },
      }).then(res => {
        const p1 = (res.data.period1 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
        const agg = new Array(12).fill(0);
        if (p1) {
          for (const series of Object.values(p1)) {
            series.forEach((pt, i) => { if (i < 12) agg[i] += pt.value || 0; });
          }
        }
        return { year: y, agg };
      }).catch(() => ({ year: y, agg: new Array(12).fill(0) }))
    )).then(results => {
      const points: YearComparisonPoint[] = MONTHS.map((m, i) => {
        const row: YearComparisonPoint = { label: m };
        results.forEach(({ year, agg }) => { row[String(year)] = agg[i]; });
        return row;
      });
      setData(points);
    }).finally(() => setLoading(false));
  }, [energyType, siteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const label = ENERGY_TYPE_LABELS[energyType as keyof typeof ENERGY_TYPE_LABELS] || energyType;
  const hasData = data.some(d => years.some(y => (d[String(y)] as number) > 0));

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Jahresvergleich {label}
        <span className="ml-2 text-sm font-normal text-gray-400">{years[0]}–{thisYear}</span>
      </h2>
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      ) : hasData ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} barCategoryGap="20%" barGap={2}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => [`${formatNumber(value)} kWh`, '']} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {years.map((y, idx) => (
              <Bar key={y} dataKey={String(y)} name={String(y)} fill={YEAR_COLORS[idx]} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex h-48 items-center justify-center text-sm text-gray-400">
          Nicht genug Daten für Jahresvergleich
        </div>
      )}
    </div>
  );
}

/* ── Automatische Zusammenfassung ── */

function InsightsSummary({ data }: { data: DashboardData }) {
  const insights: { text: string; type: 'positive' | 'negative' | 'neutral' }[] = [];

  // Verbrauchstrend je Energietyp analysieren
  const knownAggregates = ['CO₂-Emissionen', 'Energiekosten', 'Aktive Zähler', 'Eigenproduktion', 'Autarkiegrad'];
  const energyCards = data.kpi_cards.filter((c) => !knownAggregates.includes(c.label));
  for (const card of energyCards) {
    if (card.trend_percent != null) {
      const pct = Math.abs(Number(card.trend_percent)).toFixed(1);
      if (Number(card.trend_percent) < -3) {
        insights.push({ text: `${card.label}-Verbrauch ist ${pct}% niedriger als im Vorjahr.`, type: 'positive' });
      } else if (Number(card.trend_percent) > 5) {
        insights.push({ text: `${card.label}-Verbrauch ist ${pct}% höher als im Vorjahr – prüfen Sie die Ursachen.`, type: 'negative' });
      }
    }
  }

  // CO₂-Trend
  const co2 = data.kpi_cards.find((c) => c.label === 'CO₂-Emissionen');
  if (co2?.trend_percent != null && Number(co2.trend_percent) < -5) {
    insights.push({ text: `CO₂-Emissionen um ${Math.abs(Number(co2.trend_percent)).toFixed(1)}% reduziert.`, type: 'positive' });
  } else if (co2?.trend_percent != null && Number(co2.trend_percent) > 5) {
    insights.push({ text: `CO₂-Emissionen um ${Math.abs(Number(co2.trend_percent)).toFixed(1)}% gestiegen.`, type: 'negative' });
  }

  // Kosten-Trend
  const cost = data.kpi_cards.find((c) => c.label === 'Energiekosten');
  if (cost?.trend_percent != null && Number(cost.trend_percent) > 5) {
    insights.push({ text: `Energiekosten sind ${Math.abs(Number(cost.trend_percent)).toFixed(1)}% höher als im Vorjahr.`, type: 'negative' });
  }

  // Top-Verbraucher Hinweis (je Energietyp)
  for (const group of data.top_consumers) {
    if (group.meters.length >= 2) {
      const top = group.meters[0];
      const totalTop = group.meters.reduce((s, m) => s + m.consumption, 0);
      const topShare = totalTop > 0 ? ((top.consumption / totalTop) * 100).toFixed(0) : 0;
      if (Number(topShare) > 50) {
        insights.push({ text: `"${top.name}" macht ${topShare}% des ${group.energy_type_label}-Verbrauchs aus – Optimierungspotenzial prüfen.`, type: 'neutral' });
      }
    }
  }

  // Warnungen
  if (data.alerts.length > 0) {
    insights.push({ text: `${data.alerts.length} Zähler haben seit über 7 Tagen keine Daten geliefert.`, type: 'negative' });
  }

  if (insights.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-primary-100 bg-primary-50/50 p-4">
      <h2 className="text-sm font-semibold text-primary-800 mb-2">Zusammenfassung</h2>
      <ul className="space-y-1">
        {insights.map((ins, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={`mt-0.5 h-2 w-2 flex-shrink-0 rounded-full ${
              ins.type === 'positive' ? 'bg-green-500' : ins.type === 'negative' ? 'bg-red-400' : 'bg-gray-400'
            }`} />
            <span className="text-gray-700">{ins.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── EnPI-Karte mit echten Kennzahlen ── */

interface RealEnPI {
  id: string;
  name: string;
  formula_type: string;
  unit: string;
  latest_value: number | null;
  target_value: number | null;
  target_direction: string;
}

function EnPIOverviewCard() {
  const [enpis, setEnpis] = useState<RealEnPI[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient.get('/api/v1/energy-review/enpi')
      .then((res) => setEnpis((res.data.items || []).filter((e: RealEnPI) => e.latest_value != null)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const getStatus = (enpi: RealEnPI): { label: string; color: string } => {
    if (enpi.target_value == null || enpi.latest_value == null) return { label: 'Kein Ziel', color: 'bg-gray-100 text-gray-500' };
    const better = enpi.target_direction === 'lower'
      ? enpi.latest_value <= enpi.target_value
      : enpi.latest_value >= enpi.target_value;
    return better
      ? { label: 'Ziel erreicht', color: 'bg-green-100 text-green-700' }
      : { label: 'Ziel verfehlt', color: 'bg-red-100 text-red-700' };
  };

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Energiekennzahlen (EnPI)
        <InfoTip title="EnPI" formula="Verbrauch_kWh ÷ Bezugsgröße">
          Echte Energieleistungskennzahlen, z.B. kWh/m² oder kWh/Stück. Misst die Effizienz bezogen auf eine relevante Variable.
        </InfoTip>
      </h2>
      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      ) : enpis.length > 0 ? (
        <div className="space-y-3">
          {enpis.slice(0, 6).map((enpi) => {
            const status = getStatus(enpi);
            return (
              <div key={enpi.id} className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-700 truncate">{enpi.name}</p>
                  <p className="text-xs text-gray-400">
                    {enpi.target_value != null ? `Ziel: ${Number(enpi.target_value).toFixed(2)} ${enpi.unit}` : enpi.unit}
                  </p>
                </div>
                <div className="flex items-center gap-3 ml-3">
                  <span className="text-lg font-bold text-gray-900">
                    {Number(enpi.latest_value).toFixed(2)}
                  </span>
                  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${status.color}`}>
                    {status.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-center text-sm text-gray-400 py-4">
          Noch keine EnPIs definiert. Erstellen Sie Kennzahlen unter Energiebewertung → EnPI.
        </p>
      )}
    </div>
  );
}

interface Site {
  id: string;
  name: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

/* ── Hauptseite ── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [granularity, setGranularity] = useState('monthly');
  const [periodStart, setPeriodStart] = useState(yearStart());
  const [periodEnd, setPeriodEnd] = useState(today());
  const [selectedSite, setSelectedSite] = useState('');
  const [sites, setSites] = useState<Site[]>([]);

  // Standorte einmalig laden
  useEffect(() => {
    apiClient.get('/api/v1/sites', { params: { page_size: 100 } })
      .then(res => setSites(res.data.items || []))
      .catch(() => {});
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        granularity,
        period_start: periodStart,
        period_end: periodEnd,
      };
      if (selectedSite) params.site_id = selectedSite;
      const res = await apiClient.get('/api/v1/dashboard', { params });
      setData(res.data);
      setError('');
    } catch {
      setError('Dashboard-Daten konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [granularity, periodStart, periodEnd, selectedSite]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

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

  return (
    <div>
      {/* Header + Filter */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">
            {data.period_start} bis {data.period_end}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {/* Standort */}
          <div>
            <label className="label">Standort</label>
            <select
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              className="input w-auto"
            >
              <option value="">Alle Standorte</option>
              {sites.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          {/* Zeitraum */}
          <div>
            <label className="label">Von</label>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label">Bis</label>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="input"
            />
          </div>
          {/* Auflösung */}
          <div>
            <label className="label">Auflösung</label>
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
        </div>
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

      {/* Automatische Zusammenfassung */}
      <InsightsSummary data={data} />

      {/* Energieaufteilung (Tortendiagramm) */}
      <div className="mt-6">
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Energieaufteilung</h2>
          {data.energy_breakdown.length > 0 ? (
            <div className="flex flex-col md:flex-row items-center gap-6">
              <div className="flex-shrink-0">
                <ResponsiveContainer width={260} height={260}>
                  <PieChart>
                    <Pie
                      data={data.energy_breakdown}
                      dataKey="consumption_kwh"
                      nameKey="energy_type"
                      cx="50%"
                      cy="50%"
                      innerRadius={0}
                      outerRadius={110}
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
                        const lbl = ENERGY_TYPE_LABELS[name as keyof typeof ENERGY_TYPE_LABELS] || name;
                        if (entry?.original_unit && entry.original_unit !== 'kWh') {
                          return [`${formatNumber(entry.original_value)} ${entry.original_unit} (${formatNumber(value)} kWh)`, lbl];
                        }
                        return [`${formatNumber(value)} kWh`, lbl];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-3">
                {data.energy_breakdown.map((b, idx) => (
                  <div key={b.energy_type} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 flex-shrink-0 rounded-full"
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
                        ? `${formatNumber(b.original_value)} ${b.original_unit}`
                        : `${formatNumber(b.consumption_kwh)} kWh`
                      }
                      <span className="ml-1 text-gray-400 font-normal">
                        {(Number(b.share_percent) || 0).toFixed(1)}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-gray-400">
              Keine Daten vorhanden
            </div>
          )}
        </div>
      </div>

      {/* Jahresvergleich – eine Karte je Energieart */}
      {data.energy_breakdown.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {data.energy_breakdown.map(b => (
            <YearComparisonCard key={b.energy_type} energyType={b.energy_type} siteId={selectedSite} />
          ))}
        </div>
      )}

      {/* Untere Reihe: Top-Verbraucher + EnPI */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top-Verbraucher je Energietyp */}
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Top-Verbraucher</h2>
          {data.top_consumers.length > 0 ? (
            <div className="space-y-5">
              {data.top_consumers.map((group) => {
                const maxConsumption = group.meters[0]?.consumption || 1;
                const color = ENERGY_TYPE_COLORS[group.energy_type as keyof typeof ENERGY_TYPE_COLORS] || '#1B5E7B';
                return (
                  <div key={group.energy_type}>
                    <h3 className="mb-2 text-sm font-semibold text-gray-600">
                      {group.energy_type_label}
                    </h3>
                    <div className="space-y-2">
                      {group.meters.map((m) => {
                        const pct = (m.consumption / maxConsumption) * 100;
                        return (
                          <div key={m.meter_id}>
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium text-gray-700">{m.name}</span>
                              <span className="text-gray-500">
                                {formatNumber(m.consumption)} {m.unit}
                              </span>
                            </div>
                            <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full"
                                style={{ width: `${pct}%`, backgroundColor: color }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-center text-gray-400">Keine Verbrauchsdaten vorhanden</p>
          )}
        </div>

        {/* Echte EnPI-Übersicht */}
        <EnPIOverviewCard />
      </div>
    </div>
  );
}

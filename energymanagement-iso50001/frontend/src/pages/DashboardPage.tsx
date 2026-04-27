import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle, Activity,
  Zap, Leaf, Euro, Gauge, Sun, BatteryCharging,
  Trash2, ExternalLink, ChevronDown, ChevronUp, RefreshCw,
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

/* ── Jahresvergleich-Mini-Chart ── */

interface YearComparisonPoint {
  label: string;
  vorjahr: number;
  aktuell: number;
}

function YearComparisonCard() {
  const [data, setData] = useState<YearComparisonPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const thisYear = new Date().getFullYear();
    apiClient.get('/api/v1/analytics/comparison', {
      params: {
        period1_start: `${thisYear - 1}-01-01`,
        period1_end: `${thisYear - 1}-12-31`,
        period2_start: `${thisYear}-01-01`,
        period2_end: `${thisYear}-12-31`,
        granularity: 'monthly',
        energy_type: 'electricity',
      },
    }).then((res) => {
      const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      const p1 = (res.data.period1 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
      const p2 = (res.data.period2 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
      if (p1 && p2) {
        const agg1 = new Array(12).fill(0);
        const agg2 = new Array(12).fill(0);
        for (const series of Object.values(p1)) {
          series.forEach((pt, i) => { if (i < 12) agg1[i] += pt.value || 0; });
        }
        for (const series of Object.values(p2)) {
          series.forEach((pt, i) => { if (i < 12) agg2[i] += pt.value || 0; });
        }
        setData(months.map((m, i) => ({ label: m, vorjahr: agg1[i], aktuell: agg2[i] })));
      }
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const thisYear = new Date().getFullYear();

  return (
    <div className="card">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Jahresvergleich Strom
        <span className="ml-2 text-sm font-normal text-gray-400">{thisYear - 1} vs. {thisYear}</span>
      </h2>
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      ) : data.length > 0 && data.some((d) => d.vorjahr > 0 || d.aktuell > 0) ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip formatter={(value: number) => [`${formatNumber(value)} kWh`, '']} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="vorjahr" name={`${thisYear - 1}`} fill="#94a3b8" radius={[3, 3, 0, 0]} />
            <Bar dataKey="aktuell" name={`${thisYear}`} fill="#1B5E7B" radius={[3, 3, 0, 0]} />
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

  // Verbrauchstrend analysieren
  const consumption = data.kpi_cards.find((c) => c.label === 'Gesamtverbrauch');
  if (consumption?.trend_percent != null) {
    const pct = Math.abs(Number(consumption.trend_percent)).toFixed(1);
    if (Number(consumption.trend_percent) < -3) {
      insights.push({ text: `Ihr Energieverbrauch ist ${pct}% niedriger als im Vorjahr – gute Entwicklung.`, type: 'positive' });
    } else if (Number(consumption.trend_percent) > 3) {
      insights.push({ text: `Ihr Energieverbrauch ist ${pct}% höher als im Vorjahr – prüfen Sie die Ursachen.`, type: 'negative' });
    } else {
      insights.push({ text: `Ihr Energieverbrauch ist stabil (${pct}% Abweichung zum Vorjahr).`, type: 'neutral' });
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

  // Top-Verbraucher Hinweis
  if (data.top_consumers.length >= 2) {
    const top = data.top_consumers[0];
    const totalTop = data.top_consumers.reduce((s, c) => s + c.consumption_kwh, 0);
    const topShare = totalTop > 0 ? ((top.consumption_kwh / totalTop) * 100).toFixed(0) : 0;
    if (Number(topShare) > 40) {
      insights.push({ text: `"${top.name}" macht ${topShare}% der Top-5 Verbraucher aus – Optimierungspotenzial prüfen.`, type: 'neutral' });
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

/* ── Anomalie-Panel ── */

interface AnomalyReading {
  reading_id: string;
  meter_id: string;
  meter_name: string;
  energy_type: string;
  unit: string;
  site_id: string | null;
  site_name: string | null;
  timestamp: string;
  consumption: number;
  p95: number;
  factor: number;
}

const ENERGY_TYPE_COLORS_BG: Record<string, string> = {
  electricity: 'bg-yellow-100 text-yellow-800',
  gas: 'bg-blue-100 text-blue-800',
  district_heating: 'bg-red-100 text-red-800',
  district_cooling: 'bg-cyan-100 text-cyan-800',
  water: 'bg-teal-100 text-teal-800',
};

function AnomalyPanel() {
  const [anomalies, setAnomalies] = useState<AnomalyReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [threshold, setThreshold] = useState(20);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<AnomalyReading[]>('/api/v1/dashboard/anomalies', {
        params: { threshold, limit: 50 },
      });
      setAnomalies(res.data);
    } catch { /* interceptor */ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [threshold]);

  const handleDelete = async (reading: AnomalyReading) => {
    if (!confirm(`Messwert von ${reading.timestamp} (${Number(reading.consumption).toLocaleString('de-DE')} ${reading.unit}) wirklich löschen?`)) return;
    setDeleting(prev => new Set(prev).add(reading.reading_id));
    try {
      await apiClient.delete(`/api/v1/dashboard/anomalies/${reading.reading_id}`);
      setAnomalies(prev => prev.filter(a => a.reading_id !== reading.reading_id));
    } catch { /* interceptor */ } finally {
      setDeleting(prev => { const s = new Set(prev); s.delete(reading.reading_id); return s; });
    }
  };

  const handleGoToMeter = (a: AnomalyReading) => {
    if (a.site_id) {
      window.location.href = `/sites?site=${a.site_id}&meter=${a.meter_id}`;
    } else {
      window.location.href = `/meters?id=${a.meter_id}`;
    }
  };

  const handleGoToReadings = (a: AnomalyReading) => {
    window.location.href = `/readings?meter_id=${a.meter_id}`;
  };

  if (loading) return (
    <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 flex items-center gap-3">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-red-300 border-t-red-600 flex-shrink-0" />
      <span className="text-sm text-red-700">Ausreißer werden analysiert…</span>
    </div>
  );

  if (anomalies.length === 0) return null;

  return (
    <div className="mt-6 rounded-xl border-2 border-red-300 bg-red-50 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-red-200">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <h2 className="font-semibold text-red-800">
            {anomalies.length} Ausreißer erkannt
          </h2>
          <span className="text-xs text-red-500">
            (Verbrauch &gt; {threshold}× Normalwert)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-red-700 flex items-center gap-1">
            Schwellwert:
            <select
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              className="ml-1 rounded border border-red-300 bg-white px-1 py-0.5 text-xs text-red-800"
            >
              {[5, 10, 20, 50, 100].map(v => <option key={v} value={v}>{v}×</option>)}
            </select>
          </label>
          <button onClick={load} className="p-1 text-red-500 hover:text-red-700" title="Neu laden">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={() => setCollapsed(c => !c)} className="p-1 text-red-500 hover:text-red-700">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Tabelle */}
      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-red-200 bg-red-100/50 text-xs uppercase text-red-700">
              <tr>
                <th className="px-4 py-2 text-left">Zeitpunkt</th>
                <th className="px-4 py-2 text-left">Zähler</th>
                <th className="px-4 py-2 text-left">Standort</th>
                <th className="px-4 py-2 text-left">Energieart</th>
                <th className="px-4 py-2 text-right">Ausreißerwert</th>
                <th className="px-4 py-2 text-right">Normalwert p95</th>
                <th className="px-4 py-2 text-right">Faktor</th>
                <th className="px-4 py-2 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-red-100">
              {anomalies.map(a => (
                <tr key={a.reading_id} className="hover:bg-red-100/40 transition-colors">
                  <td className="px-4 py-2 font-mono text-xs text-gray-600 whitespace-nowrap">
                    {a.timestamp}
                  </td>
                  <td className="px-4 py-2 max-w-[200px]">
                    <span className="block font-medium text-gray-900 truncate" title={a.meter_name}>
                      {a.meter_name}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {a.site_name ?? '–'}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${ENERGY_TYPE_COLORS_BG[a.energy_type] || 'bg-gray-100 text-gray-700'}`}>
                      {ENERGY_TYPE_LABELS[a.energy_type as keyof typeof ENERGY_TYPE_LABELS] || a.energy_type}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right font-bold text-red-700 whitespace-nowrap">
                    {Number(a.consumption).toLocaleString('de-DE', { maximumFractionDigits: 1 })} {a.unit}
                  </td>
                  <td className="px-4 py-2 text-right text-gray-500 whitespace-nowrap">
                    {Number(a.p95).toLocaleString('de-DE', { maximumFractionDigits: 1 })} {a.unit}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <span className="font-bold text-red-600">
                      {Number(a.factor).toFixed(0)}×
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => handleGoToReadings(a)}
                        className="rounded p-1 text-gray-400 hover:text-primary-600"
                        title="Messwerte anzeigen"
                      >
                        <Activity className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleGoToMeter(a)}
                        className="rounded p-1 text-gray-400 hover:text-primary-600"
                        title="Zum Standort / Zähler"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(a)}
                        disabled={deleting.has(a.reading_id)}
                        className="rounded p-1 text-gray-400 hover:text-red-600 disabled:opacity-40"
                        title="Messwert löschen"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

      {/* Ausreißer-Panel */}
      <AnomalyPanel />

      {/* KPI-Karten */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.kpi_cards.map((card) => (
          <KPICardComponent key={card.label} card={card} />
        ))}
      </div>

      {/* Automatische Zusammenfassung */}
      <InsightsSummary data={data} />

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

      {/* Jahresvergleich */}
      <div className="mt-6">
        <YearComparisonCard />
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

        {/* Echte EnPI-Übersicht */}
        <EnPIOverviewCard />
      </div>
    </div>
  );
}

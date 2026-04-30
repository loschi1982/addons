import { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  ComposedChart, Scatter,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import InfoTip from '@/components/ui/InfoTip';
import SankeyDiagram from '@/components/charts/SankeyDiagram';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType } from '@/types';

const MonthlyComparisonPage = lazy(() => import('./MonthlyComparisonPage'));
const EnergyBalancePage = lazy(() => import('./EnergyBalancePage'));

/* ── Typen ── */

interface Meter {
  id: string;
  name: string;
  energy_type: string;
  location?: string | null;
}

interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
}

interface TimeSeriesMeter {
  meter_id: string;
  meter_name: string;
  energy_type: string;
  unit: string;
  data: TimeSeriesDataPoint[];
}

interface DistributionItem {
  label: string;
  value: number;
  original_value?: number;
  original_unit?: string;
  share_percent: number;
}

interface HeatmapPoint {
  weekday: number;
  weekday_label: string;
  hour: number;
  value: number;
}

interface SankeyNode {
  id: string;
  label: string;
  type: string;
}

interface SankeyLink {
  source: number;
  target: number;
  value: number;
  direction?: 'consumption' | 'feed_in';
}

interface SankeyData {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

interface Anomaly {
  meter_id: string;
  meter_name: string;
  timestamp: string;
  value: number;
  avg_value: number;
  deviation_sigma: number;
  severity: string;
}

interface WeatherCorrectedData {
  meter_name: string;
  raw: { period: string; value: number }[];
  corrected: { period: string; value: number }[];
}

interface CO2ReductionPath {
  actual: { year: number; co2_kg: number }[];
  target_path: { year: number; co2_kg: number }[];
  target_year: number;
  target_reduction_percent: number;
}

/* ── Konstanten ── */

const CHART_COLORS = [
  '#1B5E7B', '#F59E0B', '#3B82F6', '#10B981',
  '#8B5CF6', '#F97316', '#EC4899', '#84CC16',
];

interface TabDef {
  key: string;
  label: string;
}

interface TabGroup {
  label: string;
  description: string;
  tabs: TabDef[];
}

const TAB_GROUPS: TabGroup[] = [
  {
    label: 'Verbrauch',
    description: 'Verbrauchsdaten auswerten und vergleichen',
    tabs: [
      { key: 'timeseries', label: 'Zeitreihen' },
      { key: 'comparison', label: 'Periodenvergleich' },
      { key: 'monthly_comparison', label: 'Jahresvergleich' },
      { key: 'distribution', label: 'Verteilung' },
      { key: 'cumulative', label: 'Summenlinie' },
      { key: 'submeter', label: 'Teilzähler' },
    ],
  },
  {
    label: 'Effizienz',
    description: 'Lastprofile, Muster und Optimierungspotenziale',
    tabs: [
      { key: 'heatmap', label: 'Lastprofil' },
      { key: 'duration_curve', label: 'Dauerlinie' },
      { key: 'sankey', label: 'Energiefluss' },
      { key: 'self_consumption', label: 'Eigenverbrauch' },
      { key: 'weather', label: 'Witterungskorrektur' },
      { key: 'weather_regression', label: 'Wetter-Regression' },
    ],
  },
  {
    label: 'Klima & Ziele',
    description: 'CO₂-Reduktion, Energiebilanz und Auffälligkeiten',
    tabs: [
      { key: 'energy_balance', label: 'Energiebilanz' },
      { key: 'co2path', label: 'CO₂-Pfad' },
      { key: 'anomalies', label: 'Auffälligkeiten' },
    ],
  },
];

const ALL_TABS = TAB_GROUPS.flatMap((g) => g.tabs);
type TabKey = string;

/* ── Hilfsfunktionen ── */

function formatNumber(val: unknown): string {
  const num = Number(val) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} Mio.`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)} k`;
  return num.toFixed(1);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function yearStart(): string {
  return `${new Date().getFullYear()}-01-01`;
}

/* ── Hauptkomponente ── */

interface Site {
  id: string;
  name: string;
}

export default function AnalyticsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = (searchParams.get('tab') as TabKey) || 'timeseries';
  const [tab, setTab] = useState<TabKey>(
    ALL_TABS.some(t => t.key === initialTab) ? initialTab : 'timeseries'
  );
  const [meters, setMeters] = useState<Meter[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');

  const handleTabChange = (key: TabKey) => {
    setTab(key);
    setSearchParams(key === 'timeseries' ? {} : { tab: key }, { replace: true });
  };

  // Aktive Gruppe ermitteln
  const activeGroup = TAB_GROUPS.find((g) => g.tabs.some((t) => t.key === tab)) || TAB_GROUPS[0];

  useEffect(() => {
    apiClient.get('/api/v1/meters', { params: { page_size: 500 } }).then((res) => {
      const items = res.data.items || res.data;
      setMeters(Array.isArray(items) ? items : []);
    });
    apiClient.get('/api/v1/sites', { params: { page_size: 100 } }).then((res) => {
      const items = res.data.items || res.data;
      setSites(Array.isArray(items) ? items : []);
    });
  }, []);

  const filteredMeters = siteId ? meters.filter((m) => (m as unknown as Record<string, unknown>)['site_id'] === siteId) : meters;

  return (
    <div>
      <div className="flex items-end justify-between">
        <div>
          <h1 className="page-title">Analysen</h1>
          <p className="mt-1 text-sm text-gray-500">
            Erweiterte Auswertungen und Visualisierungen der Energiedaten.
          </p>
        </div>
        {sites.length > 0 && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-600">Standort:</label>
            <select
              className="input w-auto min-w-[200px]"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
            >
              <option value="">Alle Standorte</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Kategorien */}
      <div className="mt-4 flex gap-2">
        {TAB_GROUPS.map((group) => (
          <button
            key={group.label}
            onClick={() => handleTabChange(group.tabs[0].key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeGroup.label === group.label
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {group.label}
          </button>
        ))}
      </div>

      {/* Untertabs der aktiven Kategorie */}
      <div className="mt-3 flex flex-wrap gap-1 border-b">
        {activeGroup.tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-primary-600 text-primary-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Kategorie-Beschreibung */}
      <p className="mt-2 text-xs text-gray-400">{activeGroup.description}</p>

      <div className="mt-4">
        {tab === 'timeseries' && <TimeSeriesTab meters={filteredMeters} siteId={siteId} />}
        {tab === 'comparison' && <ComparisonTab meters={filteredMeters} siteId={siteId} />}
        {tab === 'monthly_comparison' && (
          <Suspense fallback={<div className="py-8 text-center text-gray-400">Laden...</div>}>
            <MonthlyComparisonPage siteId={siteId} />
          </Suspense>
        )}
        {tab === 'energy_balance' && (
          <Suspense fallback={<div className="py-8 text-center text-gray-400">Laden...</div>}>
            <EnergyBalancePage siteId={siteId} />
          </Suspense>
        )}
        {tab === 'distribution' && <DistributionTab siteId={siteId} />}
        {tab === 'self_consumption' && <SelfConsumptionTab />}
        {tab === 'heatmap' && <HeatmapTab meters={filteredMeters} />}
        {tab === 'sankey' && <SankeyTab meters={filteredMeters} />}
        {tab === 'duration_curve' && <DurationCurveTab meters={filteredMeters} />}
        {tab === 'cumulative' && <CumulativeTab meters={filteredMeters} siteId={siteId} />}
        {tab === 'weather' && <WeatherCorrectionTab meters={filteredMeters} />}
        {tab === 'co2path' && <CO2PathTab />}
        {tab === 'anomalies' && <AnomaliesTab />}
        {tab === 'submeter' && <SubMeterContributionTab meters={meters} />}
        {tab === 'weather_regression' && <WeatherRegressionTab meters={filteredMeters} />}
      </div>
    </div>
  );
}

/* ── Tab: Zeitreihen ── */

function TimeSeriesTab({ meters, siteId }: { meters: Meter[]; siteId?: string }) {
  const [data, setData] = useState<TimeSeriesMeter[]>([]);
  const [selectedEnergyType, setSelectedEnergyType] = useState('electricity');
  const [selectedMeter, setSelectedMeter] = useState('');
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [granularity, setGranularity] = useState('daily');
  const [loading, setLoading] = useState(false);
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('bar');

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  // Zähler-Auswahl zurücksetzen wenn Energietyp wechselt
  const handleEnergyTypeChange = (et: string) => {
    setSelectedEnergyType(et);
    setSelectedMeter('');
  };

  const fetchData = useCallback(async () => {
    if (!selectedMeter && !siteId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = {
        start_date: startDate,
        end_date: endDate,
        granularity,
      };
      if (selectedMeter) params.meter_ids = selectedMeter;
      if (siteId) params.site_id = siteId;
      const res = await apiClient.get('/api/v1/analytics/timeseries', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeter, startDate, endDate, granularity, siteId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Daten für Recharts formatieren
  const chartData: Record<string, unknown>[] = [];
  if (data.length > 0) {
    const maxLen = Math.max(...data.map((s) => s.data.length));
    for (let i = 0; i < maxLen; i++) {
      const point: Record<string, unknown> = {};
      data.forEach((s) => {
        const dp = s.data[i];
        if (dp) {
          point.label = formatDate(dp.timestamp);
          point[s.meter_name] = dp.value;
        }
      });
      if (point.label) chartData.push(point);
    }
  }

  const ChartComp = chartType === 'area' ? AreaChart : chartType === 'bar' ? BarChart : LineChart;

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieträger</label>
          <select className="input" value={selectedEnergyType} onChange={(e) => handleEnergyTypeChange(e.target.value)}>
            {energyTypes.map((et) => (
              <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as EnergyType] ?? et}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zähler</label>
          <select className="input" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {filteredMeters.map((m) => (
              <option key={m.id} value={m.id}>{m.location || m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Granularität</label>
          <select className="input" value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="hourly">Stündlich</option>
            <option value="daily">Täglich</option>
            <option value="weekly">Wöchentlich</option>
            <option value="monthly">Monatlich</option>
          </select>
        </div>
        <div>
          <label className="label">Diagrammtyp</label>
          <select className="input" value={chartType} onChange={(e) => setChartType(e.target.value as 'line' | 'area' | 'bar')}>
            <option value="line">Linie</option>
            <option value="area">Fläche</option>
            <option value="bar">Balken</option>
          </select>
        </div>
        <button onClick={fetchData} className="btn-secondary flex items-center gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Aktualisieren
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <ChartComp data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} ${data[0]?.unit ?? ''}`, '']} />
              <Legend />
              {data.map((s, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                if (chartType === 'bar') {
                  return <Bar key={s.meter_id} dataKey={s.meter_name} fill={color} radius={[4, 4, 0, 0]} />;
                }
                if (chartType === 'area') {
                  return <Area key={s.meter_id} dataKey={s.meter_name} stroke={color} fill={color} fillOpacity={0.15} />;
                }
                return <Line key={s.meter_id} dataKey={s.meter_name} stroke={color} dot={false} strokeWidth={2} />;
              })}
            </ChartComp>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {selectedMeter ? 'Keine Daten für den gewählten Zeitraum' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Vergleich ── */

function ComparisonTab({ meters, siteId }: { meters: Meter[]; siteId?: string }) {
  const [mode, setMode] = useState<'meter' | 'energy_type'>('energy_type');
  const [selectedMeter, setSelectedMeter] = useState('');
  const [selectedEnergyType, setSelectedEnergyType] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const thisYear = new Date().getFullYear();

  // Verfügbare Energieträger aus Zählern ableiten
  const energyTypes = [...new Set(meters.map((m) => m.energy_type))];

  const fetchComparison = useCallback(async () => {
    const params: Record<string, string> = {
      period1_start: `${thisYear - 1}-01-01`,
      period1_end: `${thisYear - 1}-12-31`,
      period2_start: `${thisYear}-01-01`,
      period2_end: `${thisYear}-12-31`,
      granularity: 'monthly',
    };
    if (mode === 'meter') {
      if (!selectedMeter) return;
      params.meter_ids = selectedMeter;
    } else {
      if (!selectedEnergyType) return;
      params.energy_type = selectedEnergyType;
    }
    if (siteId) params.site_id = siteId;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/comparison', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [mode, selectedMeter, selectedEnergyType, thisYear, siteId]);

  useEffect(() => { fetchComparison(); }, [fetchComparison]);

  // Vergleichsdaten aufbereiten – alle Zähler in der Antwort aggregieren
  const chartData: { label: string; vorjahr: number; aktuell: number }[] = [];
  if (data) {
    const p1 = (data.period1 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
    const p2 = (data.period2 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
    if (p1 && p2) {
      const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      // Alle Zähler-Daten pro Monat aggregieren
      const agg1 = new Array(12).fill(0);
      const agg2 = new Array(12).fill(0);
      for (const series of Object.values(p1)) {
        series.forEach((pt, i) => { if (i < 12) agg1[i] += pt.value || 0; });
      }
      for (const series of Object.values(p2)) {
        series.forEach((pt, i) => { if (i < 12) agg2[i] += pt.value || 0; });
      }
      for (let i = 0; i < 12; i++) {
        chartData.push({ label: months[i], vorjahr: agg1[i], aktuell: agg2[i] });
      }
    }
  }

  const selectionLabel = mode === 'energy_type' && selectedEnergyType
    ? (ENERGY_TYPE_LABELS[selectedEnergyType as keyof typeof ENERGY_TYPE_LABELS] || selectedEnergyType)
    : '';

  return (
    <div>
      <div className="flex flex-wrap gap-4 items-end mb-6">
        <div>
          <label className="label">Vergleich nach</label>
          <select className="input w-48" value={mode} onChange={(e) => { setMode(e.target.value as 'meter' | 'energy_type'); setData(null); }}>
            <option value="energy_type">Energieträger</option>
            <option value="meter">Einzelner Zähler</option>
          </select>
        </div>
        {mode === 'meter' ? (
          <div>
            <label className="label">Zähler auswählen</label>
            <select className="input w-64" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
              <option value="">— Bitte wählen —</option>
              {meters.map((m) => (
                <option key={m.id} value={m.id}>{m.location || m.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="label">Energieträger</label>
            <select className="input w-64" value={selectedEnergyType} onChange={(e) => setSelectedEnergyType(e.target.value)}>
              <option value="">— Bitte wählen —</option>
              {energyTypes.map((et) => (
                <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as keyof typeof ENERGY_TYPE_LABELS] || et}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Jahresvergleich {thisYear - 1} vs. {thisYear}
          {selectionLabel && ` – ${selectionLabel}`}
        </h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
              <Legend />
              <Bar dataKey="vorjahr" name={`${thisYear - 1}`} fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="aktuell" name={`${thisYear}`} fill="#1B5E7B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {(mode === 'meter' && !selectedMeter) || (mode === 'energy_type' && !selectedEnergyType)
              ? `Bitte ${mode === 'meter' ? 'Zähler' : 'Energieträger'} auswählen`
              : 'Keine Vergleichsdaten vorhanden'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Verteilung ── */

function DistributionTab({ siteId }: { siteId?: string }) {
  const [data, setData] = useState<DistributionItem[]>([]);
  const [groupBy, setGroupBy] = useState('energy_type');
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = { start_date: startDate, end_date: endDate, group_by: groupBy };
      if (siteId) params.site_id = siteId;
      const res = await apiClient.get('/api/v1/analytics/distribution', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [startDate, endDate, groupBy, siteId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Gruppierung</label>
          <select className="input" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            <option value="energy_type">Energietyp</option>
            <option value="location">Standort</option>
            <option value="cost_center">Kostenstelle</option>
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : data.length > 0 ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ResponsiveContainer width="100%" height={350}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={120}
                  paddingAngle={2}
                  label={(entry) => `${entry.label}: ${entry.share_percent}%`}
                >
                  {data.map((_, idx) => (
                    <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(val: number, name: string) => {
                  const entry = data.find(d => d.label === name);
                  if (entry?.original_unit && entry.original_unit !== 'kWh') {
                    return [`${formatNumber(entry.original_value)} ${entry.original_unit} (${formatNumber(val)} kWh)`, ''];
                  }
                  return [`${formatNumber(val)} kWh`, ''];
                }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-3">
              {data.map((item, idx) => (
                <div key={item.label} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 rounded" style={{ backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] }} />
                    <span className="text-sm font-medium text-gray-700">
                      {ENERGY_TYPE_LABELS[item.label as keyof typeof ENERGY_TYPE_LABELS] || item.label}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-semibold text-gray-900">
                      {item.original_unit && item.original_unit !== 'kWh'
                        ? `${formatNumber(item.original_value)} ${item.original_unit}`
                        : `${formatNumber(item.value)} kWh`
                      }
                    </span>
                    <span className="ml-2 text-xs text-gray-500">({item.share_percent}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            Keine Daten vorhanden
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Heatmap ── */

function HeatmapTab({ meters }: { meters: Meter[] }) {
  const [selectedEnergyType, setSelectedEnergyType] = useState('electricity');
  const [selectedMeter, setSelectedMeter] = useState('');
  const [data, setData] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  const fetchData = useCallback(async () => {
    if (!selectedMeter) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/heatmap', {
        params: { meter_id: selectedMeter },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const weekdays = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  const hours = Array.from({ length: 24 }, (_, i) => i);

  const getColor = (value: number) => {
    const intensity = Math.min(value / maxValue, 1);
    const r = Math.round(27 + (255 - 27) * (1 - intensity));
    const g = Math.round(94 + (255 - 94) * (1 - intensity));
    const b = Math.round(123 + (255 - 123) * (1 - intensity));
    return `rgb(${r}, ${g}, ${b})`;
  };

  const getValue = (weekday: number, hour: number): number => {
    const point = data.find((d) => d.weekday === weekday && d.hour === hour);
    return point?.value || 0;
  };

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieträger</label>
          <select className="input" value={selectedEnergyType} onChange={(e) => { setSelectedEnergyType(e.target.value); setSelectedMeter(''); }}>
            {energyTypes.map((et) => (
              <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as EnergyType] ?? et}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zähler auswählen</label>
          <select className="input w-80" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {filteredMeters.map((m) => (
              <option key={m.id} value={m.id}>{m.location || m.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Verbrauchsmuster (Wochentag × Stunde)</h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <thead>
                <tr>
                  <th className="p-1 text-xs text-gray-500" />
                  {hours.map((h) => (
                    <th key={h} className="p-1 text-xs text-gray-500 text-center">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekdays.map((day, dayIdx) => (
                  <tr key={dayIdx}>
                    <td className="pr-2 text-xs text-gray-500 text-right font-medium">{day}</td>
                    {hours.map((h) => {
                      const val = getValue(dayIdx, h);
                      return (
                        <td
                          key={h}
                          className="p-0"
                          title={`${day} ${h}:00 – ${val.toFixed(1)} kWh`}
                        >
                          <div
                            className="h-6 w-6 rounded-sm"
                            style={{ backgroundColor: val > 0 ? getColor(val) : '#f3f4f6' }}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <span>Niedrig</span>
              <div className="flex">
                {[0.1, 0.3, 0.5, 0.7, 0.9].map((i) => (
                  <div key={i} className="h-4 w-6" style={{ backgroundColor: getColor(maxValue * i) }} />
                ))}
              </div>
              <span>Hoch</span>
            </div>
          </div>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {selectedMeter ? 'Keine Heatmap-Daten' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Sankey ── */

function SankeyTab({ meters }: { meters: Meter[] }) {
  const [data, setData] = useState<SankeyData | null>(null);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [energyType, setEnergyType] = useState('');
  const [loading, setLoading] = useState(false);

  // Verfügbare Energiearten aus übergebenen Zählern ableiten
  const availableTypes = [...new Set(meters.map((m) => m.energy_type))].sort();

  // Erste Energieart vorauswählen sobald Zähler verfügbar
  useEffect(() => {
    if (availableTypes.length > 0 && !energyType) {
      setEnergyType(availableTypes[0]);
    }
  }, [availableTypes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        start_date: startDate,
        end_date: endDate,
      };
      if (energyType) params.energy_type = energyType;
      const res = await apiClient.get('/api/v1/analytics/sankey', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [startDate, endDate, energyType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieart</label>
          <select
            className="input w-48"
            value={energyType}
            onChange={(e) => setEnergyType(e.target.value)}
          >
            <option value="">Alle Energiearten</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>
                {ENERGY_TYPE_LABELS[t as EnergyType] || t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Energieflussdiagramm
          {energyType && (
            <span className="ml-2 text-base font-normal text-gray-500">
              – {ENERGY_TYPE_LABELS[energyType as EnergyType] || energyType}
            </span>
          )}
        </h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : data && data.nodes.length > 0 ? (
          <div className="overflow-x-auto">
            <SankeyDiagram nodes={data.nodes} links={data.links} width={800} height={450} />
          </div>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            Keine Energieflussdaten vorhanden
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Witterungskorrektur ── */

function WeatherCorrectionTab({ meters }: { meters: Meter[] }) {
  const [selectedEnergyType, setSelectedEnergyType] = useState('district_heating');
  const [selectedMeter, setSelectedMeter] = useState('');
  const [data, setData] = useState<WeatherCorrectedData | null>(null);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  const fetchData = useCallback(async () => {
    if (!selectedMeter) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/weather-corrected', {
        params: { meter_id: selectedMeter, start_date: startDate, end_date: endDate },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeter, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Daten kombinieren
  const chartData: { label: string; roh: number; korrigiert: number }[] = [];
  if (data) {
    const rawMap = new Map(data.raw.map((r) => [r.period?.substring(0, 7), r.value]));
    const corrMap = new Map(data.corrected.map((r) => [r.period?.substring(0, 7), r.value]));
    const allPeriods = new Set([...rawMap.keys(), ...corrMap.keys()]);
    const sorted = [...allPeriods].sort();
    sorted.forEach((p) => {
      chartData.push({
        label: p,
        roh: rawMap.get(p) || 0,
        korrigiert: corrMap.get(p) || 0,
      });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieträger</label>
          <select className="input" value={selectedEnergyType} onChange={(e) => { setSelectedEnergyType(e.target.value); setSelectedMeter(''); }}>
            {energyTypes.map((et) => (
              <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as EnergyType] ?? et}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zähler</label>
          <select className="input w-80" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {filteredMeters.map((m) => (
              <option key={m.id} value={m.id}>{m.location || m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Rohverbrauch vs. Witterungskorrigiert
          {data?.meter_name && <span className="text-gray-400 font-normal"> – {data.meter_name}</span>}
        </h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" />
              <YAxis />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
              <Legend />
              <Bar dataKey="roh" name="Rohverbrauch" fill="#94a3b8" radius={[4, 4, 0, 0]} />
              <Bar dataKey="korrigiert" name="Witterungskorrigiert" fill="#1B5E7B" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {selectedMeter ? 'Keine Korrekturdaten vorhanden' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: CO₂-Reduktionspfad ── */

function CO2PathTab() {
  const [data, setData] = useState<CO2ReductionPath | null>(null);
  const [targetYear, setTargetYear] = useState(2030);
  const [targetReduction, setTargetReduction] = useState(55);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/co2-reduction-path', {
        params: { target_year: targetYear, target_reduction_percent: targetReduction },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [targetYear, targetReduction]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Daten für Chart kombinieren
  const chartData: { year: number; ist: number | null; ziel: number | null }[] = [];
  if (data) {
    const actualMap = new Map(data.actual.map((a) => [a.year, a.co2_kg]));
    const targetMap = new Map(data.target_path.map((t) => [t.year, t.co2_kg]));
    const allYears = new Set([...actualMap.keys(), ...targetMap.keys()]);
    [...allYears].sort().forEach((y) => {
      chartData.push({
        year: y,
        ist: actualMap.get(y) ?? null,
        ziel: targetMap.get(y) ?? null,
      });
    });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Zieljahr</label>
          <input type="number" className="input w-28" value={targetYear} onChange={(e) => setTargetYear(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Reduktionsziel (%)</label>
          <input type="number" className="input w-28" value={targetReduction} onChange={(e) => setTargetReduction(Number(e.target.value))} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">
          CO₂-Reduktionspfad bis {targetYear} (–{targetReduction}%)
        </h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="year" />
              <YAxis />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kg CO₂`, '']} />
              <Legend />
              <Line dataKey="ist" name="Ist-Emissionen" stroke="#1B5E7B" strokeWidth={3} dot={{ r: 5 }} connectNulls />
              <Line dataKey="ziel" name="Zielpfad" stroke="#10B981" strokeWidth={2} strokeDasharray="8 4" dot={false} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            Keine CO₂-Daten vorhanden
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Anomalien ── */

function AnomaliesTab() {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [threshold, setThreshold] = useState(2.0);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/anomalies', {
        params: { threshold, days },
      });
      setAnomalies(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [threshold, days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">
            Schwellwert (σ)
            <InfoTip title="Anomalie-Erkennung" formula="σ = (Wert − Ø) ÷ Standardabw.">
              Werte mit einer Abweichung größer als der gewählte Schwellwert (in Standardabweichungen) werden als Anomalie markiert.
            </InfoTip>
          </label>
          <input type="number" step="0.5" min="1" max="5" className="input w-24" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Zeitraum (Tage)</label>
          <input type="number" min="7" max="365" className="input w-24" value={days} onChange={(e) => setDays(Number(e.target.value))} />
        </div>
        <button onClick={fetchData} className="btn-secondary flex items-center gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Prüfen
        </button>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Erkannte Anomalien</h2>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : anomalies.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Zähler</th>
                  <th className="pb-2 font-medium">Zeitpunkt</th>
                  <th className="pb-2 font-medium text-right">Messwert</th>
                  <th className="pb-2 font-medium text-right">Durchschnitt</th>
                  <th className="pb-2 font-medium text-right">Abweichung</th>
                  <th className="pb-2 font-medium text-center">Schwere</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.map((a, idx) => (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-2 font-medium text-gray-700">{a.meter_name}</td>
                    <td className="py-2 text-gray-500">{formatDate(a.timestamp)}</td>
                    <td className="py-2 text-right text-gray-700">{formatNumber(a.value)}</td>
                    <td className="py-2 text-right text-gray-500">{formatNumber(a.avg_value)}</td>
                    <td className="py-2 text-right font-medium text-red-600">{a.deviation_sigma}σ</td>
                    <td className="py-2 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          a.severity === 'hoch'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {a.severity === 'hoch' ? 'Hoch' : 'Mittel'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-gray-400">
            Keine Anomalien erkannt
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Eigenverbrauch & Autarkiegrad ── */

interface SelfConsumptionPoint {
  period: string;
  production_kwh: number;
  consumption_kwh: number;
  self_consumption_kwh: number;
  autarky_percent: number;
}

function SelfConsumptionTab() {
  const [data, setData] = useState<SelfConsumptionPoint[]>([]);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [granularity, setGranularity] = useState('monthly');
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/self-consumption', {
        params: { start_date: startDate, end_date: endDate, granularity },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [startDate, endDate, granularity]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const chartData = data.map((d) => ({
    label: formatDate(d.period),
    eigenverbrauch: d.self_consumption_kwh,
    produktion: d.production_kwh,
    autarkiegrad: d.autarky_percent,
  }));

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Granularität</label>
          <select className="input" value={granularity} onChange={(e) => setGranularity(e.target.value)}>
            <option value="daily">Täglich</option>
            <option value="weekly">Wöchentlich</option>
            <option value="monthly">Monatlich</option>
            <option value="yearly">Jährlich</option>
          </select>
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Eigenverbrauch & Autarkiegrad</h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="kwh" tick={{ fontSize: 12 }} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
              <Tooltip
                formatter={(value: number, name: string) => {
                  if (name === 'Autarkiegrad') return [`${value.toFixed(1)}%`, name];
                  return [`${formatNumber(value)} kWh`, name];
                }}
              />
              <Legend />
              <Bar yAxisId="kwh" dataKey="produktion" name="PV-Produktion" fill="#F59E0B" radius={[4, 4, 0, 0]} />
              <Bar yAxisId="kwh" dataKey="eigenverbrauch" name="Eigenverbrauch" fill="#10B981" radius={[4, 4, 0, 0]} />
              <Line yAxisId="pct" dataKey="autarkiegrad" name="Autarkiegrad" stroke="#1B5E7B" strokeWidth={2} dot={{ r: 3 }} type="monotone" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            Keine PV-/Einspeisedaten vorhanden
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Jahresdauerlinie ── */

function DurationCurveTab({ meters }: { meters: Meter[] }) {
  const [selectedEnergyType, setSelectedEnergyType] = useState('electricity');
  const [selectedMeter, setSelectedMeter] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState<{ index: number; value: number }[]>([]);
  const [loading, setLoading] = useState(false);

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  const fetchData = useCallback(async () => {
    if (!selectedMeter) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/duration-curve', {
        params: { meter_id: selectedMeter, year },
      });
      setData(res.data.data || []);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeter, year]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieträger</label>
          <select className="input" value={selectedEnergyType} onChange={(e) => { setSelectedEnergyType(e.target.value); setSelectedMeter(''); }}>
            {energyTypes.map((et) => (
              <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as EnergyType] ?? et}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zähler</label>
          <select className="input w-80" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">Bitte wählen…</option>
            {filteredMeters.map((m) => <option key={m.id} value={m.id}>{m.location || m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Jahr</label>
          <input type="number" className="input w-24" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">
          Jahresdauerlinie
          <InfoTip title="Dauerlinie" formula="Verbrauchswerte absteigend sortiert">
            Zeigt das Verhältnis von Grund- und Spitzenlast. Flache Bereiche deuten auf konstante Grundlast hin, steile Abschnitte auf Lastspitzen.
          </InfoTip>
        </h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : data.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="index" tick={{ fontSize: 11 }} label={{ value: 'Stunden', position: 'insideBottom', offset: -5 }} />
              <YAxis tick={{ fontSize: 12 }} label={{ value: 'kWh', angle: -90, position: 'insideLeft' }} />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, 'Verbrauch']} />
              <Area type="monotone" dataKey="value" stroke="#1B5E7B" fill="#1B5E7B" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {selectedMeter ? 'Keine Daten vorhanden' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Summenlinie (Kumulativer Verbrauch) ── */

function CumulativeTab({ meters, siteId }: { meters: Meter[]; siteId?: string }) {
  const [selectedEnergyType, setSelectedEnergyType] = useState('electricity');
  const [selectedMeters, setSelectedMeters] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<TimeSeriesMeter[]>([]);
  const [loading, setLoading] = useState(false);

  const energyTypes = [...new Set(meters.map((m) => m.energy_type))].sort();
  const filteredMeters = meters.filter((m) => m.energy_type === selectedEnergyType);

  const fetchData = useCallback(async () => {
    if (selectedMeters.length === 0 && !siteId) return;
    setLoading(true);
    try {
      const params: Record<string, string> = { start_date: startDate, end_date: endDate };
      if (selectedMeters.length > 0) params.meter_ids = selectedMeters.join(',');
      if (siteId) params.site_id = siteId;
      const res = await apiClient.get('/api/v1/analytics/cumulative', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeters, startDate, endDate, siteId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Daten für Chart kombinieren
  const chartData: Record<string, number | string>[] = [];
  if (data.length > 0) {
    const maxLen = Math.max(...data.map((s) => s.data.length));
    for (let i = 0; i < maxLen; i++) {
      const row: Record<string, number | string> = { label: '' };
      data.forEach((s) => {
        if (s.data[i]) {
          row.label = formatDate(s.data[i].timestamp);
          row[s.meter_name] = s.data[i].value;
        }
      });
      chartData.push(row);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Energieträger</label>
          <select className="input" value={selectedEnergyType} onChange={(e) => { setSelectedEnergyType(e.target.value); setSelectedMeters([]); }}>
            {energyTypes.map((et) => (
              <option key={et} value={et}>{ENERGY_TYPE_LABELS[et as EnergyType] ?? et}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Zähler (Mehrfachauswahl, Strg+Klick)</label>
          <select
            className="input"
            multiple
            size={6}
            value={selectedMeters}
            onChange={(e) => setSelectedMeters(Array.from(e.target.selectedOptions, (o) => o.value))}
          >
            {filteredMeters.map((m) => <option key={m.id} value={m.id}>{m.location || m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Kumulativer Verbrauch</h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={400}>
            <AreaChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
              <Legend />
              {data.map((s, idx) => (
                <Area
                  key={s.meter_id}
                  type="monotone"
                  dataKey={s.meter_name}
                  stroke={CHART_COLORS[idx % CHART_COLORS.length]}
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-80 items-center justify-center text-gray-400">
            {selectedMeters.length > 0 ? 'Keine Daten vorhanden' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Teilzähler-Beitrag ── */

interface SubMeterData {
  root: { id: string; name: string; unit: string; total_kwh: number } | null;
  children: { id: string; name: string; kwh: number; share_percent: number }[];
  unaccounted_kwh: number;
  unaccounted_percent: number;
}

function SubMeterContributionTab({ meters }: { meters: Meter[] }) {
  const [rootMeterId, setRootMeterId] = useState('');
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<SubMeterData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!rootMeterId) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/submeter-contribution', {
        params: { root_meter_id: rootMeterId, start_date: startDate, end_date: endDate },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [rootMeterId, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const pieData = data
    ? [
        ...(data.children || []).map((c, i) => ({ name: c.name, value: c.kwh, color: CHART_COLORS[i % CHART_COLORS.length] })),
        ...(data.unaccounted_kwh > 0.1 ? [{ name: 'Nicht erfasst', value: data.unaccounted_kwh, color: '#E5E7EB' }] : []),
      ]
    : [];

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Hauptzähler</label>
          <select className="input" value={rootMeterId} onChange={(e) => setRootMeterId(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.location || m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button onClick={fetchData} className="btn-primary flex items-center gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Laden
        </button>
      </div>

      {loading && (
        <div className="flex h-60 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      )}

      {!loading && data && data.root && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Donut-Chart */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              Verbrauchsanteile – {data.root.name}
              <span className="ml-2 text-gray-400 font-normal">({formatNumber(data.root.total_kwh)} kWh gesamt)</span>
            </h3>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={110}
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-60 items-center justify-center text-gray-400">Keine Unterzähler vorhanden</div>
            )}
          </div>

          {/* Tabelle */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Aufschlüsselung</h3>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Zähler</th>
                  <th className="pb-2 font-medium text-right">kWh</th>
                  <th className="pb-2 font-medium text-right">Anteil</th>
                </tr>
              </thead>
              <tbody>
                {(data.children || []).map((c, i) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full flex-shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      {c.name}
                    </td>
                    <td className="py-2 text-right font-mono">{formatNumber(c.kwh)}</td>
                    <td className="py-2 text-right font-mono">{c.share_percent.toFixed(1)}%</td>
                  </tr>
                ))}
                {data.unaccounted_kwh > 0.1 && (
                  <tr className="border-b last:border-0 text-gray-400">
                    <td className="py-2 flex items-center gap-2">
                      <span className="inline-block h-3 w-3 rounded-full flex-shrink-0 bg-gray-200" />
                      Nicht erfasst
                    </td>
                    <td className="py-2 text-right font-mono">{formatNumber(data.unaccounted_kwh)}</td>
                    <td className="py-2 text-right font-mono">{data.unaccounted_percent.toFixed(1)}%</td>
                  </tr>
                )}
                <tr className="font-semibold">
                  <td className="pt-3">Hauptzähler gesamt</td>
                  <td className="pt-3 text-right font-mono">{formatNumber(data.root.total_kwh)}</td>
                  <td className="pt-3 text-right font-mono">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !data && rootMeterId && (
        <div className="flex h-60 items-center justify-center text-gray-400">Keine Daten vorhanden</div>
      )}
      {!loading && !rootMeterId && (
        <div className="flex h-60 items-center justify-center text-gray-400">Bitte Hauptzähler auswählen</div>
      )}
    </div>
  );
}

/* ── Tab: Wetter-Regression ── */

interface RegressionPoint {
  date: string;
  temp: number;
  consumption: number;
}

interface RegressionResult {
  slope: number;
  intercept: number;
  r2: number;
}

interface WeatherRegressionData {
  meter_name: string;
  unit: string;
  points: RegressionPoint[];
  regression: RegressionResult | null;
}

function WeatherRegressionTab({ meters }: { meters: Meter[] }) {
  const [meterId, setMeterId] = useState('');
  const [startDate, setStartDate] = useState(`${new Date().getFullYear() - 1}-01-01`);
  const [endDate, setEndDate] = useState(today());
  const [data, setData] = useState<WeatherRegressionData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!meterId) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/weather-regression', {
        params: { meter_id: meterId, start_date: startDate, end_date: endDate },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [meterId, startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Regressionslinie als 2 Punkte berechnen
  const regressionLineData = data?.regression && data.points.length >= 2
    ? (() => {
        const temps = data.points.map((p) => p.temp);
        const tMin = Math.min(...temps);
        const tMax = Math.max(...temps);
        const { slope, intercept } = data.regression;
        return [
          { temp: tMin, regression: slope * tMin + intercept },
          { temp: tMax, regression: slope * tMax + intercept },
        ];
      })()
    : [];

  const r2 = data?.regression?.r2 ?? 0;
  const r2Label = r2 >= 0.7 ? 'stark' : r2 >= 0.4 ? 'mittel' : 'schwach';
  const r2Color = r2 >= 0.7 ? 'text-green-600' : r2 >= 0.4 ? 'text-amber-600' : 'text-gray-500';

  return (
    <div>
      <div className="flex flex-wrap gap-3 items-end mb-6">
        <div>
          <label className="label">Zähler</label>
          <select className="input" value={meterId} onChange={(e) => setMeterId(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.location || m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button onClick={fetchData} className="btn-primary flex items-center gap-1.5">
          <RefreshCw className="h-4 w-4" />
          Laden
        </button>
      </div>

      {loading && (
        <div className="flex h-60 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
        </div>
      )}

      {!loading && data && data.points.length > 0 && (
        <>
          {/* Kennzahlen */}
          {data.regression && (
            <div className="mb-4 flex flex-wrap gap-4">
              <div className="card flex-1 min-w-[140px] p-4 text-center">
                <p className="text-xs text-gray-500">Steigung</p>
                <p className="text-lg font-semibold">{data.regression.slope.toFixed(2)}</p>
                <p className="text-xs text-gray-400">{data.unit}/°C</p>
              </div>
              <div className="card flex-1 min-w-[140px] p-4 text-center">
                <p className="text-xs text-gray-500">Achsenabschnitt</p>
                <p className="text-lg font-semibold">{data.regression.intercept.toFixed(1)}</p>
                <p className="text-xs text-gray-400">{data.unit} bei 0°C</p>
              </div>
              <div className="card flex-1 min-w-[140px] p-4 text-center">
                <p className="text-xs text-gray-500">Bestimmtheitsmaß R²</p>
                <p className={`text-lg font-semibold ${r2Color}`}>{(r2 * 100).toFixed(1)}%</p>
                <p className={`text-xs ${r2Color}`}>Witterungsabhängigkeit {r2Label}</p>
              </div>
              <div className="card flex-1 min-w-[140px] p-4 text-center">
                <p className="text-xs text-gray-500">Datenpunkte</p>
                <p className="text-lg font-semibold">{data.points.length}</p>
                <p className="text-xs text-gray-400">Tage</p>
              </div>
            </div>
          )}

          {/* Streuplot */}
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">
              {data.meter_name} – Tagesverbrauch vs. Außentemperatur
            </h3>
            <ResponsiveContainer width="100%" height={360}>
              <ComposedChart data={data.points}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="temp"
                  type="number"
                  domain={['auto', 'auto']}
                  tickFormatter={(v: number) => `${v}°C`}
                  name="Temperatur"
                />
                <YAxis
                  dataKey="consumption"
                  tickFormatter={(v: number) => formatNumber(v)}
                  name={data.unit}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    `${formatNumber(val)} ${data.unit}`,
                    name === 'consumption' ? 'Tagesverbrauch' : name,
                  ]}
                  labelFormatter={(label: number) => `${Number(label).toFixed(1)}°C`}
                />
                <Scatter dataKey="consumption" fill="#1B5E7B" opacity={0.6} />
                {regressionLineData.length === 2 && (
                  <Line
                    data={regressionLineData}
                    dataKey="regression"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    dot={false}
                    type="linear"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
            <p className="mt-2 text-xs text-gray-400 text-center">
              Jeder Punkt entspricht einem Tag. {data.regression ? `Positive Steigung = mehr Verbrauch bei Kälte.` : ''}
            </p>
          </div>
        </>
      )}

      {!loading && data && data.points.length === 0 && (
        <div className="flex h-60 items-center justify-center text-gray-400">
          Keine Schnittmenge aus Verbrauchs- und Wetterdaten gefunden
        </div>
      )}

      {!loading && !data && meterId && (
        <div className="flex h-60 items-center justify-center text-gray-400">Keine Daten vorhanden</div>
      )}
      {!loading && !meterId && (
        <div className="flex h-60 items-center justify-center text-gray-400">Bitte Zähler auswählen</div>
      )}
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts';
import { RefreshCw } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';

/* ── Typen ── */

interface Meter {
  id: string;
  name: string;
  energy_type: string;
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

const TABS = [
  { key: 'timeseries', label: 'Zeitreihen' },
  { key: 'comparison', label: 'Vergleich' },
  { key: 'distribution', label: 'Verteilung' },
  { key: 'heatmap', label: 'Heatmap' },
  { key: 'sankey', label: 'Sankey' },
  { key: 'weather', label: 'Witterungskorrektur' },
  { key: 'co2path', label: 'CO₂-Pfad' },
  { key: 'anomalies', label: 'Anomalien' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

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

export default function AnalyticsPage() {
  const [tab, setTab] = useState<TabKey>('timeseries');
  const [meters, setMeters] = useState<Meter[]>([]);

  useEffect(() => {
    apiClient.get('/api/v1/meters').then((res) => {
      const items = res.data.items || res.data;
      setMeters(Array.isArray(items) ? items : []);
    });
  }, []);

  return (
    <div>
      <h1 className="page-title">Analysen</h1>
      <p className="mt-1 text-sm text-gray-500">
        Erweiterte Auswertungen und Visualisierungen der Energiedaten.
      </p>

      {/* Tabs */}
      <div className="mt-4 flex flex-wrap gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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

      <div className="mt-6">
        {tab === 'timeseries' && <TimeSeriesTab meters={meters} />}
        {tab === 'comparison' && <ComparisonTab meters={meters} />}
        {tab === 'distribution' && <DistributionTab />}
        {tab === 'heatmap' && <HeatmapTab meters={meters} />}
        {tab === 'sankey' && <SankeyTab />}
        {tab === 'weather' && <WeatherCorrectionTab meters={meters} />}
        {tab === 'co2path' && <CO2PathTab />}
        {tab === 'anomalies' && <AnomaliesTab />}
      </div>
    </div>
  );
}

/* ── Tab: Zeitreihen ── */

function TimeSeriesTab({ meters }: { meters: Meter[] }) {
  const [data, setData] = useState<TimeSeriesMeter[]>([]);
  const [selectedMeter, setSelectedMeter] = useState('');
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [granularity, setGranularity] = useState('daily');
  const [loading, setLoading] = useState(false);
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('line');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        start_date: startDate,
        end_date: endDate,
        granularity,
      };
      if (selectedMeter) params.meter_ids = selectedMeter;
      const res = await apiClient.get('/api/v1/analytics/timeseries', { params });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [selectedMeter, startDate, endDate, granularity]);

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
          <label className="label">Zähler</label>
          <select className="input" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">Alle Hauptzähler</option>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
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
              <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
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
            Keine Daten für den gewählten Zeitraum
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Vergleich ── */

function ComparisonTab({ meters }: { meters: Meter[] }) {
  const [selectedMeter, setSelectedMeter] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const thisYear = new Date().getFullYear();

  const fetchComparison = async () => {
    if (!selectedMeter) return;
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/comparison', {
        params: {
          meter_ids: selectedMeter,
          period1_start: `${thisYear - 1}-01-01`,
          period1_end: `${thisYear - 1}-12-31`,
          period2_start: `${thisYear}-01-01`,
          period2_end: `${thisYear}-12-31`,
          granularity: 'monthly',
        },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  };

  useEffect(() => { if (selectedMeter) fetchComparison(); }, [selectedMeter]);

  // Vergleichsdaten aufbereiten
  const chartData: { label: string; vorjahr: number; aktuell: number }[] = [];
  if (data) {
    const p1 = (data.period1 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
    const p2 = (data.period2 as Record<string, unknown>)?.data as Record<string, { period: string; value: number }[]> | undefined;
    if (p1 && p2) {
      const d1 = p1[selectedMeter] || [];
      const d2 = p2[selectedMeter] || [];
      const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
      for (let i = 0; i < 12; i++) {
        chartData.push({
          label: months[i],
          vorjahr: d1[i]?.value || 0,
          aktuell: d2[i]?.value || 0,
        });
      }
    }
  }

  return (
    <div>
      <div className="mb-6">
        <label className="label">Zähler auswählen</label>
        <select className="input w-64" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
          <option value="">— Bitte wählen —</option>
          {meters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Jahresvergleich {thisYear - 1} vs. {thisYear}</h2>
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
            {selectedMeter ? 'Keine Vergleichsdaten vorhanden' : 'Bitte Zähler auswählen'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Tab: Verteilung ── */

function DistributionTab() {
  const [data, setData] = useState<DistributionItem[]>([]);
  const [groupBy, setGroupBy] = useState('energy_type');
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/distribution', {
        params: { start_date: startDate, end_date: endDate, group_by: groupBy },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [startDate, endDate, groupBy]);

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
                <Tooltip formatter={(val: number) => [`${formatNumber(val)} kWh`, '']} />
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
                    <span className="text-sm font-semibold text-gray-900">{formatNumber(item.value)} kWh</span>
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
  const [selectedMeter, setSelectedMeter] = useState('');
  const [data, setData] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);

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
      <div className="mb-6">
        <label className="label">Zähler auswählen</label>
        <select className="input w-64" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
          <option value="">— Bitte wählen —</option>
          {meters.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
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

function SankeyTab() {
  const [data, setData] = useState<SankeyData | null>(null);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/analytics/sankey', {
        params: { start_date: startDate, end_date: endDate },
      });
      setData(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, [startDate, endDate]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const nodeColors: Record<string, string> = {
    quelle: '#3B82F6',
    hauptzaehler: '#1B5E7B',
    unterzaehler: '#10B981',
    verbraucher: '#F59E0B',
  };

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
      </div>

      <div className="card">
        <h2 className="mb-4 text-lg font-semibold">Energieflussdiagramm</h2>
        {loading ? (
          <div className="flex h-80 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : data && data.nodes.length > 0 ? (
          <div>
            {/* Vereinfachte Sankey-Darstellung als Treemap + Link-Tabelle */}
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Knoten nach Typ gruppiert */}
              {['quelle', 'hauptzaehler', 'unterzaehler', 'verbraucher'].map((type) => {
                const nodesOfType = data.nodes.filter((n) => n.type === type);
                if (nodesOfType.length === 0) return null;
                const typeLabels: Record<string, string> = {
                  quelle: 'Energiequellen',
                  hauptzaehler: 'Hauptzähler',
                  unterzaehler: 'Unterzähler',
                  verbraucher: 'Verbraucher',
                };
                return (
                  <div key={type}>
                    <h3 className="mb-2 text-sm font-medium text-gray-500">{typeLabels[type]}</h3>
                    <div className="space-y-1">
                      {nodesOfType.map((node) => {
                        // Summe der eingehenden Links
                        const nodeIdx = data.nodes.indexOf(node);
                        const inFlow = data.links
                          .filter((l) => l.target === nodeIdx)
                          .reduce((s, l) => s + l.value, 0);
                        const outFlow = data.links
                          .filter((l) => l.source === nodeIdx)
                          .reduce((s, l) => s + l.value, 0);
                        const flow = Math.max(inFlow, outFlow);

                        return (
                          <div
                            key={node.id}
                            className="rounded-lg border p-3"
                            style={{ borderLeftColor: nodeColors[type], borderLeftWidth: 4 }}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-medium">{node.label}</span>
                              <span className="text-sm text-gray-500">
                                {flow > 0 ? `${formatNumber(flow)} kWh` : '–'}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Verbindungen */}
            {data.links.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-2 text-sm font-medium text-gray-500">Energieflüsse</h3>
                <div className="space-y-1">
                  {data.links.map((link, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-700">{data.nodes[link.source]?.label}</span>
                      <span className="text-gray-400">→</span>
                      <span className="font-medium text-gray-700">{data.nodes[link.target]?.label}</span>
                      <span className="ml-auto text-gray-500">{formatNumber(link.value)} kWh</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
  const [selectedMeter, setSelectedMeter] = useState('');
  const [data, setData] = useState<WeatherCorrectedData | null>(null);
  const [startDate, setStartDate] = useState(yearStart());
  const [endDate, setEndDate] = useState(today());
  const [loading, setLoading] = useState(false);

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
          <label className="label">Zähler</label>
          <select className="input w-64" value={selectedMeter} onChange={(e) => setSelectedMeter(e.target.value)}>
            <option value="">— Bitte wählen —</option>
            {meters.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
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
          <label className="label">Schwellwert (σ)</label>
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

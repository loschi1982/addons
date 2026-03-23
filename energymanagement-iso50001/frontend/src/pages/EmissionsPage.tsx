import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType } from '@/types';

// ── Typen ──

interface EmissionFactorSource {
  id: string;
  name: string;
  source_type: string;
  description: string | null;
  url: string | null;
  is_default: boolean;
}

interface EmissionFactor {
  id: string;
  source_id: string;
  energy_type: string;
  year: number;
  month: number | null;
  region: string | null;
  co2_g_per_kwh: number;
  scope: string | null;
  source_name: string | null;
}

interface CO2Summary {
  period_start: string;
  period_end: string;
  total_co2_kg: number;
  total_consumption_kwh: number;
  avg_co2_g_per_kwh: number;
  by_energy_type: Array<{ energy_type: string; co2_kg: number; consumption_kwh: number }>;
  by_scope: Array<{ scope: string; co2_kg: number }>;
  trend_vs_previous: number | null;
}

interface CO2Dashboard {
  current_year: CO2Summary | null;
  previous_year: CO2Summary | null;
  monthly_trend: Array<{ month: number; year: number; co2_kg: number }>;
  scope_breakdown: Record<string, number>;
}

interface FactorForm {
  source_id: string;
  energy_type: string;
  year: string;
  co2_g_per_kwh: string;
  scope: string;
}

type Tab = 'dashboard' | 'factors' | 'calculate';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const SCOPE_LABELS: Record<string, string> = {
  scope_1: 'Scope 1 (direkt)',
  scope_2: 'Scope 2 (Strom/Wärme)',
  scope_3: 'Scope 3 (Vorketten)',
};

// ── Komponente ──

export default function EmissionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div>
      <div>
        <h1 className="page-title">CO\u2082-Emissionen</h1>
        <p className="mt-1 text-sm text-gray-500">
          CO\u2082-Bilanzierung, Emissionsfaktoren und Reduktionsziele
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            ['dashboard', 'Dashboard'],
            ['factors', 'Emissionsfaktoren'],
            ['calculate', 'Berechnung'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`pb-2 text-sm font-medium ${
                activeTab === key
                  ? 'border-b-2 border-primary-600 text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-4">
        {activeTab === 'dashboard' && <DashboardPanel />}
        {activeTab === 'factors' && <FactorsPanel />}
        {activeTab === 'calculate' && <CalculatePanel />}
      </div>
    </div>
  );
}

// ── Dashboard ──

function DashboardPanel() {
  const [dashboard, setDashboard] = useState<CO2Dashboard | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<CO2Dashboard>(`/api/v1/emissions/dashboard?year=${year}`);
      setDashboard(res.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) return <div className="card text-gray-400">Laden...</div>;
  if (!dashboard) return <div className="card text-gray-400">Keine Daten verfügbar.</div>;

  const current = dashboard.current_year;
  const previous = dashboard.previous_year;

  return (
    <div className="space-y-4">
      {/* Jahr-Auswahl */}
      <div className="flex items-center gap-4">
        <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
          {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-4 gap-4">
        <KPICard
          label="CO\u2082 Gesamt"
          value={current ? `${(Number(current.total_co2_kg) / 1000).toFixed(1)} t` : '0 t'}
          subtitle={current?.trend_vs_previous != null
            ? `${Number(current.trend_vs_previous) > 0 ? '+' : ''}${Number(current.trend_vs_previous).toFixed(1)} % vs. Vorjahr`
            : undefined}
          trend={current?.trend_vs_previous ?? undefined}
        />
        <KPICard
          label="Verbrauch gesamt"
          value={current ? `${(Number(current.total_consumption_kwh) / 1000).toFixed(0)} MWh` : '0 MWh'}
        />
        <KPICard
          label="Durchschn. Faktor"
          value={current ? `${Number(current.avg_co2_g_per_kwh).toFixed(0)} g/kWh` : '–'}
        />
        <KPICard
          label="Vorjahr CO\u2082"
          value={previous ? `${(Number(previous.total_co2_kg) / 1000).toFixed(1)} t` : '–'}
          subtitle={`${year - 1}`}
        />
      </div>

      {/* Monatlicher Verlauf */}
      {dashboard.monthly_trend.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">CO\u2082-Emissionen pro Monat ({year})</h3>
          <div className="flex items-end gap-1 h-44">
            {dashboard.monthly_trend.map((m) => {
              const maxCO2 = Math.max(...dashboard.monthly_trend.map((d) => d.co2_kg), 1);
              const height = (m.co2_kg / maxCO2) * 100;
              return (
                <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-[10px] text-gray-500 font-mono">
                    {m.co2_kg > 0 ? (m.co2_kg / 1000).toFixed(1) : ''}
                  </div>
                  <div
                    className="w-full rounded-t bg-emerald-500"
                    style={{ height: `${height}%`, minHeight: m.co2_kg > 0 ? '2px' : '0' }}
                  />
                  <div className="text-[10px] text-gray-500">{MONTHS[m.month - 1]}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-1 text-right text-[10px] text-gray-400">in Tonnen CO\u2082</div>
        </div>
      )}

      {/* Nach Energietyp */}
      {current && current.by_energy_type.length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Verteilung nach Energieträger</h3>
          <div className="space-y-2">
            {current.by_energy_type.map((et) => {
              const pct = current.total_co2_kg > 0
                ? (et.co2_kg / current.total_co2_kg) * 100
                : 0;
              return (
                <div key={et.energy_type} className="flex items-center gap-3">
                  <span className="w-24 text-sm truncate">
                    {ENERGY_TYPE_LABELS[et.energy_type as EnergyType] || et.energy_type}
                  </span>
                  <div className="flex-1 h-5 rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="w-20 text-right text-sm font-mono">
                    {(et.co2_kg / 1000).toFixed(2)} t
                  </span>
                  <span className="w-14 text-right text-xs text-gray-500">
                    {pct.toFixed(1)} %
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scope-Aufschlüsselung */}
      {Object.keys(dashboard.scope_breakdown).length > 0 && (
        <div className="card">
          <h3 className="mb-3 text-sm font-semibold">Scope-Aufschlüsselung</h3>
          <div className="grid grid-cols-3 gap-4">
            {Object.entries(dashboard.scope_breakdown).map(([scope, co2]) => (
              <div key={scope} className="rounded-lg border bg-gray-50 p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">
                  {(co2 / 1000).toFixed(2)} t
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {SCOPE_LABELS[scope] || scope}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Emissionsfaktoren ──

function FactorsPanel() {
  const [sources, setSources] = useState<EmissionFactorSource[]>([]);
  const [factors, setFactors] = useState<EmissionFactor[]>([]);
  const [filterType, setFilterType] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FactorForm>({
    source_id: '',
    energy_type: 'electricity',
    year: new Date().getFullYear().toString(),
    co2_g_per_kwh: '',
    scope: 'scope_2',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.append('energy_type', filterType);
      if (filterYear) params.append('year', filterYear);
      const [factorsRes, sourcesRes] = await Promise.all([
        apiClient.get<EmissionFactor[]>(`/api/v1/emissions/factors?${params}`),
        apiClient.get<EmissionFactorSource[]>('/api/v1/emissions/factors/sources'),
      ]);
      setFactors(factorsRes.data);
      setSources(sourcesRes.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [filterType, filterYear]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiClient.post('/api/v1/emissions/factors', {
        source_id: form.source_id,
        energy_type: form.energy_type,
        year: parseInt(form.year),
        co2_g_per_kwh: parseFloat(form.co2_g_per_kwh.replace(',', '.')),
        scope: form.scope,
      });
      setShowModal(false);
      loadFactors();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="card flex gap-4 items-end">
        <div>
          <label className="label">Energieträger</label>
          <select className="input w-40" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            <option value="">Alle</option>
            {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Jahr</label>
          <input type="number" className="input w-24" placeholder="z.B. 2024"
            value={filterYear} onChange={(e) => setFilterYear(e.target.value)} />
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">+ Neuer Faktor</button>
      </div>

      {/* Quellen */}
      {sources.length > 0 && (
        <div className="card">
          <h3 className="mb-2 text-sm font-semibold">Datenquellen</h3>
          <div className="flex flex-wrap gap-2">
            {sources.map((s) => (
              <span key={s.id} className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {s.name}
                {s.is_default && <span className="ml-1 text-primary-600">(Standard)</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Faktor-Tabelle */}
      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : factors.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Keine Emissionsfaktoren gefunden. Importieren Sie die BAFA-Standardwerte oder legen Sie eigene Faktoren an.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Energieträger</th>
                <th className="px-4 py-2 text-right">g CO\u2082/kWh</th>
                <th className="px-4 py-2 text-center">Jahr</th>
                <th className="px-4 py-2 text-left">Scope</th>
                <th className="px-4 py-2 text-left">Quelle</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {factors.map((f) => (
                <tr key={f.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">
                    {ENERGY_TYPE_LABELS[f.energy_type as EnergyType] || f.energy_type}
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-bold">{Number(f.co2_g_per_kwh).toFixed(1)}</td>
                  <td className="px-4 py-2 text-center">{f.year}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      {SCOPE_LABELS[f.scope || ''] || f.scope || '–'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">{f.source_name || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Neuer Faktor */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Neuer Emissionsfaktor</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>
              )}

              <div>
                <label className="label">Quelle *</label>
                <select className="input" required value={form.source_id}
                  onChange={(e) => setForm({ ...form, source_id: e.target.value })}>
                  <option value="">– Quelle wählen –</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Energieträger *</label>
                  <select className="input" value={form.energy_type}
                    onChange={(e) => setForm({ ...form, energy_type: e.target.value })}>
                    {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Jahr *</label>
                  <input type="number" className="input" required value={form.year}
                    onChange={(e) => setForm({ ...form, year: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">g CO\u2082/kWh *</label>
                  <input type="text" className="input" required placeholder="z.B. 363"
                    value={form.co2_g_per_kwh}
                    onChange={(e) => setForm({ ...form, co2_g_per_kwh: e.target.value })} />
                </div>
                <div>
                  <label className="label">Scope</label>
                  <select className="input" value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Speichern...' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Berechnung ──

function CalculatePanel() {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<{ message: string; calculated?: number; errors?: number } | null>(null);

  const handleCalculate = async () => {
    setCalculating(true);
    setResult(null);
    try {
      const res = await apiClient.post(
        `/api/v1/emissions/calculate?start_date=${startDate}&end_date=${endDate}`
      );
      setResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setResult({ message: error.response?.data?.detail || 'Fehler bei der Berechnung' });
    } finally {
      setCalculating(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">CO\u2082-Neuberechnung</h2>
      <p className="mb-4 text-sm text-gray-500">
        Berechnet die CO\u2082-Emissionen für alle aktiven Zähler im gewählten Zeitraum
        basierend auf den hinterlegten Emissionsfaktoren.
      </p>

      <div className="flex gap-4 items-end mb-4">
        <div>
          <label className="label">Von</label>
          <input type="date" className="input" value={startDate}
            onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Bis</label>
          <input type="date" className="input" value={endDate}
            onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button onClick={handleCalculate} className="btn-primary" disabled={calculating}>
          {calculating ? 'Berechne...' : 'Berechnung starten'}
        </button>
      </div>

      {result && (
        <div className={`rounded-lg p-4 ${result.errors ? 'bg-yellow-50' : 'bg-green-50'}`}>
          <p className={`font-medium ${result.errors ? 'text-yellow-700' : 'text-green-700'}`}>
            {result.message}
          </p>
          {result.calculated != null && (
            <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
              <div>Berechnet: <b className="text-green-600">{result.calculated}</b></div>
              <div>Fehler: <b className={result.errors ? 'text-red-600' : 'text-gray-500'}>{result.errors ?? 0}</b></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Hilfs-Komponenten ──

function KPICard({
  label,
  value,
  subtitle,
  trend,
}: {
  label: string;
  value: string;
  subtitle?: string;
  trend?: number;
}) {
  return (
    <div className="card text-center">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {subtitle && (
        <div className={`text-xs mt-1 ${
          trend != null
            ? trend > 0 ? 'text-red-500' : 'text-green-600'
            : 'text-gray-400'
        }`}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

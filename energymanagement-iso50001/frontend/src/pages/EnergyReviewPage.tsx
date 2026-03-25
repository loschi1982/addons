/**
 * EnergyReviewPage – Energiebewertung nach ISO 50001 Kap. 6.3–6.5.
 *
 * Tabs: SEU | EnPI | Baseline | Variablen
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';
import InfoTip from '@/components/ui/InfoTip';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ── Typen ──

interface SEU {
  id: string;
  consumer_id: string | null;
  name: string;
  energy_type: string;
  determination_method: string;
  determination_criteria: string | null;
  consumption_share_percent: number | null;
  annual_consumption_kwh: number | null;
  monitoring_requirements: string[] | null;
  responsible_person: string | null;
  consumer_name: string | null;
  is_active: boolean;
  created_at: string;
}

interface SEUSuggestion {
  consumer_id: string;
  consumer_name: string;
  energy_type: string;
  consumption_kwh: number;
  share_percent: number;
  suggested_reason: string;
}

interface EnPI {
  id: string;
  name: string;
  description: string | null;
  formula_type: string;
  unit: string;
  numerator_meter_ids: string[];
  denominator_variable_id: string | null;
  denominator_fixed_value: number | null;
  seu_id: string | null;
  target_value: number | null;
  target_direction: string;
  latest_value: number | null;
  is_active: boolean;
  created_at: string;
}

interface EnPITrendPoint {
  period_start: string;
  period_end: string;
  enpi_value: number;
  baseline_value: number | null;
}

interface Baseline {
  id: string;
  enpi_id: string;
  name: string;
  period_start: string;
  period_end: string;
  baseline_value: number;
  total_consumption_kwh: number | null;
  adjustment_factors: unknown[] | null;
  adjusted_baseline_value: number | null;
  is_current: boolean;
  revision_reason: string | null;
  created_at: string;
}

interface BaselineComparison {
  enpi_id: string;
  enpi_name: string;
  baseline_value: number | null;
  current_value: number | null;
  improvement_percent: number | null;
  target_value: number | null;
}

interface Variable {
  id: string;
  name: string;
  variable_type: string;
  unit: string;
  description: string | null;
  data_source: string | null;
  latest_value: number | null;
  is_active: boolean;
  created_at: string;
}

interface VariableValue {
  id: string;
  variable_id: string;
  period_start: string;
  period_end: string;
  value: number;
  source: string;
}

interface Consumer {
  id: string;
  name: string;
  category: string;
}

interface Meter {
  id: string;
  name: string;
  energy_type: string;
}

type Tab = 'seu' | 'enpi' | 'baseline' | 'variables';

const VARIABLE_TYPES: Record<string, string> = {
  weather_hdd: 'Heizgradtage',
  production: 'Produktionsmenge',
  occupancy: 'Belegung',
  operating_hours: 'Betriebsstunden',
  area: 'Fläche',
  custom: 'Benutzerdefiniert',
};

const FORMULA_TYPES: Record<string, string> = {
  specific: 'Spezifisch (kWh/Bezug)',
  ratio: 'Verhältnis',
  absolute: 'Absolut (kWh)',
};

const DETERMINATION_METHODS: Record<string, string> = {
  auto_threshold: 'Automatisch (Schwellwert)',
  manual: 'Manuell',
  pareto: 'Pareto-Analyse',
};

// ── Hauptkomponente ──

export default function EnergyReviewPage() {
  const [activeTab, setActiveTab] = useState<Tab>('seu');

  return (
    <div>
      <div>
        <h1 className="page-title">Energiebewertung</h1>
        <p className="mt-1 text-sm text-gray-500">
          ISO 50001 Kap. 6.3–6.5: SEU, EnPI, Baseline und relevante Variablen
        </p>
      </div>

      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            ['seu', 'Wesentliche Energieeinsätze'],
            ['enpi', 'Energieleistungskennzahlen'],
            ['baseline', 'Energetische Ausgangsbasis'],
            ['variables', 'Relevante Variablen'],
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
        {activeTab === 'seu' && <SEUTab />}
        {activeTab === 'enpi' && <EnPITab />}
        {activeTab === 'baseline' && <BaselineTab />}
        {activeTab === 'variables' && <VariablesTab />}
      </div>
    </div>
  );
}


// ══════════════════════════════════════════════
// Tab 1: Wesentliche Energieeinsätze (SEU)
// ══════════════════════════════════════════════

function SEUTab() {
  const [seus, setSeus] = useState<SEU[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestions, setSuggestions] = useState<SEUSuggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [consumers, setConsumers] = useState<Consumer[]>([]);

  const [form, setForm] = useState({
    name: '', consumer_id: '', energy_type: 'electricity',
    determination_method: 'manual', determination_criteria: '',
    responsible_person: '', notes: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSEUs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<SEU>>('/api/v1/energy-review/seu');
      setSeus(res.data.items);
      setTotal(res.data.total);
    } catch { /* interceptor */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadSEUs(); }, [loadSEUs]);

  const handleCreate = () => {
    setEditingId(null);
    setForm({ name: '', consumer_id: '', energy_type: 'electricity', determination_method: 'manual', determination_criteria: '', responsible_person: '', notes: '' });
    setFormError(null);
    setShowModal(true);
    // Consumer laden
    apiClient.get('/api/v1/consumers?page_size=100&is_active=true')
      .then(r => setConsumers(r.data.items || []))
      .catch(() => {});
  };

  const handleEdit = (seu: SEU) => {
    setEditingId(seu.id);
    setForm({
      name: seu.name,
      consumer_id: seu.consumer_id || '',
      energy_type: seu.energy_type,
      determination_method: seu.determination_method,
      determination_criteria: seu.determination_criteria || '',
      responsible_person: seu.responsible_person || '',
      notes: '',
    });
    setFormError(null);
    setShowModal(true);
    apiClient.get('/api/v1/consumers?page_size=100&is_active=true')
      .then(r => setConsumers(r.data.items || []))
      .catch(() => {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name,
      consumer_id: form.consumer_id || null,
      energy_type: form.energy_type,
      determination_method: form.determination_method,
      determination_criteria: form.determination_criteria || null,
      responsible_person: form.responsible_person || null,
    };
    try {
      if (editingId) {
        await apiClient.put(`/api/v1/energy-review/seu/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/energy-review/seu', payload);
      }
      setShowModal(false);
      loadSEUs();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDelete = async (seu: SEU) => {
    if (!confirm(`SEU "${seu.name}" wirklich deaktivieren?`)) return;
    try { await apiClient.delete(`/api/v1/energy-review/seu/${seu.id}`); loadSEUs(); } catch { /* */ }
  };

  const handleSuggest = async () => {
    setSugLoading(true);
    try {
      const res = await apiClient.get('/api/v1/energy-review/seu/suggestions?threshold=5');
      setSuggestions(res.data);
      setShowSuggestions(true);
    } catch { /* */ } finally { setSugLoading(false); }
  };

  const handleAcceptSuggestion = async (s: SEUSuggestion) => {
    try {
      await apiClient.post('/api/v1/energy-review/seu', {
        consumer_id: s.consumer_id,
        name: s.consumer_name,
        energy_type: s.energy_type,
        determination_method: 'auto_threshold',
        determination_criteria: s.suggested_reason,
      });
      setSuggestions(prev => prev.filter(x => x.consumer_id !== s.consumer_id));
      loadSEUs();
    } catch { /* */ }
  };

  const handleRecalculate = async () => {
    try {
      const res = await apiClient.post('/api/v1/energy-review/seu/recalculate');
      alert(`${res.data.updated} SEU-Anteile aktualisiert`);
      loadSEUs();
    } catch { alert('Fehler bei Neuberechnung'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {total} wesentliche Energieeinsätze
          <InfoTip title="SEU-Anteil" formula="SEU-Verbrauch ÷ Gesamt × 100">
            Anteil des wesentlichen Energieeinsatzes am Gesamtverbrauch in Prozent.
          </InfoTip>
        </p>
        <div className="flex gap-2">
          <button onClick={handleRecalculate} className="btn-secondary text-sm">Anteile berechnen</button>
          <button onClick={handleSuggest} disabled={sugLoading} className="btn-secondary text-sm">
            {sugLoading ? 'Analysiere...' : 'Vorschläge generieren'}
          </button>
          <button onClick={handleCreate} className="btn-primary">+ Neuer SEU</button>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : seus.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Keine SEUs definiert. Nutzen Sie &quot;Vorschläge generieren&quot; für automatische Erkennung.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Energieart</th>
                <th className="px-4 py-3">Anteil</th>
                <th className="px-4 py-3">Verbrauch</th>
                <th className="px-4 py-3">Methode</th>
                <th className="px-4 py-3">Verantwortlich</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {seus.map(seu => (
                <tr key={seu.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">
                    {seu.name}
                    {seu.consumer_name && <span className="text-xs text-gray-400 ml-1">({seu.consumer_name})</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {ENERGY_TYPE_LABELS[seu.energy_type as EnergyType] || seu.energy_type}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {seu.consumption_share_percent != null ? (
                      <ShareBadge percent={Number(seu.consumption_share_percent)} />
                    ) : '–'}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {seu.annual_consumption_kwh != null ? `${Number(seu.annual_consumption_kwh).toFixed(0)} kWh` : '–'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {DETERMINATION_METHODS[seu.determination_method] || seu.determination_method}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{seu.responsible_person || '–'}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button onClick={() => handleEdit(seu)} className="text-primary-600 hover:text-primary-800 text-sm">Bearbeiten</button>
                    <button onClick={() => handleDelete(seu)} className="text-red-500 hover:text-red-700 text-sm">Löschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Vorschläge Modal */}
      {showSuggestions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">SEU-Vorschläge</h2>
            {suggestions.length === 0 ? (
              <p className="text-gray-400 text-sm py-4">Keine weiteren Vorschläge. Alle Verbraucher über dem Schwellwert sind bereits als SEU erfasst.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {suggestions.map(s => (
                  <div key={s.consumer_id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <p className="font-medium text-sm">{s.consumer_name}</p>
                      <p className="text-xs text-gray-500">{s.suggested_reason}</p>
                      <p className="text-xs font-mono text-gray-400">{Number(s.consumption_kwh).toFixed(0)} kWh</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ShareBadge percent={Number(s.share_percent)} />
                      <button onClick={() => handleAcceptSuggestion(s)} className="btn-primary text-xs px-2 py-1">Übernehmen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <button onClick={() => setShowSuggestions(false)} className="btn-secondary">Schließen</button>
            </div>
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'SEU bearbeiten' : 'Neuer SEU'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="label">Name *</label>
                <input type="text" className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Verbraucher</label>
                  <select className="input" value={form.consumer_id} onChange={e => {
                    const c = consumers.find(x => x.id === e.target.value);
                    setForm({ ...form, consumer_id: e.target.value, name: form.name || c?.name || '' });
                  }}>
                    <option value="">– Kein Verbraucher –</option>
                    {consumers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Energieart *</label>
                  <select className="input" value={form.energy_type} onChange={e => setForm({ ...form, energy_type: e.target.value })}>
                    {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Bestimmungsmethode</label>
                  <select className="input" value={form.determination_method} onChange={e => setForm({ ...form, determination_method: e.target.value })}>
                    {Object.entries(DETERMINATION_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Verantwortlich</label>
                  <input type="text" className="input" value={form.responsible_person} onChange={e => setForm({ ...form, responsible_person: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Begründung / Kriterien</label>
                <textarea className="input" rows={2} value={form.determination_criteria} onChange={e => setForm({ ...form, determination_criteria: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareBadge({ percent }: { percent: number }) {
  let color = 'bg-yellow-100 text-yellow-700';
  if (percent >= 20) color = 'bg-red-100 text-red-700';
  else if (percent >= 10) color = 'bg-orange-100 text-orange-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>
      {percent.toFixed(1)}%
    </span>
  );
}


// ══════════════════════════════════════════════
// Tab 2: Energieleistungskennzahlen (EnPI)
// ══════════════════════════════════════════════

function EnPITab() {
  const [enpis, setEnpis] = useState<EnPI[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedEnpi, setSelectedEnpi] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<EnPITrendPoint[]>([]);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [variables, setVariables] = useState<Variable[]>([]);

  const [form, setForm] = useState({
    name: '', description: '', formula_type: 'specific', unit: 'kWh/m²',
    numerator_meter_ids: [] as string[], denominator_variable_id: '',
    denominator_fixed_value: '', target_value: '', target_direction: 'lower',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadEnpis = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<EnPI>>('/api/v1/energy-review/enpi');
      setEnpis(res.data.items);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadEnpis(); }, [loadEnpis]);

  const handleCreate = () => {
    setEditingId(null);
    setForm({ name: '', description: '', formula_type: 'specific', unit: 'kWh/m²', numerator_meter_ids: [], denominator_variable_id: '', denominator_fixed_value: '', target_value: '', target_direction: 'lower' });
    setFormError(null);
    setShowModal(true);
    apiClient.get('/api/v1/meters?page_size=100&is_active=true').then(r => setMeters(r.data.items || [])).catch(() => {});
    apiClient.get('/api/v1/energy-review/variables').then(r => setVariables(r.data.items || [])).catch(() => {});
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name,
      description: form.description || null,
      formula_type: form.formula_type,
      unit: form.unit,
      numerator_meter_ids: form.numerator_meter_ids,
      denominator_variable_id: form.denominator_variable_id || null,
      denominator_fixed_value: form.denominator_fixed_value ? parseFloat(form.denominator_fixed_value) : null,
      target_value: form.target_value ? parseFloat(form.target_value) : null,
      target_direction: form.target_direction,
    };
    try {
      if (editingId) {
        await apiClient.put(`/api/v1/energy-review/enpi/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/energy-review/enpi', payload);
      }
      setShowModal(false);
      loadEnpis();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDelete = async (enpi: EnPI) => {
    if (!confirm(`EnPI "${enpi.name}" wirklich deaktivieren?`)) return;
    try { await apiClient.delete(`/api/v1/energy-review/enpi/${enpi.id}`); loadEnpis(); } catch { /* */ }
  };

  const handleCalculate = async (enpi: EnPI) => {
    const now = new Date();
    const start = `${now.getFullYear()}-01-01`;
    const end = `${now.getFullYear()}-12-31`;
    try {
      await apiClient.post(`/api/v1/energy-review/enpi/${enpi.id}/calculate?period_start=${start}&period_end=${end}`);
      loadEnpis();
    } catch { alert('Berechnung fehlgeschlagen. Prüfen Sie Zähler und Bezugswerte.'); }
  };

  const handleShowTrend = async (enpiId: string) => {
    if (selectedEnpi === enpiId) { setSelectedEnpi(null); return; }
    setSelectedEnpi(enpiId);
    try {
      const res = await apiClient.get(`/api/v1/energy-review/enpi/${enpiId}/trend`);
      setTrendData(res.data);
    } catch { setTrendData([]); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">
          {enpis.length} Kennzahlen
          <InfoTip title="EnPI" formula="Verbrauch_kWh ÷ Bezugsgröße">
            Energieleistungskennzahl, z.B. kWh/m², kWh/Stück. Misst die Energieeffizienz bezogen auf eine relevante Variable.
          </InfoTip>
        </p>
        <button onClick={handleCreate} className="btn-primary">+ Neue Kennzahl</button>
      </div>

      {loading ? (
        <div className="card text-gray-400 text-center py-8">Laden...</div>
      ) : enpis.length === 0 ? (
        <div className="card text-gray-400 text-center py-8">Keine EnPIs definiert.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {enpis.map(enpi => (
            <div key={enpi.id} className="card">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{enpi.name}</h3>
                  <p className="text-xs text-gray-400">{FORMULA_TYPES[enpi.formula_type] || enpi.formula_type}</p>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold">
                    {enpi.latest_value != null ? Number(enpi.latest_value).toFixed(2) : '–'}
                  </div>
                  <div className="text-xs text-gray-500">{enpi.unit}</div>
                </div>
              </div>
              {enpi.target_value != null && (
                <div className="mt-2 text-xs text-gray-500">
                  Ziel: {Number(enpi.target_value).toFixed(2)} {enpi.unit}
                  {enpi.latest_value != null && (
                    <span className={Number(enpi.latest_value) <= Number(enpi.target_value) ? ' text-green-600 font-medium' : ' text-red-600 font-medium'}>
                      {Number(enpi.latest_value) <= Number(enpi.target_value) ? ' (erreicht)' : ' (verfehlt)'}
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-2 mt-3 pt-3 border-t">
                <button onClick={() => handleCalculate(enpi)} className="text-xs text-primary-600 hover:text-primary-800">Berechnen</button>
                <button onClick={() => handleShowTrend(enpi.id)} className="text-xs text-primary-600 hover:text-primary-800">
                  {selectedEnpi === enpi.id ? 'Trend ausblenden' : 'Trend'}
                </button>
                <div className="flex-1" />
                <button onClick={() => handleDelete(enpi)} className="text-xs text-red-500 hover:text-red-700">Löschen</button>
              </div>

              {selectedEnpi === enpi.id && trendData.length > 0 && (
                <div className="mt-3 pt-3 border-t">
                  <ResponsiveContainer width="100%" height={150}>
                    <LineChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period_start" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Line type="monotone" dataKey="enpi_value" stroke="#1B5E7B" strokeWidth={2} dot={{ r: 3 }} name="EnPI" />
                      {trendData[0]?.baseline_value != null && (
                        <ReferenceLine y={Number(trendData[0].baseline_value)} stroke="#F59E0B" strokeDasharray="5 5" label="Baseline" />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'EnPI bearbeiten' : 'Neue Kennzahl'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="label">Name *</label>
                <input type="text" className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Spezifischer Stromverbrauch" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Formeltyp</label>
                  <select className="input" value={form.formula_type} onChange={e => setForm({ ...form, formula_type: e.target.value })}>
                    {Object.entries(FORMULA_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Einheit *</label>
                  <input type="text" className="input" required value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="kWh/m²" />
                </div>
              </div>
              <div>
                <label className="label">Zähler (Numerator) *</label>
                <select className="input mb-2" value="" onChange={e => {
                  if (e.target.value && !form.numerator_meter_ids.includes(e.target.value)) {
                    setForm({ ...form, numerator_meter_ids: [...form.numerator_meter_ids, e.target.value] });
                  }
                }}>
                  <option value="">+ Zähler hinzufügen</option>
                  {meters.filter(m => !form.numerator_meter_ids.includes(m.id)).map(m => (
                    <option key={m.id} value={m.id}>{m.name} – {ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type}</option>
                  ))}
                </select>
                {form.numerator_meter_ids.map(id => {
                  const m = meters.find(x => x.id === id);
                  return (
                    <div key={id} className="flex items-center gap-2 text-sm py-1">
                      <span className="flex-1">{m?.name || id}</span>
                      <button type="button" className="text-red-500 text-xs" onClick={() => setForm({ ...form, numerator_meter_ids: form.numerator_meter_ids.filter(x => x !== id) })}>Entfernen</button>
                    </div>
                  );
                })}
              </div>
              {form.formula_type !== 'absolute' && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <p className="text-sm font-medium text-gray-700 mb-3">Bezugsgröße (Denominator)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="label">Variable</label>
                      <select className="input" value={form.denominator_variable_id} onChange={e => setForm({ ...form, denominator_variable_id: e.target.value })}>
                        <option value="">– Keine Variable –</option>
                        {variables.map(v => <option key={v.id} value={v.id}>{v.name} ({v.unit})</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label">Oder: fester Wert</label>
                      <input type="number" step="any" className="input" value={form.denominator_fixed_value} onChange={e => setForm({ ...form, denominator_fixed_value: e.target.value })} placeholder="z.B. 500 (m²)" />
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Zielwert</label>
                  <input type="number" step="any" className="input" value={form.target_value} onChange={e => setForm({ ...form, target_value: e.target.value })} />
                </div>
                <div>
                  <label className="label">Richtung</label>
                  <select className="input" value={form.target_direction} onChange={e => setForm({ ...form, target_direction: e.target.value })}>
                    <option value="lower">Weniger ist besser</option>
                    <option value="higher">Mehr ist besser</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════
// Tab 3: Energetische Ausgangsbasis (Baseline)
// ══════════════════════════════════════════════

function BaselineTab() {
  const [baselines, setBaselines] = useState<Baseline[]>([]);
  const [enpis, setEnpis] = useState<EnPI[]>([]);
  const [comparisons, setComparisons] = useState<BaselineComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ enpi_id: '', name: '', period_start: '', period_end: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, eRes] = await Promise.all([
        apiClient.get('/api/v1/energy-review/baselines'),
        apiClient.get<PaginatedResponse<EnPI>>('/api/v1/energy-review/enpi'),
      ]);
      setBaselines(bRes.data);
      setEnpis(eRes.data.items);

      // Vergleiche für alle aktiven Baselines laden
      const now = new Date();
      const start = `${now.getFullYear()}-01-01`;
      const end = `${now.getFullYear()}-12-31`;
      const currentBaselines = (bRes.data as Baseline[]).filter(b => b.is_current);
      const comps: BaselineComparison[] = [];
      for (const b of currentBaselines) {
        try {
          const cRes = await apiClient.get(`/api/v1/energy-review/baselines/${b.id}/comparison?period_start=${start}&period_end=${end}`);
          comps.push(cRes.data);
        } catch { /* */ }
      }
      setComparisons(comps);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = () => {
    const year = new Date().getFullYear() - 1;
    setForm({ enpi_id: '', name: `Baseline ${year}`, period_start: `${year}-01-01`, period_end: `${year}-12-31` });
    setFormError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await apiClient.post('/api/v1/energy-review/baselines', {
        enpi_id: form.enpi_id,
        name: form.name,
        period_start: form.period_start,
        period_end: form.period_end,
      });
      setShowModal(false);
      load();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Anlegen');
    } finally { setSaving(false); }
  };

  // Chart-Daten für Vergleich
  const chartData = comparisons
    .filter(c => c.baseline_value != null && c.current_value != null)
    .map(c => ({
      name: c.enpi_name,
      baseline: Number(c.baseline_value),
      aktuell: Number(c.current_value),
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {baselines.length} Baselines
          <InfoTip title="Baseline-Abweichung" formula="(EnPI_aktuell − EnPI_basis) ÷ EnPI_basis × 100">
            Prozentuale Abweichung der aktuellen Energieleistungskennzahl von der energetischen Ausgangsbasis.
          </InfoTip>
        </p>
        <button onClick={handleCreate} className="btn-primary">+ Neue Baseline</button>
      </div>

      {loading ? (
        <div className="card text-gray-400 text-center py-8">Laden...</div>
      ) : (
        <>
          {/* Vergleichs-Chart */}
          {chartData.length > 0 && (
            <div className="card">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Baseline vs. Aktuell</h3>
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="baseline" fill="#94a3b8" name="Baseline" />
                  <Bar dataKey="aktuell" fill="#1B5E7B" name="Aktuell" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Vergleichstabelle */}
          {comparisons.length > 0 && (
            <div className="card overflow-hidden p-0">
              <div className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">Baseline-Vergleich (lfd. Jahr)</div>
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">EnPI</th>
                    <th className="px-4 py-2 text-right">Baseline</th>
                    <th className="px-4 py-2 text-right">Aktuell</th>
                    <th className="px-4 py-2 text-right">Veränderung</th>
                    <th className="px-4 py-2 text-right">Ziel</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {comparisons.map(c => (
                    <tr key={c.enpi_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{c.enpi_name}</td>
                      <td className="px-4 py-2 text-right font-mono">{c.baseline_value != null ? Number(c.baseline_value).toFixed(2) : '–'}</td>
                      <td className="px-4 py-2 text-right font-mono">{c.current_value != null ? Number(c.current_value).toFixed(2) : '–'}</td>
                      <td className="px-4 py-2 text-right font-mono">
                        {c.improvement_percent != null ? (
                          <span className={Number(c.improvement_percent) >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {Number(c.improvement_percent) >= 0 ? '+' : ''}{Number(c.improvement_percent).toFixed(1)}%
                          </span>
                        ) : '–'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-gray-500">
                        {c.target_value != null ? Number(c.target_value).toFixed(2) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Baseline-Liste */}
          <div className="card overflow-hidden p-0">
            <div className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">Alle Baselines</div>
            {baselines.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Keine Baselines definiert. Erstellen Sie zuerst EnPIs und berechnen Sie deren Werte.</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Name</th>
                    <th className="px-4 py-2 text-left">EnPI</th>
                    <th className="px-4 py-2 text-right">Zeitraum</th>
                    <th className="px-4 py-2 text-right">Wert</th>
                    <th className="px-4 py-2 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {baselines.map(b => {
                    const enpi = enpis.find(e => e.id === b.enpi_id);
                    return (
                      <tr key={b.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{b.name}</td>
                        <td className="px-4 py-2 text-gray-500">{enpi?.name || '–'}</td>
                        <td className="px-4 py-2 text-right text-xs font-mono">{b.period_start} – {b.period_end}</td>
                        <td className="px-4 py-2 text-right font-mono">{Number(b.baseline_value).toFixed(2)}</td>
                        <td className="px-4 py-2 text-center">
                          {b.is_current ? (
                            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Aktiv</span>
                          ) : (
                            <span className="text-xs text-gray-400">Ersetzt</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Neue Baseline</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="label">EnPI *</label>
                <select className="input" required value={form.enpi_id} onChange={e => setForm({ ...form, enpi_id: e.target.value })}>
                  <option value="">– EnPI wählen –</option>
                  {enpis.map(e => <option key={e.id} value={e.id}>{e.name} ({e.unit})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Name</label>
                <input type="text" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Beginn *</label>
                  <input type="date" className="input" required value={form.period_start} onChange={e => setForm({ ...form, period_start: e.target.value })} />
                </div>
                <div>
                  <label className="label">Ende *</label>
                  <input type="date" className="input" required value={form.period_end} onChange={e => setForm({ ...form, period_end: e.target.value })} />
                </div>
              </div>
              <p className="text-xs text-gray-500">Der Baseline-Wert wird automatisch aus den EnPI-Werten im gewählten Zeitraum berechnet.</p>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}


// ══════════════════════════════════════════════
// Tab 4: Relevante Variablen
// ══════════════════════════════════════════════

function VariablesTab() {
  const [variables, setVariables] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [values, setValues] = useState<VariableValue[]>([]);

  const [form, setForm] = useState({
    name: '', variable_type: 'weather_hdd', unit: 'Kd', description: '', data_source: 'manual',
  });
  const [valueForm, setValueForm] = useState({ period_start: '', period_end: '', value: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadVariables = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<Variable>>('/api/v1/energy-review/variables');
      setVariables(res.data.items);
    } catch { /* */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadVariables(); }, [loadVariables]);

  const handleCreate = () => {
    setEditingId(null);
    setForm({ name: '', variable_type: 'weather_hdd', unit: 'Kd', description: '', data_source: 'manual' });
    setFormError(null);
    setShowModal(true);
  };

  const handleEdit = (v: Variable) => {
    setEditingId(v.id);
    setForm({
      name: v.name, variable_type: v.variable_type, unit: v.unit,
      description: v.description || '', data_source: v.data_source || 'manual',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name, variable_type: form.variable_type, unit: form.unit,
      description: form.description || null, data_source: form.data_source,
    };
    try {
      if (editingId) {
        await apiClient.put(`/api/v1/energy-review/variables/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/energy-review/variables', payload);
      }
      setShowModal(false);
      loadVariables();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDelete = async (v: Variable) => {
    if (!confirm(`Variable "${v.name}" wirklich deaktivieren?`)) return;
    try { await apiClient.delete(`/api/v1/energy-review/variables/${v.id}`); loadVariables(); } catch { /* */ }
  };

  const handleExpand = async (variableId: string) => {
    if (expandedId === variableId) { setExpandedId(null); return; }
    setExpandedId(variableId);
    try {
      const res = await apiClient.get(`/api/v1/energy-review/variables/${variableId}/values`);
      setValues(res.data);
    } catch { setValues([]); }
  };

  const handleAddValue = async (variableId: string) => {
    if (!valueForm.period_start || !valueForm.period_end || !valueForm.value) return;
    try {
      await apiClient.post(`/api/v1/energy-review/variables/${variableId}/values`, {
        period_start: valueForm.period_start,
        period_end: valueForm.period_end,
        value: parseFloat(valueForm.value),
      });
      setValueForm({ period_start: '', period_end: '', value: '' });
      // Reload values
      const res = await apiClient.get(`/api/v1/energy-review/variables/${variableId}/values`);
      setValues(res.data);
      loadVariables();
    } catch { /* */ }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{variables.length} Variablen</p>
        <button onClick={handleCreate} className="btn-primary">+ Neue Variable</button>
      </div>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : variables.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Keine Variablen definiert.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Einheit</th>
                <th className="px-4 py-3">Letzter Wert</th>
                <th className="px-4 py-3">Quelle</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {variables.map(v => (
                <>
                  <tr key={v.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => handleExpand(v.id)}>
                    <td className="px-4 py-3 font-medium">{v.name}</td>
                    <td className="px-4 py-3 text-gray-500">{VARIABLE_TYPES[v.variable_type] || v.variable_type}</td>
                    <td className="px-4 py-3 text-gray-500">{v.unit}</td>
                    <td className="px-4 py-3 font-mono">{v.latest_value != null ? Number(v.latest_value).toFixed(1) : '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{v.data_source || '–'}</td>
                    <td className="px-4 py-3 text-right space-x-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => handleEdit(v)} className="text-primary-600 hover:text-primary-800 text-sm">Bearbeiten</button>
                      <button onClick={() => handleDelete(v)} className="text-red-500 hover:text-red-700 text-sm">Löschen</button>
                    </td>
                  </tr>
                  {expandedId === v.id && (
                    <tr key={`${v.id}-values`}>
                      <td colSpan={6} className="bg-gray-50 px-4 py-3">
                        <div className="flex gap-2 mb-3">
                          <input type="date" className="input w-36" value={valueForm.period_start} onChange={e => setValueForm({ ...valueForm, period_start: e.target.value })} />
                          <span className="self-center text-gray-400">–</span>
                          <input type="date" className="input w-36" value={valueForm.period_end} onChange={e => setValueForm({ ...valueForm, period_end: e.target.value })} />
                          <input type="number" step="any" className="input w-24" placeholder="Wert" value={valueForm.value} onChange={e => setValueForm({ ...valueForm, value: e.target.value })} />
                          <button onClick={() => handleAddValue(v.id)} className="btn-primary text-xs">Hinzufügen</button>
                        </div>
                        {values.length === 0 ? (
                          <p className="text-xs text-gray-400">Keine Werte vorhanden.</p>
                        ) : (
                          <div className="max-h-48 overflow-y-auto">
                            <table className="w-full text-xs">
                              <thead className="text-gray-500">
                                <tr>
                                  <th className="text-left py-1">Zeitraum</th>
                                  <th className="text-right py-1">Wert</th>
                                  <th className="text-left py-1 pl-4">Quelle</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {values.map(val => (
                                  <tr key={val.id}>
                                    <td className="py-1">{val.period_start} – {val.period_end}</td>
                                    <td className="py-1 text-right font-mono">{Number(val.value).toFixed(2)} {v.unit}</td>
                                    <td className="py-1 pl-4 text-gray-400">{val.source}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'Variable bearbeiten' : 'Neue Variable'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="label">Name *</label>
                <input type="text" className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="z.B. Heizgradtage" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Typ *</label>
                  <select className="input" value={form.variable_type} onChange={e => {
                    const units: Record<string, string> = { weather_hdd: 'Kd', production: 'Stk', occupancy: 'Pers.', operating_hours: 'h', area: 'm²', custom: '' };
                    setForm({ ...form, variable_type: e.target.value, unit: units[e.target.value] || form.unit });
                  }}>
                    {Object.entries(VARIABLE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Einheit *</label>
                  <input type="text" className="input" required value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Beschreibung</label>
                <textarea className="input" rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

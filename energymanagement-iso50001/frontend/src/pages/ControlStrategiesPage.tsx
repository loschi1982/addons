/**
 * ControlStrategiesPage – BMS-Regelstrategien und Sollwert-Vergleich (ISO 50001 Kap. 8).
 */

import { useState, useEffect, useCallback } from 'react';
import { SlidersHorizontal, Plus, X, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { apiClient } from '@/utils/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface Strategy {
  id: string;
  name: string;
  description: string;
  strategy_type: string;
  building_name: string | null;
  usage_unit_name: string | null;
  setpoint_heating: number | null;
  setpoint_cooling: number | null;
  setpoint_night_reduction: number | null;
  max_co2_ppm: number | null;
  operating_days: string[];
  operating_time_start: string | null;
  operating_time_end: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  ha_entity_id: string | null;
  notes: string;
}

interface ComplianceReport {
  strategy_id: string;
  strategy_name: string;
  period_start: string;
  period_end: string;
  setpoint_heating: number | null;
  setpoint_cooling: number | null;
  max_co2_ppm: number | null;
  avg_temperature: number | null;
  avg_co2_ppm: number | null;
  temp_compliant: boolean | null;
  co2_compliant: boolean | null;
  sensor_count: number;
  note?: string;
}

const STRATEGY_TYPE_LABELS: Record<string, string> = {
  heating: 'Heizung',
  cooling: 'Kühlung',
  ventilation: 'Lüftung',
  lighting: 'Beleuchtung',
  combined: 'Kombiniert',
};

const DAY_LABELS: Record<string, string> = {
  mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So',
};

const emptyForm = {
  name: '',
  description: '',
  strategy_type: 'heating',
  setpoint_heating: '',
  setpoint_cooling: '',
  setpoint_night_reduction: '',
  max_co2_ppm: '',
  operating_time_start: '06:00',
  operating_time_end: '22:00',
  operating_days: ['mon', 'tue', 'wed', 'thu', 'fri'] as string[],
  ha_entity_id: '',
  is_active: true,
  notes: '',
};

function ComplianceBadge({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-gray-400 text-xs">–</span>;
  if (value) return <span className="flex items-center gap-1 text-green-600 text-xs"><CheckCircle size={14} /> Konform</span>;
  return <span className="flex items-center gap-1 text-red-600 text-xs"><XCircle size={14} /> Abweichung</span>;
}

export default function ControlStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [complianceStart, setComplianceStart] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [complianceEnd, setComplianceEnd] = useState(() => new Date().toISOString().split('T')[0]);
  const [compliance, setCompliance] = useState<ComplianceReport | null>(null);
  const [loadingCompliance, setLoadingCompliance] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ items: Strategy[]; total: number }>('/api/v1/control-strategies?page_size=50');
      setStrategies(res.data.items);
      setTotal(res.data.total);
    } catch {
      setError('Regelstrategien konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (s: Strategy) => {
    setEditing(s);
    setForm({
      name: s.name,
      description: s.description ?? '',
      strategy_type: s.strategy_type,
      setpoint_heating: s.setpoint_heating != null ? String(s.setpoint_heating) : '',
      setpoint_cooling: s.setpoint_cooling != null ? String(s.setpoint_cooling) : '',
      setpoint_night_reduction: s.setpoint_night_reduction != null ? String(s.setpoint_night_reduction) : '',
      max_co2_ppm: s.max_co2_ppm != null ? String(s.max_co2_ppm) : '',
      operating_time_start: s.operating_time_start ?? '06:00',
      operating_time_end: s.operating_time_end ?? '22:00',
      operating_days: s.operating_days ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
      ha_entity_id: s.ha_entity_id ?? '',
      is_active: s.is_active,
      notes: s.notes ?? '',
    });
    setShowForm(true);
  };

  const toggleDay = (day: string) => {
    setForm(f => ({
      ...f,
      operating_days: f.operating_days.includes(day)
        ? f.operating_days.filter(d => d !== day)
        : [...f.operating_days, day],
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        setpoint_heating: form.setpoint_heating ? Number(form.setpoint_heating) : null,
        setpoint_cooling: form.setpoint_cooling ? Number(form.setpoint_cooling) : null,
        setpoint_night_reduction: form.setpoint_night_reduction ? Number(form.setpoint_night_reduction) : null,
        max_co2_ppm: form.max_co2_ppm ? Number(form.max_co2_ppm) : null,
        ha_entity_id: form.ha_entity_id || null,
      };
      if (editing) {
        await apiClient.put(`/api/v1/control-strategies/${editing.id}`, payload);
      } else {
        await apiClient.post('/api/v1/control-strategies', payload);
      }
      setShowForm(false);
      loadData();
    } catch {
      setError('Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Regelstrategie wirklich deaktivieren?')) return;
    try {
      await apiClient.delete(`/api/v1/control-strategies/${id}`);
      loadData();
    } catch {
      setError('Deaktivieren fehlgeschlagen.');
    }
  };

  const loadCompliance = async (s: Strategy) => {
    setSelectedStrategy(s);
    setCompliance(null);
    setLoadingCompliance(true);
    try {
      const params = new URLSearchParams({ period_start: complianceStart, period_end: complianceEnd });
      const res = await apiClient.get<ComplianceReport>(`/api/v1/control-strategies/${s.id}/compliance?${params}`);
      setCompliance(res.data);
    } catch {
      setError('Soll-/Ist-Vergleich fehlgeschlagen.');
    } finally {
      setLoadingCompliance(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <SlidersHorizontal size={24} className="text-primary-600" />
          <h1 className="page-title">BMS-Regelstrategien</h1>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openCreate}>
          <Plus size={16} /> Regelstrategie anlegen
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Strategieliste */}
        <div className="lg:col-span-2 card">
          {loading ? (
            <LoadingSpinner />
          ) : strategies.length === 0 ? (
            <div className="py-12 text-center text-gray-500">Keine Regelstrategien angelegt.</div>
          ) : (
            <div className="space-y-3">
              {strategies.map((s) => (
                <div
                  key={s.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedStrategy?.id === s.id
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                  onClick={() => loadCompliance(s)}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{s.name}</span>
                        {!s.is_active && (
                          <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Inaktiv</span>
                        )}
                        <span className="text-xs bg-primary-100 text-primary-700 px-1.5 py-0.5 rounded">
                          {STRATEGY_TYPE_LABELS[s.strategy_type] ?? s.strategy_type}
                        </span>
                      </div>
                      {s.description && <p className="text-sm text-gray-500 mt-1">{s.description}</p>}
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-600">
                        {s.setpoint_heating != null && (
                          <span>Heiz-Soll: <strong>{s.setpoint_heating} °C</strong></span>
                        )}
                        {s.setpoint_cooling != null && (
                          <span>Kühl-Soll: <strong>{s.setpoint_cooling} °C</strong></span>
                        )}
                        {s.max_co2_ppm != null && (
                          <span>CO₂-Max: <strong>{s.max_co2_ppm} ppm</strong></span>
                        )}
                        {s.operating_time_start && s.operating_time_end && (
                          <span>Betrieb: <strong>{s.operating_time_start}–{s.operating_time_end}</strong></span>
                        )}
                        {s.usage_unit_name && <span>Einheit: <strong>{s.usage_unit_name}</strong></span>}
                        {s.building_name && <span>Gebäude: <strong>{s.building_name}</strong></span>}
                      </div>
                      {s.operating_days.length > 0 && (
                        <div className="flex gap-1 mt-2">
                          {['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => (
                            <span
                              key={d}
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                s.operating_days.includes(d)
                                  ? 'bg-primary-600 text-white'
                                  : 'bg-gray-100 text-gray-400'
                              }`}
                            >
                              {DAY_LABELS[d]}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2 ml-4 shrink-0">
                      <button
                        className="text-primary-600 hover:text-primary-800 text-xs"
                        onClick={(e) => { e.stopPropagation(); openEdit(s); }}
                      >
                        Bearbeiten
                      </button>
                      <button
                        className="text-red-500 hover:text-red-700 text-xs"
                        onClick={(e) => { e.stopPropagation(); handleDelete(s.id); }}
                      >
                        Deaktivieren
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {total > 0 && (
            <p className="text-xs text-gray-400 mt-3">{total} Regelstrategien gesamt</p>
          )}
        </div>

        {/* Soll-/Ist-Vergleich */}
        <div className="card">
          <h2 className="font-semibold text-gray-800 mb-4">Soll-/Ist-Vergleich</h2>
          {!selectedStrategy ? (
            <p className="text-sm text-gray-500">Regelstrategie aus der Liste auswählen.</p>
          ) : (
            <>
              <p className="text-sm font-medium text-primary-700 mb-3">{selectedStrategy.name}</p>
              <div className="space-y-3">
                <div>
                  <label className="label">Von</label>
                  <input
                    type="date"
                    className="input"
                    value={complianceStart}
                    onChange={(e) => setComplianceStart(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">Bis</label>
                  <input
                    type="date"
                    className="input"
                    value={complianceEnd}
                    onChange={(e) => setComplianceEnd(e.target.value)}
                  />
                </div>
                <button
                  className="btn-primary w-full text-sm"
                  onClick={() => loadCompliance(selectedStrategy)}
                  disabled={loadingCompliance}
                >
                  {loadingCompliance ? 'Analysiere...' : 'Vergleich laden'}
                </button>
              </div>

              {compliance && (
                <div className="mt-4 space-y-4">
                  {compliance.note && (
                    <div className="flex items-start gap-2 text-sm text-yellow-700 bg-yellow-50 rounded p-3">
                      <AlertCircle size={16} className="shrink-0 mt-0.5" />
                      <span>{compliance.note}</span>
                    </div>
                  )}
                  <div className="text-xs text-gray-500">
                    {compliance.sensor_count} Sensor{compliance.sensor_count !== 1 ? 'en' : ''}
                  </div>

                  {compliance.setpoint_heating != null && (
                    <div className="border rounded p-3">
                      <div className="text-xs text-gray-500 mb-1">Temperatur (Heizung)</div>
                      <div className="flex justify-between text-sm">
                        <div>
                          <span className="text-gray-600">Soll:</span>{' '}
                          <strong>{compliance.setpoint_heating} °C</strong>
                        </div>
                        <div>
                          <span className="text-gray-600">Ist:</span>{' '}
                          <strong>
                            {compliance.avg_temperature != null ? `${compliance.avg_temperature} °C` : '–'}
                          </strong>
                        </div>
                      </div>
                      <div className="mt-2">
                        <ComplianceBadge value={compliance.temp_compliant} />
                        {compliance.temp_compliant === false && compliance.avg_temperature != null && (
                          <span className="text-xs text-red-600 ml-2">
                            Δ {(compliance.avg_temperature - compliance.setpoint_heating).toFixed(1)} K
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {compliance.max_co2_ppm != null && (
                    <div className="border rounded p-3">
                      <div className="text-xs text-gray-500 mb-1">CO₂-Konzentration</div>
                      <div className="flex justify-between text-sm">
                        <div>
                          <span className="text-gray-600">Max:</span>{' '}
                          <strong>{compliance.max_co2_ppm} ppm</strong>
                        </div>
                        <div>
                          <span className="text-gray-600">Ist:</span>{' '}
                          <strong>
                            {compliance.avg_co2_ppm != null ? `${compliance.avg_co2_ppm} ppm` : '–'}
                          </strong>
                        </div>
                      </div>
                      <div className="mt-2">
                        <ComplianceBadge value={compliance.co2_compliant} />
                        {compliance.co2_compliant === false && compliance.avg_co2_ppm != null && (
                          <span className="text-xs text-red-600 ml-2">
                            +{(compliance.avg_co2_ppm - compliance.max_co2_ppm).toFixed(0)} ppm
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Formular-Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">
                {editing ? 'Regelstrategie bearbeiten' : 'Neue Regelstrategie'}
              </h2>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="label">Name *</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Typ</label>
                  <select
                    className="input"
                    value={form.strategy_type}
                    onChange={(e) => setForm(f => ({ ...f, strategy_type: e.target.value }))}
                  >
                    {Object.entries(STRATEGY_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">HA Entity-ID (optional)</label>
                  <input
                    className="input"
                    placeholder="climate.buro_eg"
                    value={form.ha_entity_id}
                    onChange={(e) => setForm(f => ({ ...f, ha_entity_id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Heiz-Sollwert (°C)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    placeholder="21"
                    value={form.setpoint_heating}
                    onChange={(e) => setForm(f => ({ ...f, setpoint_heating: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Kühl-Sollwert (°C)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    placeholder="26"
                    value={form.setpoint_cooling}
                    onChange={(e) => setForm(f => ({ ...f, setpoint_cooling: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Nachtabsenkung (K)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    placeholder="3"
                    value={form.setpoint_night_reduction}
                    onChange={(e) => setForm(f => ({ ...f, setpoint_night_reduction: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">CO₂-Maximum (ppm)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="1000"
                    value={form.max_co2_ppm}
                    onChange={(e) => setForm(f => ({ ...f, max_co2_ppm: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Betrieb von</label>
                  <input
                    type="time"
                    className="input"
                    value={form.operating_time_start}
                    onChange={(e) => setForm(f => ({ ...f, operating_time_start: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Betrieb bis</label>
                  <input
                    type="time"
                    className="input"
                    value={form.operating_time_end}
                    onChange={(e) => setForm(f => ({ ...f, operating_time_end: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Betriebstage</label>
                  <div className="flex gap-2 mt-1">
                    {Object.entries(DAY_LABELS).map(([d, label]) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => toggleDay(d)}
                        className={`w-9 h-9 rounded text-sm font-medium transition-colors ${
                          form.operating_days.includes(d)
                            ? 'bg-primary-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="label">Beschreibung</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={form.description}
                    onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Notizen</label>
                  <textarea
                    className="input"
                    rows={2}
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_active"
                    checked={form.is_active}
                    onChange={(e) => setForm(f => ({ ...f, is_active: e.target.checked }))}
                  />
                  <label htmlFor="is_active" className="text-sm text-gray-700">Aktiv</label>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Abbrechen</button>
              <button
                className="btn-primary"
                onClick={handleSave}
                disabled={saving || !form.name}
              >
                {saving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

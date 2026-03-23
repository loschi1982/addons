import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import { type PaginatedResponse } from '@/types';
import DiscoveryModal from '@/components/DiscoveryModal';

// ── Typen ──

interface ClimateSensor {
  id: string;
  name: string;
  sensor_type: string;
  location: string | null;
  zone: string | null;
  ha_entity_id_temp: string | null;
  ha_entity_id_humidity: string | null;
  data_source: string;
  target_temp_min: number | null;
  target_temp_max: number | null;
  target_humidity_min: number | null;
  target_humidity_max: number | null;
  is_active: boolean;
  created_at: string;
}

interface ClimateReading {
  id: string;
  sensor_id: string;
  timestamp: string;
  temperature: number | null;
  humidity: number | null;
  dew_point: number | null;
  source: string;
  quality: string;
}

interface ZoneSummary {
  zone: string;
  avg_temperature: number;
  min_temperature: number;
  max_temperature: number;
  avg_humidity: number;
  comfort_score: number | null;
}

interface SensorForm {
  name: string;
  sensor_type: string;
  location: string;
  zone: string;
  ha_entity_id_temp: string;
  ha_entity_id_humidity: string;
  data_source: string;
  target_temp_min: string;
  target_temp_max: string;
  target_humidity_min: string;
  target_humidity_max: string;
}

const emptySensorForm: SensorForm = {
  name: '',
  sensor_type: 'temperature_humidity',
  location: '',
  zone: '',
  ha_entity_id_temp: '',
  ha_entity_id_humidity: '',
  data_source: 'manual',
  target_temp_min: '20',
  target_temp_max: '24',
  target_humidity_min: '40',
  target_humidity_max: '60',
};

const SENSOR_TYPES: Record<string, string> = {
  temperature: 'Temperatur',
  humidity: 'Luftfeuchtigkeit',
  temperature_humidity: 'Temperatur + Feuchte',
};

const DATA_SOURCES: Record<string, string> = {
  manual: 'Manuell',
  homeassistant: 'Home Assistant',
  modbus: 'Modbus',
  knx: 'KNX',
};

type Tab = 'sensors' | 'readings' | 'comfort';

// ── Komponente ──

export default function ClimatePage() {
  const [activeTab, setActiveTab] = useState<Tab>('sensors');

  return (
    <div>
      <div>
        <h1 className="page-title">Klimasensoren</h1>
        <p className="mt-1 text-sm text-gray-500">
          Innenraum-Klimadaten, Behaglichkeitsanalyse und Komfort-Score
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            ['sensors', 'Sensoren'],
            ['readings', 'Messwerte'],
            ['comfort', 'Komfort-Dashboard'],
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
        {activeTab === 'sensors' && <SensorsPanel />}
        {activeTab === 'readings' && <ReadingsPanel />}
        {activeTab === 'comfort' && <ComfortPanel />}
      </div>
    </div>
  );
}

// ── Sensoren ──

function SensorsPanel() {
  const [sensors, setSensors] = useState<ClimateSensor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [form, setForm] = useState<SensorForm>(emptySensorForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadSensors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<ClimateSensor>>(
        '/api/v1/climate/sensors?page_size=50'
      );
      setSensors(res.data.items);
      setTotal(res.data.total);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSensors();
  }, [loadSensors]);

  const handleCreate = () => {
    setForm(emptySensorForm);
    setFormError(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiClient.post('/api/v1/climate/sensors', {
        name: form.name,
        sensor_type: form.sensor_type,
        location: form.location || null,
        zone: form.zone || null,
        ha_entity_id_temp: form.ha_entity_id_temp || null,
        ha_entity_id_humidity: form.ha_entity_id_humidity || null,
        data_source: form.data_source,
        target_temp_min: form.target_temp_min ? parseFloat(form.target_temp_min) : null,
        target_temp_max: form.target_temp_max ? parseFloat(form.target_temp_max) : null,
        target_humidity_min: form.target_humidity_min ? parseFloat(form.target_humidity_min) : null,
        target_humidity_max: form.target_humidity_max ? parseFloat(form.target_humidity_max) : null,
      });
      setShowModal(false);
      loadSensors();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (sensor: ClimateSensor) => {
    if (!confirm(`Sensor "${sensor.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/climate/sensors/${sensor.id}`);
      loadSensors();
    } catch {
      // Interceptor
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{total} Sensoren</p>
        <div className="flex gap-2">
          <button onClick={() => setShowDiscovery(true)} className="btn-secondary">Sensoren entdecken</button>
          <button onClick={handleCreate} className="btn-primary">+ Neuer Sensor</button>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : sensors.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Keine Sensoren angelegt.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Typ</th>
                <th className="px-4 py-3">Zone</th>
                <th className="px-4 py-3">Quelle</th>
                <th className="px-4 py-3">Sollbereich</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {sensors.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3 text-gray-500">{SENSOR_TYPES[s.sensor_type] || s.sensor_type}</td>
                  <td className="px-4 py-3">
                    {s.zone ? (
                      <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                        {s.zone}
                      </span>
                    ) : '–'}
                  </td>
                  <td className="px-4 py-3 text-gray-500">{DATA_SOURCES[s.data_source] || s.data_source}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                    {s.target_temp_min && s.target_temp_max
                      ? `${s.target_temp_min}–${s.target_temp_max} °C`
                      : '–'}
                    {s.target_humidity_min && s.target_humidity_max
                      ? ` / ${s.target_humidity_min}–${s.target_humidity_max} %`
                      : ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDelete(s)} className="text-red-500 hover:text-red-700 text-sm">
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Discovery-Modal */}
      {showDiscovery && (
        <DiscoveryModal
          mode="climate"
          onClose={() => setShowDiscovery(false)}
          onCreated={loadSensors}
        />
      )}

      {/* Modal: Neuer Sensor */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Neuer Klimasensor</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Name *</label>
                  <input
                    type="text" className="input" required autoFocus
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Typ</label>
                  <select className="input" value={form.sensor_type}
                    onChange={(e) => setForm({ ...form, sensor_type: e.target.value })}>
                    {Object.entries(SENSOR_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Standort</label>
                  <input type="text" className="input" placeholder="z.B. Büro EG"
                    value={form.location}
                    onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div>
                  <label className="label">Zone</label>
                  <input type="text" className="input" placeholder="z.B. Heizzone 1"
                    value={form.zone}
                    onChange={(e) => setForm({ ...form, zone: e.target.value })} />
                </div>
              </div>

              <div>
                <label className="label">Datenquelle</label>
                <select className="input" value={form.data_source}
                  onChange={(e) => setForm({ ...form, data_source: e.target.value })}>
                  {Object.entries(DATA_SOURCES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {form.data_source === 'homeassistant' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">HA Entity-ID Temperatur</label>
                    <input type="text" className="input" placeholder="sensor.temp_buero"
                      value={form.ha_entity_id_temp}
                      onChange={(e) => setForm({ ...form, ha_entity_id_temp: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">HA Entity-ID Feuchte</label>
                    <input type="text" className="input" placeholder="sensor.humidity_buero"
                      value={form.ha_entity_id_humidity}
                      onChange={(e) => setForm({ ...form, ha_entity_id_humidity: e.target.value })} />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-4 gap-4">
                <div>
                  <label className="label">T_min (°C)</label>
                  <input type="number" step="0.1" className="input"
                    value={form.target_temp_min}
                    onChange={(e) => setForm({ ...form, target_temp_min: e.target.value })} />
                </div>
                <div>
                  <label className="label">T_max (°C)</label>
                  <input type="number" step="0.1" className="input"
                    value={form.target_temp_max}
                    onChange={(e) => setForm({ ...form, target_temp_max: e.target.value })} />
                </div>
                <div>
                  <label className="label">RH_min (%)</label>
                  <input type="number" step="1" className="input"
                    value={form.target_humidity_min}
                    onChange={(e) => setForm({ ...form, target_humidity_min: e.target.value })} />
                </div>
                <div>
                  <label className="label">RH_max (%)</label>
                  <input type="number" step="1" className="input"
                    value={form.target_humidity_max}
                    onChange={(e) => setForm({ ...form, target_humidity_max: e.target.value })} />
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

// ── Messwerte ──

function ReadingsPanel() {
  const [sensors, setSensors] = useState<ClimateSensor[]>([]);
  const [selectedSensor, setSelectedSensor] = useState('');
  const [readings, setReadings] = useState<ClimateReading[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<PaginatedResponse<ClimateSensor>>(
          '/api/v1/climate/sensors?page_size=100'
        );
        setSensors(res.data.items);
      } catch {
        // Interceptor
      }
    })();
  }, []);

  const loadReadings = useCallback(async () => {
    if (!selectedSensor) return;
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<ClimateReading>>(
        `/api/v1/climate/readings?sensor_id=${selectedSensor}&page_size=100`
      );
      setReadings(res.data.items);
      setTotal(res.data.total);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [selectedSensor]);

  useEffect(() => {
    if (selectedSensor) loadReadings();
  }, [loadReadings, selectedSensor]);

  return (
    <div className="space-y-4">
      <div className="card">
        <label className="label">Sensor auswählen</label>
        <select
          className="input max-w-md"
          value={selectedSensor}
          onChange={(e) => setSelectedSensor(e.target.value)}
        >
          <option value="">– Sensor wählen –</option>
          {sensors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.zone ? `(${s.zone})` : ''}
            </option>
          ))}
        </select>
      </div>

      {selectedSensor && (
        <div className="card overflow-hidden p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Laden...</div>
          ) : readings.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Keine Messwerte vorhanden.</div>
          ) : (
            <>
              <div className="max-h-[400px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Zeitpunkt</th>
                      <th className="px-3 py-2 text-right">Temperatur</th>
                      <th className="px-3 py-2 text-right">Feuchte</th>
                      <th className="px-3 py-2 text-right">Taupunkt</th>
                      <th className="px-3 py-2 text-left">Quelle</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {readings.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50">
                        <td className="px-3 py-1.5">
                          {new Date(r.timestamp).toLocaleString('de-DE', {
                            day: '2-digit', month: '2-digit', year: 'numeric',
                            hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {r.temperature != null ? `${Number(r.temperature).toFixed(1)} °C` : '–'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {r.humidity != null ? `${Number(r.humidity).toFixed(0)} %` : '–'}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-gray-500">
                          {r.dew_point != null ? `${Number(r.dew_point).toFixed(1)} °C` : '–'}
                        </td>
                        <td className="px-3 py-1.5 text-gray-500">{r.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-500">
                {total} Messwerte insgesamt
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Komfort-Dashboard ──

function ComfortPanel() {
  const [dashboard, setDashboard] = useState<{
    zones: ZoneSummary[];
    current_readings: ClimateReading[];
    alerts: Array<{ sensor_name: string; comfort_score: number; message: string }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/api/v1/climate/comfort');
        setDashboard(res.data);
      } catch {
        // Interceptor
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="card text-gray-400">Laden...</div>;
  if (!dashboard) return <div className="card text-gray-400">Keine Daten verfügbar.</div>;

  return (
    <div className="space-y-4">
      {/* Warnungen */}
      {dashboard.alerts.length > 0 && (
        <div className="space-y-2">
          {dashboard.alerts.map((alert, idx) => (
            <div key={idx} className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
              <span className="font-medium">{alert.sensor_name}:</span> {alert.message}
            </div>
          ))}
        </div>
      )}

      {/* Aktuelle Messwerte */}
      {dashboard.current_readings.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">Aktuelle Messwerte</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {dashboard.current_readings.map((r) => (
              <div key={r.id} className="card text-center">
                <div className="text-2xl font-bold">
                  {r.temperature != null ? `${Number(r.temperature).toFixed(1)} °C` : '–'}
                </div>
                {r.humidity != null && (
                  <div className="text-sm text-gray-500">{Number(r.humidity).toFixed(0)} % RH</div>
                )}
                <div className="text-xs text-gray-400 mt-1">
                  {new Date(r.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zonen-Übersicht */}
      {dashboard.zones.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">
            Zonen-Übersicht
          </div>
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Zone</th>
                <th className="px-4 py-2 text-right">T_avg</th>
                <th className="px-4 py-2 text-right">T_min</th>
                <th className="px-4 py-2 text-right">T_max</th>
                <th className="px-4 py-2 text-right">RH_avg</th>
                <th className="px-4 py-2 text-right">Komfort</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {dashboard.zones.map((z, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{z.zone}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(z.avg_temperature).toFixed(1)} °C</td>
                  <td className="px-4 py-2 text-right font-mono text-blue-600">{Number(z.min_temperature).toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-mono text-red-500">{Number(z.max_temperature).toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(z.avg_humidity).toFixed(0)} %</td>
                  <td className="px-4 py-2 text-right">
                    {z.comfort_score != null ? (
                      <ComfortBadge score={z.comfort_score} />
                    ) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dashboard.zones.length === 0 && dashboard.current_readings.length === 0 && (
        <div className="card text-center text-gray-400 py-8">
          Keine Klimadaten vorhanden. Legen Sie Sensoren an und erfassen Sie Messwerte.
        </div>
      )}
    </div>
  );
}

function ComfortBadge({ score }: { score: number }) {
  let color = 'bg-green-100 text-green-700';
  if (score < 50) color = 'bg-red-100 text-red-700';
  else if (score < 75) color = 'bg-yellow-100 text-yellow-700';

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${color}`}>
      {Number(score).toFixed(0)}
    </span>
  );
}

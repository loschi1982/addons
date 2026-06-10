import { useEffect, useState, useCallback } from 'react';
import {
  Gauge,
  Activity,
  RadioTower,
  Target,
  Home,
  Table as TableIcon,
  Thermometer,
  Plus,
  Search,
  Trash2,
  Info,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { type PaginatedResponse } from '@/types';
import DiscoveryModal from '@/components/DiscoveryModal';
import InfoTip from '@/components/ui/InfoTip';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';
import RadialScore from '@/components/umwelt/RadialScore';
import ComfortField, { type ComfortPoint } from '@/components/umwelt/ComfortField';
import MultiLine from '@/components/umwelt/MultiLine';

// ── Typen ──

interface ClimateSensor {
  id: string;
  name: string;
  sensor_type: string;
  location: string | null;
  zone: string | null;
  site_id: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
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
  site_id: string;
  building_id: string;
  usage_unit_id: string;
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
  site_id: '',
  building_id: '',
  usage_unit_id: '',
  ha_entity_id_temp: '',
  ha_entity_id_humidity: '',
  data_source: 'manual',
  target_temp_min: '20',
  target_temp_max: '24',
  target_humidity_min: '40',
  target_humidity_max: '60',
};

interface SiteOpt { id: string; name: string }
interface BuildingOpt { id: string; name: string; site_id: string }
interface UnitOpt { id: string; name: string; building_id: string }

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

const nf = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });

type ComfortStatus = 'good' | 'warn' | 'alert';
const scoreStatus = (s: number | null | undefined): ComfortStatus =>
  s == null ? 'warn' : s >= 75 ? 'good' : s >= 50 ? 'warn' : 'alert';
const STATUS_LABEL: Record<ComfortStatus, string> = { good: 'Behaglich', warn: 'Randbereich', alert: 'Unbehaglich' };
const STATUS_VAR: Record<ComfortStatus, string> = { good: 'var(--good)', warn: 'var(--warn)', alert: 'var(--alert)' };

type Tab = 'comfort' | 'readings' | 'sensors';

const TABS: Array<{ id: Tab; label: string; icon: typeof Gauge }> = [
  { id: 'comfort', label: 'Komfort', icon: Gauge },
  { id: 'readings', label: 'Messwerte', icon: Activity },
  { id: 'sensors', label: 'Sensoren', icon: RadioTower },
];

// ── Seite ──

export default function ClimatePage() {
  const [activeTab, setActiveTab] = useState<Tab>('comfort');

  return (
    <div className="umwelt">
      <PageHead eyebrow="Umwelt" title="Raumklima" />
      <div className="head-lead">
        Behaglichkeit und Luftqualität je Zone — Sensorik über Home Assistant, Modbus oder KNX, bewertet
        nach DIN EN 16798-1 (thermischer Komfort).
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={'tab' + (activeTab === t.id ? ' active' : '')}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={14} />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      <div className="content stack" style={{ paddingTop: 16 }}>
        {activeTab === 'comfort' && <ComfortPanel />}
        {activeTab === 'readings' && <ReadingsPanel />}
        {activeTab === 'sensors' && <SensorsPanel />}
      </div>
    </div>
  );
}

// ── Tab 1: Komfort ──

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

  if (loading) return <div className="card"><LoadingSpinner /></div>;
  if (!dashboard) return <div className="card text-gray-400">Keine Daten verfügbar.</div>;

  const { zones, current_readings, alerts } = dashboard;
  const scored = zones.filter((z) => z.comfort_score != null);
  const overallScore = scored.length
    ? scored.reduce((a, z) => a + (z.comfort_score || 0), 0) / scored.length
    : null;
  const zonesOk = zones.filter((z) => scoreStatus(z.comfort_score) === 'good').length;
  const zonesAlert = zones.filter((z) => scoreStatus(z.comfort_score) === 'alert').length;
  const fieldPoints: ComfortPoint[] = zones.map((z) => ({
    zone: z.zone,
    t: Number(z.avg_temperature),
    rh: Number(z.avg_humidity),
    status: scoreStatus(z.comfort_score),
  }));

  if (zones.length === 0 && current_readings.length === 0) {
    return (
      <div className="card">
        <div className="empty-state">
          <div className="mark"><Gauge size={20} /></div>
          <strong>Keine Klimadaten vorhanden</strong>
          <p>Lege im Tab „Sensoren" Klimasensoren an und erfasse Messwerte. Sobald Daten vorliegen, erscheinen hier Komfort-Index, Behaglichkeitsfeld und Zonen-Bewertung.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {/* Warnungen */}
      {alerts.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {alerts.map((alert, idx) => (
            <div key={idx} className="result-banner warn">
              <div className="result-icon"><Info size={18} /></div>
              <div style={{ flex: 1 }}>
                <div className="result-headline">{alert.sensor_name}</div>
                <div className="result-sub">{alert.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Score + Behaglichkeitsfeld */}
      <div className="comfort-grid">
        <div className="card score-card">
          <div className="card-title" style={{ alignSelf: 'flex-start' }}>
            <span className="ico"><Gauge size={15} /></span>Komfort-Index
          </div>
          {overallScore != null ? (
            <RadialScore value={overallScore} sub={`${scored.length} Zonen`} />
          ) : (
            <div className="empty-state" style={{ padding: '24px 8px' }}>
              <p>Noch kein Komfort-Score berechnet.</p>
            </div>
          )}
          <div className="score-caption">
            Gewichtet über alle Zonen nach Abweichung von Soll-Temperatur und -Feuchte (DIN EN 16798-1).
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title"><span className="ico"><Target size={15} /></span>Behaglichkeitsfeld</div>
              <div className="card-sub">
                Operative Temperatur × rel. Feuchte je Zone. Punkte im grünen Feld liegen im behaglichen
                Bereich nach DIN EN 16798-1.
              </div>
            </div>
          </div>
          {fieldPoints.length > 0 ? (
            <>
              <ComfortField points={fieldPoints} height={340} />
              <div className="chart-foot">
                <span className="legend-mini"><span className="dot st-good-bg" style={{ borderRadius: '50%' }} />behaglich</span>
                <span className="legend-mini"><span className="dot st-warn-bg" style={{ borderRadius: '50%' }} />Randbereich</span>
                <span className="legend-mini"><span className="dot st-alert-bg" style={{ borderRadius: '50%' }} />unbehaglich</span>
                <span className="chart-note" style={{ marginLeft: 'auto' }}>Punkt anklicken/hovern für Werte</span>
              </div>
            </>
          ) : (
            <div className="empty-state"><p>Keine Zonendaten für das Behaglichkeitsfeld.</p></div>
          )}
        </div>
      </div>

      {/* Aktuelle Messwerte */}
      {current_readings.length > 0 && (
        <div>
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div className="card-title"><span className="ico"><Activity size={15} /></span>Aktuelle Messwerte</div>
            <span className="scope-tag">{current_readings.length} Sensoren live</span>
          </div>
          <div className="metric-cards">
            {current_readings.map((r) => (
              <div className="metric-card" key={r.id} style={{ ['--accent' as string]: 'var(--fw-kaelte)' }}>
                <div className="metric-top">
                  <div className="metric-name">{r.source}</div>
                  <span className="metric-zone">
                    {new Date(r.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="metric-readings">
                  <div className="metric-reading">
                    <div className="v">{r.temperature != null ? nf(Number(r.temperature), 1) : '–'}<span className="u">°C</span></div>
                    <div className="l">Temp</div>
                  </div>
                  {r.humidity != null && (
                    <div className="metric-reading">
                      <div className="v">{nf(Number(r.humidity), 0)}<span className="u">%</span></div>
                      <div className="l">rH</div>
                    </div>
                  )}
                  {r.dew_point != null && (
                    <div className="metric-reading">
                      <div className="v">{nf(Number(r.dew_point), 1)}<span className="u">°C</span></div>
                      <div className="l">Taupunkt</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Zonen-Karten */}
      {zones.length > 0 && (
        <div>
          <div className="card-head" style={{ marginBottom: 12 }}>
            <div className="card-title"><span className="ico"><Home size={15} /></span>Zonen — aktuelle Behaglichkeit</div>
            <span className="scope-tag">{zonesOk}/{zones.length} behaglich · {zonesAlert} kritisch</span>
          </div>
          <div className="metric-cards">
            {zones.map((z) => {
              const st = scoreStatus(z.comfort_score);
              return (
                <div className="metric-card" key={z.zone} style={{ ['--accent' as string]: STATUS_VAR[st] }}>
                  <div className="metric-top">
                    <div className="metric-name">{z.zone}</div>
                    <span className={'metric-status st-' + st}><span className={'dot st-' + st + '-bg'} />{STATUS_LABEL[st]}</span>
                  </div>
                  <div className="metric-readings">
                    <div className="metric-reading">
                      <div className="v">{nf(Number(z.avg_temperature), 1)}<span className="u">°C</span></div>
                      <div className="l">Ø Temp</div>
                    </div>
                    <div className="metric-reading">
                      <div className="v">{nf(Number(z.avg_humidity), 0)}<span className="u">%</span></div>
                      <div className="l">Ø rH</div>
                    </div>
                    <div className="metric-reading">
                      <div className="v">{z.comfort_score != null ? nf(z.comfort_score, 0) : '–'}</div>
                      <div className="l">Komfort</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Soll-Ist / Zonen-Tabelle */}
      {zones.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head" style={{ padding: '16px 16px 0' }}>
            <div className="card-title"><span className="ico"><TableIcon size={15} /></span>Zonen-Übersicht</div>
            <div className="card-controls">
              <InfoTip title="Komfort-Score" formula="Score = T_score × 0.6 + RH_score × 0.4">
                100 = optimal. Pro 1 °C Abweichung vom Sollbereich −15 Punkte, pro 1 % rLF Abweichung −5 Punkte.
              </InfoTip>
            </div>
          </div>
          <div className="dtable-wrap" style={{ border: 'none' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th className="num">Ø Temp.</th>
                  <th className="num">Min</th>
                  <th className="num">Max</th>
                  <th className="num">Ø Feuchte</th>
                  <th className="num">Komfort</th>
                  <th>Bewertung</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => {
                  const st = scoreStatus(z.comfort_score);
                  return (
                    <tr key={z.zone}>
                      <td className="cell-name">{z.zone}</td>
                      <td className="num strong">{nf(Number(z.avg_temperature), 1)} °C</td>
                      <td className="num" style={{ color: 'var(--fw-kaelte)' }}>{nf(Number(z.min_temperature), 1)}</td>
                      <td className="num" style={{ color: 'var(--fw-fernwaerme)' }}>{nf(Number(z.max_temperature), 1)}</td>
                      <td className="num">{nf(Number(z.avg_humidity), 0)} %</td>
                      <td className="num strong">{z.comfort_score != null ? nf(z.comfort_score, 0) : '–'}</td>
                      <td><span className={'metric-status st-' + st}><span className={'dot st-' + st + '-bg'} />{STATUS_LABEL[st]}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="dtable-foot">Bewertung nach DIN EN 16798-1 (Kategorie II)</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Messwerte ──

function ReadingsPanel() {
  const [sensors, setSensors] = useState<ClimateSensor[]>([]);
  const [selectedSensor, setSelectedSensor] = useState('');
  const [readings, setReadings] = useState<ClimateReading[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<PaginatedResponse<ClimateSensor>>('/api/v1/climate/sensors?page_size=100');
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

  // Chart aus den Messwerten (chronologisch)
  const chrono = [...readings].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const chartLabels = chrono.map((r) =>
    new Date(r.timestamp).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
  );
  const tempSeries = chrono.map((r) => (r.temperature != null ? Number(r.temperature) : null));
  const humSeries = chrono.map((r) => (r.humidity != null ? Number(r.humidity) : null));
  const xEvery = Math.max(1, Math.ceil(chartLabels.length / 12));

  return (
    <div className="stack">
      <div className="toolbar-card">
        <div className="field grow" style={{ maxWidth: 360 }}>
          <label className="field-label">Sensor</label>
          <select className="uselect" value={selectedSensor} onChange={(e) => setSelectedSensor(e.target.value)}>
            <option value="">– Sensor wählen –</option>
            {sensors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.zone ? `(${s.zone})` : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!selectedSensor ? (
        <div className="card">
          <div className="empty-state">
            <div className="mark"><Activity size={20} /></div>
            <strong>Sensor wählen</strong>
            <p>Wähle oben einen Sensor, um seinen Verlauf und die Einzelmesswerte anzuzeigen.</p>
          </div>
        </div>
      ) : loading ? (
        <div className="card"><LoadingSpinner /></div>
      ) : readings.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="mark"><Activity size={20} /></div>
            <strong>Keine Messwerte</strong>
            <p>Für diesen Sensor liegen noch keine Messwerte vor.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title"><span className="ico"><Thermometer size={15} /></span>Temperatur & Feuchte</div>
                <div className="card-sub">Grünes Band markiert den behaglichen Temperaturbereich (20–24 °C).</div>
              </div>
              <div className="legend-row">
                <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-fernwaerme)' }} />Temperatur</span>
                <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-wasser)' }} />rel. Feuchte</span>
              </div>
            </div>
            <MultiLine
              series={[
                { key: 't', label: 'Temperatur', color: 'var(--fw-fernwaerme)', data: tempSeries, unit: '°C', decimals: 1 },
                { key: 'rh', label: 'rel. Feuchte', color: 'var(--fw-wasser)', data: humSeries, unit: '%', decimals: 0 },
              ]}
              labels={chartLabels}
              decimals={0}
              height={260}
              xTickEvery={xEvery}
              bands={[{ from: 20, to: 24, color: 'var(--good)', opacity: 0.08 }]}
            />
          </div>

          <div className="card" style={{ padding: 0 }}>
            <div className="card-head" style={{ padding: '16px 16px 0' }}>
              <div className="card-title"><span className="ico"><TableIcon size={15} /></span>Einzelmesswerte</div>
              <span className="scope-tag">{total} gesamt</span>
            </div>
            <div className="dtable-wrap" style={{ border: 'none', maxHeight: 420, overflowY: 'auto' }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th>Zeitpunkt</th>
                    <th className="num">Temperatur</th>
                    <th className="num">Feuchte</th>
                    <th className="num">
                      Taupunkt
                      <InfoTip title="Taupunkt" formula="τ = b×γ/(a−γ), γ = a×T/(b+T) + ln(RH/100)">
                        Magnus-Formel (a=17.271, b=237.7). Temperatur, ab der Kondenswasser entsteht.
                      </InfoTip>
                    </th>
                    <th>Quelle</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-name mono">
                        {new Date(r.timestamp).toLocaleString('de-DE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="num strong">{r.temperature != null ? `${nf(Number(r.temperature), 1)} °C` : '–'}</td>
                      <td className="num">{r.humidity != null ? `${nf(Number(r.humidity), 0)} %` : '–'}</td>
                      <td className="num" style={{ color: 'var(--ink-3)' }}>{r.dew_point != null ? `${nf(Number(r.dew_point), 1)} °C` : '–'}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="dtable-foot">{total} Messwerte insgesamt</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tab 3: Sensoren ──

function SensorsPanel() {
  const [sensors, setSensors] = useState<ClimateSensor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [form, setForm] = useState<SensorForm>(emptySensorForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sites, setSites] = useState<SiteOpt[]>([]);
  const [buildings, setBuildings] = useState<BuildingOpt[]>([]);
  const [units, setUnits] = useState<UnitOpt[]>([]);

  const loadSensors = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<ClimateSensor>>('/api/v1/climate/sensors?page_size=100');
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
    apiClient
      .get('/api/v1/sites?page_size=100')
      .then((r) => {
        const items = r.data.items || r.data;
        setSites(Array.isArray(items) ? items.map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })) : []);
      })
      .catch(() => {
        /* ignorieren */
      });
  }, [loadSensors]);

  useEffect(() => {
    if (!form.site_id) {
      setBuildings([]);
      return;
    }
    apiClient
      .get(`/api/v1/sites/${form.site_id}/buildings`)
      .then((r) => {
        const items = r.data.items || r.data;
        setBuildings(
          Array.isArray(items) ? items.map((b: { id: string; name: string }) => ({ id: b.id, name: b.name, site_id: form.site_id })) : []
        );
      })
      .catch(() => setBuildings([]));
  }, [form.site_id]);

  useEffect(() => {
    if (!form.building_id || !form.site_id) {
      setUnits([]);
      return;
    }
    apiClient
      .get(`/api/v1/sites/${form.site_id}/buildings/${form.building_id}`)
      .then((r) => {
        const list = (r.data?.usage_units ?? []) as Array<{ id: string; name: string }>;
        setUnits(list.map((u) => ({ id: u.id, name: u.name, building_id: form.building_id })));
      })
      .catch(() => setUnits([]));
  }, [form.building_id, form.site_id]);

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
        site_id: form.site_id || null,
        building_id: form.building_id || null,
        usage_unit_id: form.usage_unit_id || null,
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
    <div className="stack">
      <div className="card" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: '16px 16px 0' }}>
          <div>
            <div className="card-title"><span className="ico"><RadioTower size={15} /></span>Klimasensoren</div>
            <div className="card-sub">Temperatur-/Feuchtesensoren je Zone, optional strukturell zugeordnet.</div>
          </div>
          <div className="card-controls">
            <button className="btn-ghost small" onClick={() => setShowDiscovery(true)}>
              <Search size={14} />Entdecken
            </button>
            <button className="btn-primary small" onClick={handleCreate}>
              <Plus size={14} />Neuer Sensor
            </button>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : sensors.length === 0 ? (
          <div className="empty-state">
            <div className="mark"><RadioTower size={20} /></div>
            <strong>Keine Sensoren angelegt</strong>
            <p>Lege manuell einen Sensor an oder nutze „Entdecken", um Sensoren aus Home Assistant zu importieren.</p>
          </div>
        ) : (
          <div className="dtable-wrap" style={{ border: 'none' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Typ</th>
                  <th>Zone / Zuordnung</th>
                  <th>Quelle</th>
                  <th>Sollbereich</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sensors.map((s) => {
                  const siteName = sites.find((x) => x.id === s.site_id)?.name;
                  const bldName = buildings.find((x) => x.id === s.building_id)?.name;
                  const unitName = units.find((x) => x.id === s.usage_unit_id)?.name;
                  const path = [siteName, bldName, unitName].filter(Boolean).join(' › ');
                  return (
                    <tr key={s.id}>
                      <td className="cell-name">{s.name}</td>
                      <td style={{ color: 'var(--ink-3)' }}>{SENSOR_TYPES[s.sensor_type] || s.sensor_type}</td>
                      <td>
                        {s.zone && <span className="scope-tag">{s.zone}</span>}
                        {path && <div className="cell-sub">{path}</div>}
                        {!s.zone && !path && <span className="muted">–</span>}
                      </td>
                      <td style={{ color: 'var(--ink-3)' }}>{DATA_SOURCES[s.data_source] || s.data_source}</td>
                      <td className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                        {s.target_temp_min && s.target_temp_max ? `${s.target_temp_min}–${s.target_temp_max} °C` : '–'}
                        {s.target_humidity_min && s.target_humidity_max ? ` / ${s.target_humidity_min}–${s.target_humidity_max} %` : ''}
                      </td>
                      <td className="num">
                        <a className="row-action danger" onClick={() => handleDelete(s)}>
                          <Trash2 size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Löschen
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="dtable-foot">{total} Sensoren</div>
          </div>
        )}
      </div>

      {showDiscovery && <DiscoveryModal mode="climate" onClose={() => setShowDiscovery(false)} onCreated={loadSensors} />}

      {showModal && (
        <div className="umodal-overlay" onClick={() => setShowModal(false)}>
          <div className="umwelt-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2>Neuer Klimasensor</h2>
            <form onSubmit={handleSubmit}>
              {formError && <div className="form-err">{formError}</div>}

              <div className="form-grid2">
                <div className="field">
                  <label className="field-label">Name *</label>
                  <input type="text" className="uinput" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">Typ</label>
                  <select className="uselect" value={form.sensor_type} onChange={(e) => setForm({ ...form, sensor_type: e.target.value })}>
                    {Object.entries(SENSOR_TYPES).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-grid2">
                <div className="field">
                  <label className="field-label">Position</label>
                  <input type="text" className="uinput" placeholder="z. B. Büro EG" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
                </div>
                <div className="field">
                  <label className="field-label">Zone</label>
                  <input type="text" className="uinput" placeholder="z. B. Heizzone 1" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Strukturelle Zuordnung (optional)</label>
                <div className="form-grid2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <select
                    className="uselect"
                    value={form.site_id}
                    onChange={(e) => setForm({ ...form, site_id: e.target.value, building_id: '', usage_unit_id: '' })}
                  >
                    <option value="">— Standort —</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <select
                    className="uselect"
                    value={form.building_id}
                    disabled={!form.site_id || buildings.length === 0}
                    onChange={(e) => setForm({ ...form, building_id: e.target.value, usage_unit_id: '' })}
                  >
                    <option value="">{form.site_id ? (buildings.length ? '— Gebäude —' : 'keine') : 'erst Standort'}</option>
                    {buildings.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <select
                    className="uselect"
                    value={form.usage_unit_id}
                    disabled={!form.building_id || units.length === 0}
                    onChange={(e) => setForm({ ...form, usage_unit_id: e.target.value })}
                  >
                    <option value="">{form.building_id ? (units.length ? '— Einheit —' : 'keine') : 'erst Gebäude'}</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field-label">Datenquelle</label>
                <select className="uselect" value={form.data_source} onChange={(e) => setForm({ ...form, data_source: e.target.value })}>
                  {Object.entries(DATA_SOURCES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              {form.data_source === 'homeassistant' && (
                <div className="form-grid2">
                  <div className="field">
                    <label className="field-label">HA Entity Temperatur</label>
                    <input type="text" className="uinput mono" placeholder="sensor.temp_buero" value={form.ha_entity_id_temp} onChange={(e) => setForm({ ...form, ha_entity_id_temp: e.target.value })} />
                  </div>
                  <div className="field">
                    <label className="field-label">HA Entity Feuchte</label>
                    <input type="text" className="uinput mono" placeholder="sensor.humidity_buero" value={form.ha_entity_id_humidity} onChange={(e) => setForm({ ...form, ha_entity_id_humidity: e.target.value })} />
                  </div>
                </div>
              )}

              <div className="field">
                <label className="field-label">Sollbereiche</label>
                <div className="form-grid2" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
                  <input type="number" step="0.1" className="uinput mono" placeholder="T min" value={form.target_temp_min} onChange={(e) => setForm({ ...form, target_temp_min: e.target.value })} />
                  <input type="number" step="0.1" className="uinput mono" placeholder="T max" value={form.target_temp_max} onChange={(e) => setForm({ ...form, target_temp_max: e.target.value })} />
                  <input type="number" step="1" className="uinput mono" placeholder="rH min" value={form.target_humidity_min} onChange={(e) => setForm({ ...form, target_humidity_min: e.target.value })} />
                  <input type="number" step="1" className="uinput mono" placeholder="rH max" value={form.target_humidity_max} onChange={(e) => setForm({ ...form, target_humidity_max: e.target.value })} />
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Speichern…' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

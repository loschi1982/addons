/**
 * ControlStrategiesPage – BMS-Regelstrategien (ISO 50001 Kap. 8).
 * Master-Detail-Redesign nach Claude-Design-Handoff (regelstrategien.css, .rs).
 * Detail-Daten (Sollwerte, Zeitprogramm) sowie der Soll-/Ist-Vergleich
 * (Compliance-Report) stammen vollständig aus dem Backend.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, X, Search, MapPin, Clock, Link2, Target, Info, AlertTriangle,
  Pencil, Trash2, SlidersHorizontal, Power, Gauge, Check,
  Flame, Snowflake, Wind, Lightbulb, Layers,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';

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

interface TypeMeta {
  label: string;
  color: string;
  bg: string;
  text: string;
  Icon: typeof Flame;
}
const TYPE_META: Record<string, TypeMeta> = {
  heating: { label: 'Heizung', color: '#E89A3C', bg: '#FCE7C3', text: '#7B3F0C', Icon: Flame },
  cooling: { label: 'Kühlung', color: '#4FC3F7', bg: '#D5EFFB', text: '#0B4A6E', Icon: Snowflake },
  ventilation: { label: 'Lüftung', color: '#5FAE8E', bg: '#D7EDE3', text: '#1E5A45', Icon: Wind },
  lighting: { label: 'Beleuchtung', color: '#F2C94C', bg: '#FBEFC1', text: '#7A5800', Icon: Lightbulb },
  combined: { label: 'Kombiniert', color: '#6B6B6B', bg: '#E4E0D6', text: '#44423B', Icon: Layers },
};
const typeMeta = (k: string): TypeMeta => TYPE_META[k] || { label: k, color: '#9A968B', bg: 'var(--surface-2)', text: 'var(--ink-2)', Icon: Layers };

const DAY_LABELS: Record<string, string> = { mon: 'Mo', tue: 'Di', wed: 'Mi', thu: 'Do', fri: 'Fr', sat: 'Sa', sun: 'So' };
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

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

const parseHour = (t: string | null): number | null => {
  if (!t) return null;
  const m = /^(\d{1,2})/.exec(t);
  return m ? Number(m[1]) : null;
};

function TypeChip({ type, sm }: { type: string; sm?: boolean }) {
  const m = typeMeta(type);
  return (
    <span className={'r-type' + (sm ? ' sm' : '')} style={{ background: m.bg, color: m.text }}>
      <m.Icon size={sm ? 11 : 12} color={m.color} />
      {m.label}
    </span>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return active ? (
    <span className="r-status good"><span className="dot" />Aktiv</span>
  ) : (
    <span className="r-status muted"><span className="dot" />Inaktiv</span>
  );
}

export default function ControlStrategiesPage() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('alle');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [selId, setSelId] = useState<string | null>(null);
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
      setSelId((prev) => prev ?? (res.data.items[0]?.id ?? null));
    } catch {
      setError('Regelstrategien konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const stats = useMemo(() => {
    const aktiv = strategies.filter((s) => s.is_active).length;
    return {
      total: strategies.length,
      aktiv,
      inaktiv: strategies.length - aktiv,
      mitCo2: strategies.filter((s) => s.max_co2_ppm != null).length,
      mitHa: strategies.filter((s) => s.ha_entity_id).length,
    };
  }, [strategies]);

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    strategies.forEach((s) => { c[s.strategy_type] = (c[s.strategy_type] || 0) + 1; });
    return c;
  }, [strategies]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return strategies
      .filter((s) => {
        if (typeFilter !== 'alle' && s.strategy_type !== typeFilter) return false;
        if (q) {
          const hay = `${s.name} ${s.building_name ?? ''} ${s.usage_unit_name ?? ''} ${s.ha_entity_id ?? ''}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [strategies, query, typeFilter]);

  const selected = useMemo(() => strategies.find((s) => s.id === selId) || null, [strategies, selId]);

  const selectStrategy = (s: Strategy) => {
    setSelId(s.id);
    setCompliance(null);
  };

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
      operating_time_start: s.operating_time_start?.slice(0, 5) ?? '06:00',
      operating_time_end: s.operating_time_end?.slice(0, 5) ?? '22:00',
      operating_days: s.operating_days ?? ['mon', 'tue', 'wed', 'thu', 'fri'],
      ha_entity_id: s.ha_entity_id ?? '',
      is_active: s.is_active,
      notes: s.notes ?? '',
    });
    setShowForm(true);
  };

  const toggleDay = (day: string) => {
    setForm((f) => ({
      ...f,
      operating_days: f.operating_days.includes(day) ? f.operating_days.filter((d) => d !== day) : [...f.operating_days, day],
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

  const loadCompliance = async () => {
    if (!selected) return;
    setCompliance(null);
    setLoadingCompliance(true);
    try {
      const params = new URLSearchParams({ period_start: complianceStart, period_end: complianceEnd });
      const res = await apiClient.get<ComplianceReport>(`/api/v1/control-strategies/${selected.id}/compliance?${params}`);
      setCompliance(res.data);
    } catch {
      setError('Soll-/Ist-Vergleich fehlgeschlagen.');
    } finally {
      setLoadingCompliance(false);
    }
  };

  return (
    <div className="rs">
      <PageHead
        eyebrow="ISO 50001 · Kap. 8"
        title="BMS-Regelstrategien"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={13} /> Regelstrategie anlegen</button>}
      />
      <div className="head-lead">
        <span className="pip"><span className="dot" /> <strong>{stats.aktiv}</strong>&nbsp;aktiv von&nbsp;<strong>{stats.total}</strong></span>
        {stats.inaktiv > 0 && <span className="pip warn"><span className="dot" /> <strong>{stats.inaktiv}</strong>&nbsp;inaktiv</span>}
        {stats.mitHa > 0 && <span className="pip"><span className="dot" /> <strong>{stats.mitHa}</strong>&nbsp;an GLT gekoppelt</span>}
      </div>

      {error && (
        <div style={{ margin: '12px 0', background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '10px 14px', color: 'var(--alert)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--alert)' }}><X size={16} /></button>
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {/* KPI-Reihe */}
        <div className="rs-kpis">
          <div className="kpi accent-ink"><div className="kpi-top"><span className="kpi-ico"><SlidersHorizontal size={13} /></span>Strategien</div><div className="kpi-val">{stats.total}</div><div className="kpi-sub">Sollwert-/Zeitprogramme</div></div>
          <div className="kpi accent-info"><div className="kpi-top"><span className="kpi-ico"><Power size={13} /></span>Aktiv</div><div className="kpi-val">{stats.aktiv}</div><div className="kpi-sub">in Betrieb</div></div>
          <div className="kpi accent-ink"><div className="kpi-top"><span className="kpi-ico"><Power size={13} /></span>Inaktiv</div><div className="kpi-val">{stats.inaktiv}</div><div className="kpi-sub">deaktiviert</div></div>
          <div className="kpi accent-ink"><div className="kpi-top"><span className="kpi-ico"><Gauge size={13} /></span>Mit CO₂-Grenze</div><div className="kpi-val">{stats.mitCo2}</div><div className="kpi-sub">Luftqualität geregelt</div></div>
          <div className="kpi accent-ink"><div className="kpi-top"><span className="kpi-ico"><Link2 size={13} /></span>HA-Anbindung</div><div className="kpi-val">{stats.mitHa}</div><div className="kpi-sub">an GLT gekoppelt</div></div>
        </div>

        {/* Filterleiste */}
        <div className="toolbar2">
          <div className="search-input2">
            <Search size={13} color="var(--ink-4)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, Zone, Entity-ID suchen…" />
          </div>
          <div className="group">
            Typ
            <div className="pill-row">
              <span className={'pill' + (typeFilter === 'alle' ? ' active' : '')} onClick={() => setTypeFilter('alle')}>Alle</span>
              {Object.keys(TYPE_META).filter((k) => typeCounts[k]).map((k) => (
                <span key={k} className={'pill' + (typeFilter === k ? ' active' : '')} onClick={() => setTypeFilter(k)}>
                  {typeMeta(k).label}<span className="count">{typeCounts[k]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Master / Detail */}
        <div className="rs-layout">
          <div className="rs-master">
            {loading ? (
              <div className="rs-empty"><LoadingSpinner /></div>
            ) : rows.length === 0 ? (
              <div className="rs-empty"><span className="em-ico"><Search size={24} /></span>Keine Regelstrategien für diese Auswahl.</div>
            ) : (
              <div className="rs-list">
                {rows.map((s) => {
                  const m = typeMeta(s.strategy_type);
                  return (
                    <div key={s.id} className={'rs-item' + (s.id === selId ? ' sel' : '') + (s.is_active ? '' : ' off')} onClick={() => selectStrategy(s)}>
                      <span className="rs-item-accent" style={{ background: m.color }} />
                      <div className="rs-item-main">
                        <div className="rs-item-top">
                          <span className="rs-item-name">{s.name}</span>
                        </div>
                        <div className="rs-item-meta">
                          <TypeChip type={s.strategy_type} sm />
                          {(s.usage_unit_name || s.building_name) && (
                            <span className="rs-meta-x"><MapPin size={12} />{s.usage_unit_name || s.building_name}</span>
                          )}
                          {s.operating_time_start && s.operating_time_end && (
                            <span className="rs-meta-x mono"><Clock size={12} />{s.operating_time_start.slice(0, 5)}–{s.operating_time_end.slice(0, 5)}</span>
                          )}
                        </div>
                      </div>
                      <div className="rs-item-right">
                        <StatusPill active={s.is_active} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {total > 0 && (
              <div className="rs-foot">
                <span><strong style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{rows.length}</strong> von {total} Strategien</span>
              </div>
            )}
          </div>

          <DetailPanel
            s={selected}
            compliance={compliance}
            loadingCompliance={loadingCompliance}
            complianceStart={complianceStart}
            complianceEnd={complianceEnd}
            setComplianceStart={setComplianceStart}
            setComplianceEnd={setComplianceEnd}
            onLoadCompliance={loadCompliance}
            onEdit={openEdit}
            onDelete={handleDelete}
          />
        </div>
      </div>

      {showForm && (
        <StrategyModal
          editing={!!editing}
          form={form}
          setForm={setForm}
          toggleDay={toggleDay}
          saving={saving}
          onClose={() => setShowForm(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

// ── Detail-Panel ──

function DetailPanel({
  s, compliance, loadingCompliance, complianceStart, complianceEnd,
  setComplianceStart, setComplianceEnd, onLoadCompliance, onEdit, onDelete,
}: {
  s: Strategy | null;
  compliance: ComplianceReport | null;
  loadingCompliance: boolean;
  complianceStart: string;
  complianceEnd: string;
  setComplianceStart: (v: string) => void;
  setComplianceEnd: (v: string) => void;
  onLoadCompliance: () => void;
  onEdit: (s: Strategy) => void;
  onDelete: (id: string) => void;
}) {
  if (!s) {
    return (
      <div className="rs-detail">
        <div className="rd-block-title">Detail</div>
        <div className="rd-empty"><span className="rd-empty-ico"><SlidersHorizontal size={26} /></span>Regelstrategie aus der Liste auswählen.</div>
      </div>
    );
  }

  const m = typeMeta(s.strategy_type);
  const startH = parseHour(s.operating_time_start);
  const endH = parseHour(s.operating_time_end);
  const occHours = startH != null && endH != null ? Math.max(0, endH - startH) : null;

  // rd-now Banner aus Compliance (Temp bevorzugt, sonst CO₂)
  let banner: { lbl: string; ist: string; soll: string; dev: string; tone: string } | null = null;
  if (compliance) {
    if (compliance.setpoint_heating != null && compliance.avg_temperature != null) {
      const d = compliance.avg_temperature - compliance.setpoint_heating;
      banner = {
        lbl: 'Ø Temperatur', ist: `${compliance.avg_temperature.toFixed(1)} °C`, soll: `${compliance.setpoint_heating} °C`,
        dev: `${d > 0 ? '+' : ''}${d.toFixed(1)} K`, tone: compliance.temp_compliant === false ? 'alert' : compliance.temp_compliant ? 'good' : 'warn',
      };
    } else if (compliance.max_co2_ppm != null && compliance.avg_co2_ppm != null) {
      const d = compliance.avg_co2_ppm - compliance.max_co2_ppm;
      banner = {
        lbl: 'Ø CO₂', ist: `${compliance.avg_co2_ppm.toFixed(0)} ppm`, soll: `≤ ${compliance.max_co2_ppm} ppm`,
        dev: `${d > 0 ? '+' : ''}${d.toFixed(0)} ppm`, tone: compliance.co2_compliant === false ? 'alert' : compliance.co2_compliant ? 'good' : 'warn',
      };
    }
  }

  return (
    <div className="rs-detail">
      <div className="rs-detail-head">
        <div>
          <div className="rd-eyebrow"><span className="mono">{m.label}</span></div>
          <div className="rd-title">{s.name}</div>
          <div className="rd-meta">
            <TypeChip type={s.strategy_type} />
            {(s.usage_unit_name || s.building_name) && <span className="rd-meta-x"><MapPin size={12} />{s.usage_unit_name || s.building_name}</span>}
            {s.ha_entity_id && <span className="rd-meta-x mono"><Link2 size={12} />{s.ha_entity_id}</span>}
          </div>
        </div>
        <StatusPill active={s.is_active} />
      </div>

      {/* Sollwerte */}
      <div className="rd-block">
        <div className="rd-block-head"><span className="rd-block-title">Sollwerte</span></div>
        <div className="cmp-mini">
          <div className="cmp-mini-item"><span className="cm-l">Heiz-Soll</span><span className="cm-v mono">{s.setpoint_heating != null ? `${s.setpoint_heating} °C` : '—'}</span></div>
          <div className="cmp-mini-item"><span className="cm-l">Kühl-Soll</span><span className="cm-v mono">{s.setpoint_cooling != null ? `${s.setpoint_cooling} °C` : '—'}</span></div>
          <div className="cmp-mini-item"><span className="cm-l">Nachtabsenkung</span><span className="cm-v mono">{s.setpoint_night_reduction != null ? `−${s.setpoint_night_reduction} K` : '—'}</span></div>
          <div className="cmp-mini-item"><span className="cm-l">CO₂-Max</span><span className="cm-v mono">{s.max_co2_ppm != null ? `${s.max_co2_ppm} ppm` : '—'}</span></div>
          <div className="cmp-mini-item"><span className="cm-l">Betrieb</span><span className="cm-v mono">{s.operating_time_start && s.operating_time_end ? `${s.operating_time_start.slice(0, 5)}–${s.operating_time_end.slice(0, 5)}` : '—'}</span></div>
          <div className="cmp-mini-item"><span className="cm-l">Betriebstage</span><span className="cm-v mono">{s.operating_days?.length ?? 0}/7</span></div>
        </div>
      </div>

      {/* Zeitprogramm */}
      {(startH != null && endH != null) && (
        <div className="rd-block">
          <div className="rd-block-head"><span className="rd-block-title">Zeitprogramm</span>{occHours != null && <span className="rd-block-note mono">{occHours} h/Tag</span>}</div>
          <div className="rd-schedule">
            {Array.from({ length: 24 }).map((_, h) => {
              const on = h >= startH && h < endH;
              return <span key={h} className={'sched-cell' + (on ? ' on' : '')} style={on ? { background: m.color } : undefined} title={`${String(h).padStart(2, '0')}:00`} />;
            })}
          </div>
          <div className="rd-sched-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div>
          <div className="rd-days">
            {DAY_ORDER.map((d) => (
              <span key={d} className={'rd-day' + (s.operating_days?.includes(d) ? ' on' : '')}>{DAY_LABELS[d]}</span>
            ))}
          </div>
        </div>
      )}

      {/* Soll-/Ist-Vergleich */}
      <div className="rd-block">
        <div className="rd-block-head"><span className="rd-block-title">Soll-/Ist-Vergleich</span></div>
        <div className="rd-daterange">
          <div className="field"><label>Von</label><input type="date" className="dinp" value={complianceStart} onChange={(e) => setComplianceStart(e.target.value)} /></div>
          <div className="field"><label>Bis</label><input type="date" className="dinp" value={complianceEnd} onChange={(e) => setComplianceEnd(e.target.value)} /></div>
          <button className="btn-soft" onClick={onLoadCompliance} disabled={loadingCompliance}>
            <Target size={13} /> {loadingCompliance ? 'Analysiere…' : 'Vergleich laden'}
          </button>
        </div>

        {compliance && (
          <>
            {banner && (
              <div className={'rd-now tone-' + banner.tone}>
                <div className="rd-now-l"><span className="rd-now-lbl">Ist · {banner.lbl}</span><span className="rd-now-val mono">{banner.ist}</span></div>
                <div className="rd-now-vs"><Target size={13} /></div>
                <div className="rd-now-l"><span className="rd-now-lbl">Sollwert</span><span className="rd-now-val mono dim">{banner.soll}</span></div>
                <div className={'rd-now-dev ' + banner.tone}><span className="rd-now-lbl">Abweichung</span><span className="rd-now-val mono">{banner.dev}</span></div>
              </div>
            )}

            <div className="cmp-list">
              {compliance.setpoint_heating != null && (
                <CompareRow
                  label="Temperatur (Heizung)"
                  soll={compliance.setpoint_heating}
                  ist={compliance.avg_temperature}
                  unit="°C"
                  compliant={compliance.temp_compliant}
                  range={3}
                />
              )}
              {compliance.max_co2_ppm != null && (
                <CompareRow
                  label="CO₂-Konzentration"
                  soll={compliance.max_co2_ppm}
                  ist={compliance.avg_co2_ppm}
                  unit="ppm"
                  compliant={compliance.co2_compliant}
                  range={compliance.max_co2_ppm * 0.6}
                  maxMode
                />
              )}
              <div className="cmp-mini">
                <div className="cmp-mini-item"><span className="cm-l">Sensoren</span><span className="cm-v mono">{compliance.sensor_count}</span></div>
                <div className="cmp-mini-item"><span className="cm-l">Temp-Konformität</span><span className={'cm-v ' + (compliance.temp_compliant === false ? 'alert' : compliance.temp_compliant ? 'good' : '')}>{compliance.temp_compliant == null ? '—' : compliance.temp_compliant ? 'konform' : 'Abweichung'}</span></div>
                <div className="cmp-mini-item"><span className="cm-l">CO₂-Konformität</span><span className={'cm-v ' + (compliance.co2_compliant === false ? 'alert' : compliance.co2_compliant ? 'good' : '')}>{compliance.co2_compliant == null ? '—' : compliance.co2_compliant ? 'konform' : 'Abweichung'}</span></div>
              </div>
            </div>

            {compliance.note && (
              <div className="rd-note warn"><AlertTriangle size={13} /><span>{compliance.note}</span></div>
            )}
          </>
        )}
      </div>

      {/* Notizen */}
      {(s.description || s.notes) && (
        <div className="rd-block notes">
          {s.description && <div className="rd-note"><Info size={13} /><span>{s.description}</span></div>}
          {s.notes && <div className="rd-note warn"><AlertTriangle size={13} /><span>{s.notes}</span></div>}
        </div>
      )}

      <div className="rd-actions">
        <button className="btn-soft" onClick={() => onEdit(s)}><Pencil size={13} /> Bearbeiten</button>
        <button className="btn-soft danger" onClick={() => onDelete(s.id)}><Trash2 size={13} /> Deaktivieren</button>
      </div>
    </div>
  );
}

function CompareRow({
  label, soll, ist, unit, compliant, range, maxMode,
}: {
  label: string;
  soll: number;
  ist: number | null;
  unit: string;
  compliant: boolean | null;
  range: number;
  maxMode?: boolean;
}) {
  const tone = compliant === false ? 'alert' : compliant ? 'good' : 'warn';
  const dev = ist != null ? ist - soll : null;
  const pos = ist != null ? Math.max(-1, Math.min(1, (ist - soll) / (range || 1))) : 0;
  return (
    <div className="cmp-row">
      <div className="cmp-label">{label}</div>
      <div className="cmp-vals">
        <span className="cmp-soll">Soll <b>{maxMode ? `≤ ${soll}` : soll}</b> <span className="u">{unit}</span></span>
        <span className="cmp-ist mono">{ist != null ? (maxMode ? Math.round(ist) : ist.toFixed(1)) : '–'}<span className="u"> {unit}</span></span>
      </div>
      <div className="cmp-bar">
        <span className="cmp-bar-mid" />
        {ist != null && <span className={'cmp-bar-dot ' + tone} style={{ left: `calc(50% + ${pos * 46}%)` }} />}
      </div>
      {dev != null && (
        <span className={'cmp-dev ' + tone}>{dev > 0 ? '+' : ''}{maxMode ? Math.round(dev) : dev.toFixed(1)}<span className="u"> {unit}</span></span>
      )}
    </div>
  );
}

// ── Modal ──

function StrategyModal({
  editing, form, setForm, toggleDay, saving, onClose, onSave,
}: {
  editing: boolean;
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  toggleDay: (d: string) => void;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div className="m-title-row">
            <span className="m-title-ico"><SlidersHorizontal size={16} /></span>
            <div>
              <div className="m-title">{editing ? 'Regelstrategie bearbeiten' : 'Neue Regelstrategie'}</div>
              <div className="m-sub">Sollwerte und Zeitprogramm der GLT</div>
            </div>
          </div>
          <button className="m-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="m-body">
          <div className="field">
            <label>Name<span className="req">*</span></label>
            <input className="inp" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field-row c2">
            <div className="field">
              <label>Typ</label>
              <select className="sel" value={form.strategy_type} onChange={(e) => setForm((f) => ({ ...f, strategy_type: e.target.value }))}>
                {Object.keys(TYPE_META).map((k) => <option key={k} value={k}>{typeMeta(k).label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>HA Entity-ID<span className="opt">optional</span></label>
              <input className="inp mono" placeholder="climate.buro_eg" value={form.ha_entity_id} onChange={(e) => setForm((f) => ({ ...f, ha_entity_id: e.target.value }))} />
            </div>
          </div>

          <div className="f-divider">Sollwerte</div>
          <div className="field-row c2">
            <div className="field"><label>Heiz-Sollwert (°C)</label><input type="number" step="0.5" className="inp mono" placeholder="21" value={form.setpoint_heating} onChange={(e) => setForm((f) => ({ ...f, setpoint_heating: e.target.value }))} /></div>
            <div className="field"><label>Kühl-Sollwert (°C)</label><input type="number" step="0.5" className="inp mono" placeholder="26" value={form.setpoint_cooling} onChange={(e) => setForm((f) => ({ ...f, setpoint_cooling: e.target.value }))} /></div>
            <div className="field"><label>Nachtabsenkung (K)</label><input type="number" step="0.5" className="inp mono" placeholder="3" value={form.setpoint_night_reduction} onChange={(e) => setForm((f) => ({ ...f, setpoint_night_reduction: e.target.value }))} /></div>
            <div className="field"><label>CO₂-Maximum (ppm)</label><input type="number" className="inp mono" placeholder="1000" value={form.max_co2_ppm} onChange={(e) => setForm((f) => ({ ...f, max_co2_ppm: e.target.value }))} /></div>
          </div>

          <div className="f-divider">Zeitprogramm</div>
          <div className="field-row c2">
            <div className="field"><label>Betrieb von</label><input type="time" className="inp mono" value={form.operating_time_start} onChange={(e) => setForm((f) => ({ ...f, operating_time_start: e.target.value }))} /></div>
            <div className="field"><label>Betrieb bis</label><input type="time" className="inp mono" value={form.operating_time_end} onChange={(e) => setForm((f) => ({ ...f, operating_time_end: e.target.value }))} /></div>
          </div>
          <div className="field">
            <label>Betriebstage</label>
            <div className="day-toggle">
              {DAY_ORDER.map((d) => (
                <button key={d} type="button" className={'day-btn' + (form.operating_days.includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{DAY_LABELS[d]}</button>
              ))}
            </div>
          </div>

          <div className="f-divider">Sonstiges</div>
          <div className="field"><label>Beschreibung</label><textarea className="ta" rows={2} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <div className="field"><label>Notizen</label><textarea className="ta" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          <div className={'chk-line' + (form.is_active ? ' on' : '')} onClick={() => setForm((f) => ({ ...f, is_active: !f.is_active }))}>
            <span className="box">{form.is_active && <Check size={14} />}</span>
            <span className="ct">Regelstrategie aktiv</span>
          </div>
        </div>

        <div className="m-foot">
          <button className="btn-soft" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={onSave} disabled={saving || !form.name}>{saving ? 'Speichern…' : 'Speichern'}</button>
        </div>
      </div>
    </div>
  );
}

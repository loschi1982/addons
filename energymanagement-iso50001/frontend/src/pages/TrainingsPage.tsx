/**
 * TrainingsPage – Schulungsdokumentation nach ISO 50001 Kap. 7.2/7.3.
 * Karten-Redesign nach Claude-Design-Handoff (schulungen.css, gescopt unter .sch).
 * Alle Daten aus dem Backend; Status „überfällig" wird aus dem Termin abgeleitet.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus, X, Search, Calendar, Clock, User, MapPin, ExternalLink, Shield,
  GraduationCap, CheckCircle2, AlertTriangle, Hourglass, Pencil, Trash2, Check,
  Users, Wrench, Briefcase, UserPlus,
} from 'lucide-react';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { apiClient } from '@/utils/api';
import PageHead from '@/components/ui/PageHead';

interface Training {
  id: string;
  title: string;
  training_type: string;
  iso_clause: string;
  topic: string;
  training_date: string;
  duration_hours: number | null;
  location: string;
  trainer: string;
  external_provider: string;
  participant_count: number;
  status: string;
  effectiveness_check: boolean;
  effectiveness_date: string | null;
  effectiveness_result: string;
  next_training_date: string | null;
  recurrence_months: number | null;
  notes: string;
}

interface Stats {
  total: number;
  planned: number;
  completed: number;
  due_count: number;
  due_soon: Array<{ id: string; title: string; next_training_date: string; overdue: boolean }>;
}

const STATUS_LABELS: Record<string, string> = { planned: 'Geplant', completed: 'Abgeschlossen', cancelled: 'Abgesagt' };

interface TypeMeta { label: string; Icon: typeof Users }
const TYPE_META: Record<string, TypeMeta> = {
  awareness: { label: 'Bewusstsein', Icon: Users },
  technical: { label: 'Technisch', Icon: Wrench },
  management: { label: 'Management', Icon: Briefcase },
  external: { label: 'Extern', Icon: ExternalLink },
  onboarding: { label: 'Einarbeitung', Icon: UserPlus },
};
const typeMeta = (k: string): TypeMeta => TYPE_META[k] || { label: k, Icon: GraduationCap };

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('de-DE') : '–');
const daysBetween = (d: string) => Math.round((new Date(d).getTime() - Date.now()) / 86_400_000);

// Anzeige-Status aus Backend-Status + Datum ableiten
type DisplayStatus = 'geplant' | 'abgeschlossen' | 'ueberfaellig' | 'abgesagt';
const STATUS_TONE: Record<DisplayStatus, string> = { geplant: 'info', abgeschlossen: 'good', ueberfaellig: 'alert', abgesagt: 'muted' };
const DISPLAY_LABEL: Record<DisplayStatus, string> = { geplant: 'Geplant', abgeschlossen: 'Abgeschlossen', ueberfaellig: 'Überfällig', abgesagt: 'Abgesagt' };

function displayStatus(t: Training): DisplayStatus {
  if (t.status === 'cancelled') return 'abgesagt';
  if (t.status === 'completed') return 'abgeschlossen';
  // planned: Termin in der Vergangenheit → überfällig
  return daysBetween(t.training_date) < 0 ? 'ueberfaellig' : 'geplant';
}

const emptyForm = {
  title: '',
  training_type: 'awareness',
  iso_clause: '7.2',
  topic: '',
  training_date: new Date().toISOString().split('T')[0],
  duration_hours: '',
  location: '',
  trainer: '',
  external_provider: '',
  participants: [] as string[],
  status: 'planned',
  effectiveness_check: false,
  notes: '',
  recurrence_months: '',
  next_training_date: '',
};

export default function TrainingsPage() {
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Training | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);

  const [filterStatus, setFilterStatus] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [filterType, setFilterType] = useState('alle');
  const [query, setQuery] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: '20' });
      if (filterStatus) params.set('status', filterStatus);
      if (filterYear) params.set('year', filterYear);
      const res = await apiClient.get<{ items: Training[]; total: number }>(`/api/v1/trainings?${params}`);
      setTrainings(res.data.items);
      setTotal(res.data.total);
    } catch {
      setError('Schulungen konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [page, filterStatus, filterYear]);

  const loadStats = useCallback(async () => {
    try {
      const res = await apiClient.get<Stats>('/api/v1/trainings/stats');
      setStats(res.data);
    } catch {
      // optional
    }
  }, []);

  useEffect(() => {
    loadData();
    loadStats();
  }, [loadData, loadStats]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  };

  const openEdit = (t: Training) => {
    setEditing(t);
    setForm({
      title: t.title,
      training_type: t.training_type,
      iso_clause: t.iso_clause ?? '7.2',
      topic: t.topic ?? '',
      training_date: t.training_date,
      duration_hours: t.duration_hours != null ? String(t.duration_hours) : '',
      location: t.location ?? '',
      trainer: t.trainer ?? '',
      external_provider: t.external_provider ?? '',
      participants: [],
      status: t.status,
      effectiveness_check: t.effectiveness_check ?? false,
      notes: t.notes ?? '',
      recurrence_months: t.recurrence_months != null ? String(t.recurrence_months) : '',
      next_training_date: t.next_training_date ?? '',
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        ...form,
        duration_hours: form.duration_hours ? Number(form.duration_hours) : null,
        recurrence_months: form.recurrence_months ? Number(form.recurrence_months) : null,
        next_training_date: form.next_training_date || null,
      };
      if (editing) {
        await apiClient.put(`/api/v1/trainings/${editing.id}`, payload);
      } else {
        await apiClient.post('/api/v1/trainings', payload);
      }
      setShowForm(false);
      loadData();
      loadStats();
    } catch {
      setError('Speichern fehlgeschlagen.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Schulung wirklich löschen?')) return;
    try {
      await apiClient.delete(`/api/v1/trainings/${id}`);
      loadData();
      loadStats();
    } catch {
      setError('Löschen fehlgeschlagen.');
    }
  };

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => String(currentYear - i));

  // Überfällig-Zahl aus den fälligen Wiederholungen
  const overdueCount = stats?.due_soon.filter((d) => d.overdue).length ?? 0;

  // Client-seitige Verfeinerung (Suche + Typ) auf der geladenen Seite
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return trainings.filter((t) => {
      if (filterType !== 'alle' && t.training_type !== filterType) return false;
      if (q) {
        const hay = `${t.title} ${t.trainer ?? ''} ${t.topic ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [trainings, filterType, query]);

  return (
    <div className="sch">
      <PageHead
        eyebrow="ISO 50001 · Kap. 7.2/7.3"
        title="Schulungen"
        actions={<button className="btn-primary" onClick={openCreate}><Plus size={13} /> Schulung anlegen</button>}
      />
      <div className="head-lead">
        <span className="pip"><span className="dot" /> Kap.&nbsp;<strong>7.2</strong>&nbsp;Kompetenz · <strong>7.3</strong>&nbsp;Bewusstsein</span>
        {stats && <span className="pip"><span className="dot" /> <strong>{stats.total}</strong>&nbsp;Maßnahmen</span>}
        {overdueCount > 0 && <span className="pip alert"><span className="dot" /> <strong>{overdueCount}</strong>&nbsp;überfällig</span>}
        {stats && stats.due_count > 0 && <span className="pip warn"><span className="dot" /> <strong>{stats.due_count}</strong>&nbsp;fällig (90 T.)</span>}
      </div>

      {error && (
        <div style={{ margin: '12px 0', background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '10px 14px', color: 'var(--alert)', fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{error}</span>
          <button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--alert)' }}><X size={16} /></button>
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {/* KPI-Reihe */}
        {stats && (
          <div className="sch-kpis">
            <div className="kpi accent-ink"><div className="kpi-top"><span className="kpi-ico"><GraduationCap size={13} /></span>Gesamt</div><div className="kpi-val">{stats.total}</div><div className="kpi-sub">Schulungsmaßnahmen</div></div>
            <div className="kpi accent-info"><div className="kpi-top"><span className="kpi-ico"><Calendar size={13} /></span>Geplant</div><div className="kpi-val">{stats.planned}</div><div className="kpi-sub">terminiert, offen</div></div>
            <div className="kpi accent-good"><div className="kpi-top"><span className="kpi-ico"><CheckCircle2 size={13} /></span>Abgeschlossen</div><div className="kpi-val">{stats.completed}</div><div className="kpi-sub">durchgeführt</div></div>
            <div className="kpi accent-warn"><div className="kpi-top"><span className="kpi-ico"><Hourglass size={13} /></span>Fällig 90 T.</div><div className="kpi-val">{stats.due_count}</div><div className="kpi-sub">Auffrischung/Termin</div></div>
            <div className="kpi accent-alert"><div className="kpi-top"><span className="kpi-ico"><AlertTriangle size={13} /></span>Überfällig</div><div className="kpi-val">{overdueCount}</div><div className="kpi-sub">Termin überschritten</div></div>
          </div>
        )}

        {/* Filterleiste */}
        <div className="toolbar2">
          <div className="search-input2">
            <Search size={13} color="var(--ink-4)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Titel, Trainer/in, Thema suchen…" />
          </div>
          <div className="group">
            Status
            <div className="pill-row">
              <span className={'pill' + (filterStatus === '' ? ' active' : '')} onClick={() => { setFilterStatus(''); setPage(1); }}>Alle</span>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <span key={k} className={'pill' + (filterStatus === k ? ' active' : '')} onClick={() => { setFilterStatus(k); setPage(1); }}>
                  {v}
                  {k === 'planned' && stats && <span className="count">{stats.planned}</span>}
                  {k === 'completed' && stats && <span className="count">{stats.completed}</span>}
                </span>
              ))}
            </div>
          </div>
          <div className="group">
            Typ
            <select className="tb-select" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="alle">Alle</option>
              {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <div className="group">
            Jahr
            <select className="tb-select" value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setPage(1); }}>
              <option value="">Alle</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Karten */}
        {loading ? (
          <div className="card" style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : visible.length === 0 ? (
          <div className="sch-empty"><span className="em-ico"><Search size={26} /></span><div>Keine Schulungen für diese Filter-Auswahl gefunden.</div></div>
        ) : (
          <div className="sch-list">
            {visible.map((t) => <SchCard key={t.id} t={t} onEdit={openEdit} onDelete={handleDelete} />)}
          </div>
        )}

        {/* Fuß + Pager */}
        <div className="sch-foot">
          <span><strong style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{visible.length}</strong> von {total} Schulungen</span>
          <span className="sep">·</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--info)' }} /> Geplant</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--good)' }} /> Abgeschlossen</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--alert)' }} /> Überfällig</span>
          {total > 20 && (
            <span className="sch-pager">
              <button className="btn-soft" style={{ padding: '5px 11px' }} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Zurück</button>
              <span style={{ fontFamily: 'var(--font-mono)' }}>Seite {page}</span>
              <button className="btn-soft" style={{ padding: '5px 11px' }} disabled={page * 20 >= total} onClick={() => setPage((p) => p + 1)}>Weiter</button>
            </span>
          )}
        </div>
      </div>

      {showForm && (
        <TrainingModal editing={!!editing} form={form} setForm={setForm} saving={saving} onClose={() => setShowForm(false)} onSave={handleSave} />
      )}
    </div>
  );
}

// ── Schulungs-Karte ──

function SchCard({ t, onEdit, onDelete }: { t: Training; onEdit: (t: Training) => void; onDelete: (id: string) => void }) {
  const ds = displayStatus(t);
  const ty = typeMeta(t.training_type);

  // Nächster-Termin-Block
  let next: { lbl: string; val: string; tag: string; tagCls: string } | null = null;
  if (ds === 'abgeschlossen') {
    if (t.next_training_date) {
      const dt = daysBetween(t.next_training_date);
      next = {
        lbl: 'Auffrischung', val: fmtDate(t.next_training_date),
        tag: dt < 0 ? 'überfällig' : dt <= 90 ? `in ${dt} T.` : t.recurrence_months ? `alle ${t.recurrence_months} Mon.` : 'geplant',
        tagCls: dt < 0 ? 'over' : dt <= 90 ? 'due' : 'ok',
      };
    } else {
      next = { lbl: 'Wiederholung', val: 'einmalig', tag: '—', tagCls: 'ok' };
    }
  } else if (ds !== 'abgesagt') {
    const dt = daysBetween(t.training_date);
    next = {
      lbl: 'Termin', val: fmtDate(t.training_date),
      tag: dt < 0 ? `${Math.abs(dt)} T. über` : dt <= 90 ? `in ${dt} T.` : 'geplant',
      tagCls: dt < 0 ? 'over' : dt <= 90 ? 'due' : 'ok',
    };
  }

  return (
    <article className={'sch-card s-' + ds}>
      <div className="sch-top">
        <div className="sch-title-wrap">
          <div className="sch-title-row">
            <span className="sch-title">{t.title}</span>
            {t.iso_clause && <span className="sch-klausel">ISO {t.iso_clause}</span>}
            <span className="sch-tag"><ty.Icon size={12} />{ty.label}</span>
          </div>
          {t.topic && <div className="sch-topic">{t.topic}</div>}
        </div>
        <div className="sch-top-right">
          <span className={'sch-eff' + (t.effectiveness_check ? ' done' : '')} title="Wirksamkeitsprüfung (ISO 7.2)">
            {t.effectiveness_check ? <Shield size={12} /> : <Clock size={12} />}
            {t.effectiveness_check ? 'Wirksamkeit geprüft' : 'Wirksamkeit offen'}
          </span>
          <span className={'sch-status ' + STATUS_TONE[ds]}><span className="dot" />{DISPLAY_LABEL[ds]}</span>
          <button className="sch-act" title="Bearbeiten" onClick={() => onEdit(t)}><Pencil size={14} /></button>
          <button className="sch-act danger" title="Löschen" onClick={() => onDelete(t.id)}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="sch-bottom">
        <div className="sch-meta">
          <span className="sch-meta-item"><Calendar size={13} /><span className="mono">{fmtDate(t.training_date)}</span></span>
          {t.duration_hours != null && t.duration_hours > 0 && <span className="sch-meta-item"><Clock size={13} /><span className="mono">{String(t.duration_hours).replace('.', ',')} h</span></span>}
          {t.trainer && <span className="sch-meta-item"><User size={13} />{t.trainer}</span>}
          {t.location && <span className="sch-meta-item"><MapPin size={13} />{t.location}</span>}
          {t.external_provider && <span className="sch-meta-item"><ExternalLink size={13} />{t.external_provider}</span>}
          {t.participant_count > 0 && <span className="sch-meta-item"><Users size={13} />{t.participant_count} Teiln.</span>}
        </div>
        {next && (
          <div className="sch-right">
            <div className="sch-next">
              <span className="sch-next-lbl">{next.lbl}</span>
              <span className="sch-next-val">{next.val} <span className={'sch-next-tag ' + next.tagCls}>{next.tag}</span></span>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

// ── Modal ──

const ISO_CLAUSES = ['4.1', '4.2', '5.1', '5.2', '6.1', '6.2', '7.1', '7.2', '7.3', '7.4', '8.1', '8.2', '9.1', '9.2', '9.3', '10.1', '10.2'];

function TrainingModal({
  editing, form, setForm, saving, onClose, onSave,
}: {
  editing: boolean;
  form: typeof emptyForm;
  setForm: React.Dispatch<React.SetStateAction<typeof emptyForm>>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="m-head">
          <div className="m-title-row">
            <span className="m-title-ico"><GraduationCap size={16} /></span>
            <div>
              <div className="m-title">{editing ? 'Schulung bearbeiten' : 'Neue Schulung'}</div>
              <div className="m-sub">ISO 50001 Kap. 7.2 Kompetenz / 7.3 Bewusstsein</div>
            </div>
          </div>
          <button className="m-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="m-body">
          <div className="field">
            <label>Titel<span className="req">*</span></label>
            <input className="inp" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </div>
          <div className="field-row c2">
            <div className="field">
              <label>Schulungstyp</label>
              <select className="sel" value={form.training_type} onChange={(e) => setForm((f) => ({ ...f, training_type: e.target.value }))}>
                {Object.entries(TYPE_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>ISO-Klausel</label>
              <select className="sel" value={form.iso_clause} onChange={(e) => setForm((f) => ({ ...f, iso_clause: e.target.value }))}>
                {ISO_CLAUSES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Thema / Inhalt</label><input className="inp" value={form.topic} onChange={(e) => setForm((f) => ({ ...f, topic: e.target.value }))} /></div>

          <div className="f-divider">Durchführung</div>
          <div className="field-row c2">
            <div className="field"><label>Datum<span className="req">*</span></label><input type="date" className="inp mono" value={form.training_date} onChange={(e) => setForm((f) => ({ ...f, training_date: e.target.value }))} /></div>
            <div className="field"><label>Dauer (Stunden)</label><input type="number" step="0.5" className="inp mono" value={form.duration_hours} onChange={(e) => setForm((f) => ({ ...f, duration_hours: e.target.value }))} /></div>
            <div className="field"><label>Ort</label><input className="inp" value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
            <div className="field"><label>Trainer/in</label><input className="inp" value={form.trainer} onChange={(e) => setForm((f) => ({ ...f, trainer: e.target.value }))} /></div>
            <div className="field"><label>Externer Anbieter</label><input className="inp" value={form.external_provider} onChange={(e) => setForm((f) => ({ ...f, external_provider: e.target.value }))} /></div>
            <div className="field">
              <label>Status</label>
              <select className="sel" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div className="f-divider">Wiederholung & Wirksamkeit</div>
          <div className="field-row c2">
            <div className="field"><label>Wiederholung (Monate)</label><input type="number" className="inp mono" placeholder="z. B. 12" value={form.recurrence_months} onChange={(e) => setForm((f) => ({ ...f, recurrence_months: e.target.value }))} /></div>
            <div className="field"><label>Nächster Termin</label><input type="date" className="inp mono" value={form.next_training_date} onChange={(e) => setForm((f) => ({ ...f, next_training_date: e.target.value }))} /></div>
          </div>
          <div className={'chk-line' + (form.effectiveness_check ? ' on' : '')} onClick={() => setForm((f) => ({ ...f, effectiveness_check: !f.effectiveness_check }))}>
            <span className="box">{form.effectiveness_check && <Check size={14} />}</span>
            <span className="ct">Wirksamkeitsprüfung durchgeführt</span>
          </div>

          <div className="field"><label>Notizen</label><textarea className="ta" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
        </div>

        <div className="m-foot">
          <button className="btn-soft" onClick={onClose}>Abbrechen</button>
          <button className="btn-primary" onClick={onSave} disabled={saving || !form.title || !form.training_date}>{saving ? 'Speichern…' : 'Speichern'}</button>
        </div>
      </div>
    </div>
  );
}

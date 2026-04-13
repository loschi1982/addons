/**
 * TrainingsPage – Schulungsdokumentation nach ISO 50001 Kap. 7.2/7.3.
 */

import { useState, useEffect, useCallback } from 'react';
import { GraduationCap, Plus, X, AlertCircle, CheckCircle, Clock } from 'lucide-react';
import { apiClient } from '@/utils/api';

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

const STATUS_LABELS: Record<string, string> = {
  planned: 'Geplant',
  completed: 'Abgeschlossen',
  cancelled: 'Abgesagt',
};

const TYPE_LABELS: Record<string, string> = {
  awareness: 'Bewusstseinsschulung',
  technical: 'Technische Schulung',
  management: 'Managementschulung',
  external: 'Externe Weiterbildung',
  onboarding: 'Einarbeitung',
};

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    planned: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
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
      // Stats sind optional
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GraduationCap size={24} className="text-primary-600" />
          <h1 className="page-title">Schulungen (ISO 50001 Kap. 7.2/7.3)</h1>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={openCreate}>
          <Plus size={16} /> Schulung anlegen
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')}><X size={16} /></button>
        </div>
      )}

      {/* Statistiken */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card text-center">
            <div className="text-2xl font-bold text-primary-700">{stats.total}</div>
            <div className="text-sm text-gray-500">Gesamt</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-blue-600">{stats.planned}</div>
            <div className="text-sm text-gray-500">Geplant</div>
          </div>
          <div className="card text-center">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <div className="text-sm text-gray-500">Abgeschlossen</div>
          </div>
          <div className="card text-center">
            <div className={`text-2xl font-bold ${stats.due_count > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
              {stats.due_count}
            </div>
            <div className="text-sm text-gray-500">Fällig (90 Tage)</div>
          </div>
        </div>
      )}

      {/* Fällige Wiederholungen */}
      {stats && stats.due_soon.length > 0 && (
        <div className="card border-l-4 border-orange-400">
          <h2 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <Clock size={16} className="text-orange-500" />
            Fällige Wiederholungen
          </h2>
          <div className="space-y-2">
            {stats.due_soon.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm">
                <span className="text-gray-700">{d.title}</span>
                <span className={`flex items-center gap-1 ${d.overdue ? 'text-red-600 font-medium' : 'text-orange-600'}`}>
                  {d.overdue && <AlertCircle size={14} />}
                  {d.next_training_date ? new Date(d.next_training_date).toLocaleDateString('de-DE') : '–'}
                  {d.overdue && ' (überfällig)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex flex-wrap gap-3">
        <div>
          <label className="label">Status</label>
          <select className="input" value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}>
            <option value="">Alle</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Jahr</label>
          <select className="input" value={filterYear} onChange={(e) => { setFilterYear(e.target.value); setPage(1); }}>
            <option value="">Alle</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      {/* Tabelle */}
      <div className="card">
        {loading ? (
          <div className="py-12 text-center text-gray-500">Laden...</div>
        ) : trainings.length === 0 ? (
          <div className="py-12 text-center text-gray-500">Keine Schulungen gefunden.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-600">
                    <th className="pb-2 pr-4">Titel</th>
                    <th className="pb-2 pr-4">Typ</th>
                    <th className="pb-2 pr-4">Klausel</th>
                    <th className="pb-2 pr-4">Datum</th>
                    <th className="pb-2 pr-4">Dauer</th>
                    <th className="pb-2 pr-4">Teilnehmer</th>
                    <th className="pb-2 pr-4">Status</th>
                    <th className="pb-2 pr-4">Wirksamkeit</th>
                    <th className="pb-2">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {trainings.map((t) => (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="py-2 pr-4 font-medium text-gray-800">{t.title}</td>
                      <td className="py-2 pr-4 text-gray-600">{TYPE_LABELS[t.training_type] ?? t.training_type}</td>
                      <td className="py-2 pr-4 text-gray-600">{t.iso_clause}</td>
                      <td className="py-2 pr-4">{new Date(t.training_date).toLocaleDateString('de-DE')}</td>
                      <td className="py-2 pr-4">{t.duration_hours != null ? `${t.duration_hours} h` : '–'}</td>
                      <td className="py-2 pr-4">{t.participant_count}</td>
                      <td className="py-2 pr-4"><StatusBadge status={t.status} /></td>
                      <td className="py-2 pr-4">
                        {t.effectiveness_check ? (
                          <span className="flex items-center gap-1 text-green-600 text-xs">
                            <CheckCircle size={14} /> Geprüft
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">Ausstehend</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex gap-2">
                          <button
                            className="text-primary-600 hover:text-primary-800 text-xs"
                            onClick={() => openEdit(t)}
                          >
                            Bearbeiten
                          </button>
                          <button
                            className="text-red-500 hover:text-red-700 text-xs"
                            onClick={() => handleDelete(t.id)}
                          >
                            Löschen
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Paginierung */}
            {total > 20 && (
              <div className="flex justify-between items-center mt-4 text-sm text-gray-600">
                <span>{total} Schulungen gesamt</span>
                <div className="flex gap-2">
                  <button className="btn-secondary py-1 px-3" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    Zurück
                  </button>
                  <button className="btn-secondary py-1 px-3" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>
                    Weiter
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Formular-Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-lg font-semibold">
                {editing ? 'Schulung bearbeiten' : 'Neue Schulung'}
              </h2>
              <button onClick={() => setShowForm(false)}><X size={20} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="label">Titel *</label>
                  <input
                    className="input"
                    value={form.title}
                    onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Schulungstyp</label>
                  <select
                    className="input"
                    value={form.training_type}
                    onChange={(e) => setForm(f => ({ ...f, training_type: e.target.value }))}
                  >
                    {Object.entries(TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">ISO-Klausel</label>
                  <select
                    className="input"
                    value={form.iso_clause}
                    onChange={(e) => setForm(f => ({ ...f, iso_clause: e.target.value }))}
                  >
                    {['4.1', '4.2', '5.1', '5.2', '6.1', '6.2', '7.1', '7.2', '7.3', '7.4', '8.1', '8.2', '9.1', '9.2', '9.3', '10.1', '10.2'].map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Datum *</label>
                  <input
                    type="date"
                    className="input"
                    value={form.training_date}
                    onChange={(e) => setForm(f => ({ ...f, training_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Dauer (Stunden)</label>
                  <input
                    type="number"
                    step="0.5"
                    className="input"
                    value={form.duration_hours}
                    onChange={(e) => setForm(f => ({ ...f, duration_hours: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Ort</label>
                  <input
                    className="input"
                    value={form.location}
                    onChange={(e) => setForm(f => ({ ...f, location: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Trainer/in</label>
                  <input
                    className="input"
                    value={form.trainer}
                    onChange={(e) => setForm(f => ({ ...f, trainer: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Externer Anbieter</label>
                  <input
                    className="input"
                    value={form.external_provider}
                    onChange={(e) => setForm(f => ({ ...f, external_provider: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select
                    className="input"
                    value={form.status}
                    onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}
                  >
                    {Object.entries(STATUS_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Wiederholung (Monate)</label>
                  <input
                    type="number"
                    className="input"
                    placeholder="z.B. 12"
                    value={form.recurrence_months}
                    onChange={(e) => setForm(f => ({ ...f, recurrence_months: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="label">Nächster Termin</label>
                  <input
                    type="date"
                    className="input"
                    value={form.next_training_date}
                    onChange={(e) => setForm(f => ({ ...f, next_training_date: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="eff_check"
                    checked={form.effectiveness_check}
                    onChange={(e) => setForm(f => ({ ...f, effectiveness_check: e.target.checked }))}
                  />
                  <label htmlFor="eff_check" className="text-sm text-gray-700">
                    Wirksamkeitsprüfung durchgeführt
                  </label>
                </div>
                <div className="md:col-span-2">
                  <label className="label">Thema / Inhalt</label>
                  <input
                    className="input"
                    value={form.topic}
                    onChange={(e) => setForm(f => ({ ...f, topic: e.target.value }))}
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="label">Notizen</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={form.notes}
                    onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 p-6 border-t">
              <button className="btn-secondary" onClick={() => setShowForm(false)}>Abbrechen</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving || !form.title || !form.training_date}>
                {saving ? 'Speichern...' : 'Speichern'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

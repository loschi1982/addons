import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';

// ── Typen ──

interface Consumer {
  id: string;
  name: string;
  category: string;
  rated_power_kw: number | null;
  operating_hours_per_year: number | null;
  estimated_annual_kwh: number | null;
  priority: string;
  usage_unit_id: string | null;
  description: string | null;
  created_at: string;
}

interface ConsumerForm {
  name: string;
  category: string;
  rated_power_kw: string;
  operating_hours_per_year: string;
  priority: string;
  description: string;
}

const emptyForm: ConsumerForm = {
  name: '',
  category: 'hvac',
  rated_power_kw: '',
  operating_hours_per_year: '',
  priority: 'normal',
  description: '',
};

const CATEGORIES: Record<string, string> = {
  hvac: 'Heizung/Lüftung/Klima',
  lighting: 'Beleuchtung',
  production: 'Produktion',
  compressed_air: 'Druckluft',
  cooling: 'Kälte',
  pumps: 'Pumpen',
  drives: 'Antriebe',
  it: 'IT / Rechenzentrum',
  other: 'Sonstige',
};

const PRIORITIES: Record<string, string> = {
  high: 'Hoch',
  normal: 'Normal',
  low: 'Niedrig',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-50 text-red-700',
  normal: 'bg-gray-100 text-gray-700',
  low: 'bg-green-50 text-green-700',
};

// ── Komponente ──

export default function ConsumersPage() {
  const [consumers, setConsumers] = useState<Consumer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal-State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ConsumerForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

  const loadConsumers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (search) params.append('search', search);
      if (filterCategory) params.append('category', filterCategory);

      const response = await apiClient.get<PaginatedResponse<Consumer>>(
        `/api/v1/consumers?${params}`
      );
      setConsumers(response.data.items);
      setTotal(response.data.total);
    } catch {
      // Fehler wird vom Interceptor behandelt
    } finally {
      setLoading(false);
    }
  }, [page, search, filterCategory]);

  useEffect(() => {
    loadConsumers();
  }, [loadConsumers]);

  const handleCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const handleEdit = (consumer: Consumer) => {
    setEditingId(consumer.id);
    setForm({
      name: consumer.name,
      category: consumer.category,
      rated_power_kw: consumer.rated_power_kw?.toString() || '',
      operating_hours_per_year: consumer.operating_hours_per_year?.toString() || '',
      priority: consumer.priority || 'normal',
      description: consumer.description || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleDelete = async (consumer: Consumer) => {
    if (!confirm(`Verbraucher "${consumer.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/consumers/${consumer.id}`);
      loadConsumers();
    } catch {
      // Fehler wird vom Interceptor behandelt
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    const payload: Record<string, unknown> = {
      name: form.name,
      category: form.category,
      priority: form.priority,
    };
    if (form.rated_power_kw) payload.rated_power_kw = parseFloat(form.rated_power_kw);
    if (form.operating_hours_per_year) payload.operating_hours_per_year = parseInt(form.operating_hours_per_year, 10);
    if (form.description) payload.description = form.description;

    try {
      if (editingId) {
        await apiClient.put(`/api/v1/consumers/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/consumers', payload);
      }
      setShowModal(false);
      loadConsumers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Verbraucher</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} Verbraucher insgesamt – Großverbraucher und energetisch relevante Anlagen
          </p>
        </div>
        <button onClick={handleCreate} className="btn-primary">
          + Neuer Verbraucher
        </button>
      </div>

      {/* Filter */}
      <div className="card mt-4 flex gap-4">
        <input
          type="text"
          className="input flex-1"
          placeholder="Suche nach Name oder Beschreibung..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="input w-48"
          value={filterCategory}
          onChange={(e) => { setFilterCategory(e.target.value); setPage(1); }}
        >
          <option value="">Alle Kategorien</option>
          {Object.entries(CATEGORIES).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Tabelle */}
      <div className="card mt-4 overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : consumers.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Keine Verbraucher gefunden. Legen Sie den ersten Verbraucher an.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Kategorie</th>
                <th className="px-4 py-3 text-right">Nennleistung</th>
                <th className="px-4 py-3 text-right">Betriebsstunden/a</th>
                <th className="px-4 py-3">Priorität</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {consumers.map((consumer) => (
                <tr key={consumer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{consumer.name}</div>
                    {consumer.description && (
                      <div className="text-xs text-gray-400 truncate max-w-xs">
                        {consumer.description}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {CATEGORIES[consumer.category] || consumer.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {consumer.rated_power_kw != null
                      ? `${consumer.rated_power_kw} kW`
                      : '–'}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500">
                    {consumer.operating_hours_per_year != null
                      ? consumer.operating_hours_per_year.toLocaleString('de-DE')
                      : '–'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[consumer.priority] || PRIORITY_COLORS.normal}`}>
                      {PRIORITIES[consumer.priority] || consumer.priority}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleEdit(consumer)}
                      className="mr-2 text-primary-600 hover:text-primary-800"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => handleDelete(consumer)}
                      className="text-red-500 hover:text-red-700"
                    >
                      Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Seite {page} von {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              className="btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Zurück
            </button>
            <button
              className="btn-secondary"
              disabled={page >= totalPages}
              onClick={() => setPage(page + 1)}
            >
              Weiter
            </button>
          </div>
        </div>
      )}

      {/* Modal: Verbraucher erstellen/bearbeiten */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">
              {editingId ? 'Verbraucher bearbeiten' : 'Neuer Verbraucher'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
                  {formError}
                </div>
              )}

              <div>
                <label className="label">Name *</label>
                <input
                  type="text"
                  className="input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Kategorie *</label>
                  <select
                    className="input"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                  >
                    {Object.entries(CATEGORIES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Priorität</label>
                  <select
                    className="input"
                    value={form.priority}
                    onChange={(e) => setForm({ ...form, priority: e.target.value })}
                  >
                    {Object.entries(PRIORITIES).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Nennleistung (kW)</label>
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={form.rated_power_kw}
                    onChange={(e) => setForm({ ...form, rated_power_kw: e.target.value })}
                    placeholder="z.B. 15.5"
                  />
                </div>
                <div>
                  <label className="label">Betriebsstunden / Jahr</label>
                  <input
                    type="number"
                    className="input"
                    value={form.operating_hours_per_year}
                    onChange={(e) => setForm({ ...form, operating_hours_per_year: e.target.value })}
                    placeholder="z.B. 2500"
                  />
                </div>
              </div>

              <div>
                <label className="label">Beschreibung</label>
                <textarea
                  className="input"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Optionale Beschreibung der Anlage..."
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  Abbrechen
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

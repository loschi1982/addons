import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';
import { useSiteHierarchy } from '@/hooks/useSiteHierarchy';

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
  meter_ids: string[];
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  commissioned_at: string | null;
  decommissioned_at: string | null;
  replaced_by_id: string | null;
  replaced_by_name: string | null;
  created_at: string;
}

interface MeterOption {
  id: string;
  name: string;
  energy_type: string;
}

interface ConsumerForm {
  name: string;
  category: string;
  rated_power_kw: string;
  operating_hours_per_year: string;
  priority: string;
  description: string;
  meter_ids: string[];
  manufacturer: string;
  model: string;
  serial_number: string;
  commissioned_at: string;
  decommissioned_at: string;
  replaced_by_id: string;
}

const emptyForm: ConsumerForm = {
  name: '',
  category: 'hvac',
  rated_power_kw: '',
  operating_hours_per_year: '',
  priority: 'normal',
  description: '',
  meter_ids: [],
  manufacturer: '',
  model: '',
  serial_number: '',
  commissioned_at: '',
  decommissioned_at: '',
  replaced_by_id: '',
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
  const [filterStatus, setFilterStatus] = useState('active');
  const [loading, setLoading] = useState(true);

  // Modal-State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingConsumer, setEditingConsumer] = useState<Consumer | null>(null);
  const [form, setForm] = useState<ConsumerForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ersetzen-Modal
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [replacingConsumer, setReplacingConsumer] = useState<Consumer | null>(null);
  const [replaceForm, setReplaceForm] = useState<ConsumerForm>(emptyForm);

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
      if (filterStatus) params.append('status', filterStatus);

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
  }, [page, search, filterCategory, filterStatus]);

  useEffect(() => {
    loadConsumers();
  }, [loadConsumers]);

  const handleCreate = () => {
    setEditingId(null);
    setEditingConsumer(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const handleEdit = (consumer: Consumer) => {
    setEditingId(consumer.id);
    setEditingConsumer(consumer);
    setForm({
      name: consumer.name,
      category: consumer.category,
      rated_power_kw: consumer.rated_power_kw?.toString() || '',
      operating_hours_per_year: consumer.operating_hours_per_year?.toString() || '',
      priority: consumer.priority || 'normal',
      description: consumer.description || '',
      meter_ids: consumer.meter_ids || [],
      manufacturer: consumer.manufacturer || '',
      model: consumer.model || '',
      serial_number: consumer.serial_number || '',
      commissioned_at: consumer.commissioned_at || '',
      decommissioned_at: consumer.decommissioned_at || '',
      replaced_by_id: consumer.replaced_by_id || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleReplace = (consumer: Consumer) => {
    setReplacingConsumer(consumer);
    setReplaceForm({
      ...emptyForm,
      name: consumer.name + ' (Nachfolger)',
      category: consumer.category,
      rated_power_kw: consumer.rated_power_kw?.toString() || '',
      operating_hours_per_year: consumer.operating_hours_per_year?.toString() || '',
      priority: consumer.priority || 'normal',
      description: '',
      meter_ids: consumer.meter_ids || [],
      manufacturer: '',
      model: '',
      serial_number: '',
      commissioned_at: new Date().toISOString().split('T')[0],
      decommissioned_at: '',
      replaced_by_id: '',
    });
    setFormError(null);
    setShowReplaceModal(true);
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

  const handleSubmit = async (e: React.FormEvent, unitId: string, meterIds: string[]) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    const payload: Record<string, unknown> = {
      name: form.name,
      category: form.category,
      priority: form.priority,
      usage_unit_id: unitId || null,
      meter_ids: meterIds,
    };
    if (form.rated_power_kw) payload.rated_power_kw = parseFloat(form.rated_power_kw);
    if (form.operating_hours_per_year) payload.operating_hours_per_year = parseInt(form.operating_hours_per_year, 10);
    if (form.description) payload.description = form.description;
    if (form.manufacturer) payload.manufacturer = form.manufacturer;
    if (form.model) payload.model = form.model;
    if (form.serial_number) payload.serial_number = form.serial_number;
    if (form.commissioned_at) payload.commissioned_at = form.commissioned_at;
    if (form.decommissioned_at) payload.decommissioned_at = form.decommissioned_at;
    if (form.replaced_by_id) payload.replaced_by_id = form.replaced_by_id;

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

  const handleReplaceSubmit = async (e: React.FormEvent, unitId: string, meterIds: string[]) => {
    e.preventDefault();
    if (!replacingConsumer) return;
    setFormError(null);
    setSaving(true);

    const payload: Record<string, unknown> = {
      name: replaceForm.name,
      category: replaceForm.category,
      priority: replaceForm.priority,
      usage_unit_id: unitId || replacingConsumer.usage_unit_id || null,
      meter_ids: meterIds,
    };
    if (replaceForm.rated_power_kw) payload.rated_power_kw = parseFloat(replaceForm.rated_power_kw);
    if (replaceForm.operating_hours_per_year) payload.operating_hours_per_year = parseInt(replaceForm.operating_hours_per_year, 10);
    if (replaceForm.description) payload.description = replaceForm.description;
    if (replaceForm.manufacturer) payload.manufacturer = replaceForm.manufacturer;
    if (replaceForm.model) payload.model = replaceForm.model;
    if (replaceForm.serial_number) payload.serial_number = replaceForm.serial_number;
    if (replaceForm.commissioned_at) payload.commissioned_at = replaceForm.commissioned_at;

    try {
      await apiClient.post(`/api/v1/consumers/${replacingConsumer.id}/replace`, payload);
      setShowReplaceModal(false);
      loadConsumers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Ersetzen');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  const formatDate = (d: string | null) => {
    if (!d) return null;
    return new Date(d).toLocaleDateString('de-DE');
  };

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
          placeholder="Suche nach Name, Beschreibung, Hersteller, Modell..."
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
        <select
          className="input w-48"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="active">Nur aktive</option>
          <option value="decommissioned">Außer Betrieb</option>
          <option value="all">Alle</option>
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
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {consumers.map((consumer) => {
                const isDecommissioned = !!consumer.decommissioned_at;
                return (
                  <tr
                    key={consumer.id}
                    className={isDecommissioned ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'}
                  >
                    <td className="px-4 py-3">
                      <div className={`font-medium ${isDecommissioned ? 'line-through text-gray-400' : ''}`}>
                        {consumer.name}
                      </div>
                      {consumer.manufacturer && (
                        <div className="text-xs text-gray-400">
                          {consumer.manufacturer}
                          {consumer.model ? ` – ${consumer.model}` : ''}
                        </div>
                      )}
                      {consumer.description && !consumer.manufacturer && (
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
                    <td className="px-4 py-3">
                      {isDecommissioned ? (
                        <div>
                          <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
                            Außer Betrieb
                          </span>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {formatDate(consumer.decommissioned_at)}
                          </div>
                          {consumer.replaced_by_name && (
                            <div className="text-xs text-gray-400 mt-0.5">
                              Ersetzt durch: {consumer.replaced_by_name}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                          Aktiv
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleEdit(consumer)}
                        className="mr-2 text-primary-600 hover:text-primary-800"
                      >
                        Bearbeiten
                      </button>
                      {!isDecommissioned && (
                        <button
                          onClick={() => handleReplace(consumer)}
                          className="mr-2 text-amber-600 hover:text-amber-800"
                          title="Durch neuen Verbraucher ersetzen"
                        >
                          Ersetzen
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(consumer)}
                        className="text-red-500 hover:text-red-700"
                      >
                        Löschen
                      </button>
                    </td>
                  </tr>
                );
              })}
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
        <ConsumerModal
          editingId={editingId}
          editingConsumer={editingConsumer}
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}

      {/* Modal: Verbraucher ersetzen */}
      {showReplaceModal && replacingConsumer && (
        <ConsumerModal
          editingId={null}
          editingConsumer={null}
          form={replaceForm}
          setForm={setReplaceForm}
          formError={formError}
          saving={saving}
          onSubmit={handleReplaceSubmit}
          onClose={() => setShowReplaceModal(false)}
          replaceMode
          replacingName={replacingConsumer.name}
          replacingUnitId={replacingConsumer.usage_unit_id}
        />
      )}
    </div>
  );
}

/* ── Verbraucher-Modal mit Standort-Kaskade + Zähler-Zuordnung ── */

function ConsumerModal({
  editingId,
  editingConsumer,
  form,
  setForm,
  formError,
  saving,
  onSubmit,
  onClose,
  replaceMode = false,
  replacingName,
  replacingUnitId,
}: {
  editingId: string | null;
  editingConsumer: Consumer | null;
  form: ConsumerForm;
  setForm: (f: ConsumerForm) => void;
  formError: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent, unitId: string, meterIds: string[]) => void;
  onClose: () => void;
  replaceMode?: boolean;
  replacingName?: string;
  replacingUnitId?: string | null;
}) {
  const hierarchy = useSiteHierarchy(editingConsumer?.usage_unit_id || replacingUnitId || undefined);
  const [meters, setMeters] = useState<MeterOption[]>([]);
  const [selectedMeterIds, setSelectedMeterIds] = useState<string[]>(form.meter_ids || []);
  const [allConsumers, setAllConsumers] = useState<{ id: string; name: string }[]>([]);

  // Zähler-Liste laden
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/api/v1/meters?page_size=100');
        setMeters(
          (res.data.items || []).map((m: Record<string, unknown>) => ({
            id: m.id as string,
            name: m.name as string,
            energy_type: m.energy_type as string,
          }))
        );
      } catch {
        // ignore
      }
    })();
  }, []);

  // Aktive Verbraucher laden (für "Ersetzt durch"-Dropdown)
  useEffect(() => {
    if (!editingId) return;
    (async () => {
      try {
        const res = await apiClient.get<PaginatedResponse<Consumer>>(
          '/api/v1/consumers?page_size=200&status=active'
        );
        setAllConsumers(
          (res.data.items || [])
            .filter((c: Consumer) => c.id !== editingId)
            .map((c: Consumer) => ({ id: c.id, name: c.name }))
        );
      } catch {
        // ignore
      }
    })();
  }, [editingId]);

  const toggleMeter = (id: string) => {
    setSelectedMeterIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  };

  const title = replaceMode
    ? `Verbraucher ersetzen: ${replacingName}`
    : editingId
      ? 'Verbraucher bearbeiten'
      : 'Neuer Verbraucher';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">{title}</h2>

        {replaceMode && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            Der bisherige Verbraucher <strong>{replacingName}</strong> wird außer Betrieb genommen
            und durch den neuen Verbraucher ersetzt.
          </div>
        )}

        <form onSubmit={(e) => onSubmit(e, hierarchy.selectedUnitId, selectedMeterIds)} className="space-y-4">
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
              rows={2}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optionale Beschreibung der Anlage..."
            />
          </div>

          {/* Gerätedaten */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Gerätedaten (optional)</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Hersteller</label>
                <input
                  type="text"
                  className="input"
                  value={form.manufacturer}
                  onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                  placeholder="z.B. Viessmann"
                />
              </div>
              <div>
                <label className="label">Modell / Typ</label>
                <input
                  type="text"
                  className="input"
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="z.B. Vitocrossal 300"
                />
              </div>
              <div>
                <label className="label">Seriennummer</label>
                <input
                  type="text"
                  className="input"
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  placeholder="z.B. SN-12345"
                />
              </div>
            </div>
          </div>

          {/* Lebenszyklus */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Lebenszyklus</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Inbetriebnahme</label>
                <input
                  type="date"
                  className="input"
                  value={form.commissioned_at}
                  onChange={(e) => setForm({ ...form, commissioned_at: e.target.value })}
                />
              </div>
              {!replaceMode && (
                <div>
                  <label className="label">Außerbetriebnahme</label>
                  <input
                    type="date"
                    className="input"
                    value={form.decommissioned_at}
                    onChange={(e) => setForm({ ...form, decommissioned_at: e.target.value })}
                  />
                </div>
              )}
            </div>
            {/* "Ersetzt durch"-Dropdown nur im Bearbeitungsmodus und wenn decommissioned_at gesetzt */}
            {editingId && form.decommissioned_at && allConsumers.length > 0 && (
              <div className="mt-4">
                <label className="label">Ersetzt durch</label>
                <select
                  className="input"
                  value={form.replaced_by_id}
                  onChange={(e) => setForm({ ...form, replaced_by_id: e.target.value })}
                >
                  <option value="">– Kein Nachfolger –</option>
                  {allConsumers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Zuordnung: Standort → Gebäude → Nutzungseinheit */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Standort-Zuordnung (optional)</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Standort</label>
                <select
                  className="input"
                  value={hierarchy.selectedSiteId}
                  onChange={(e) => hierarchy.setSelectedSiteId(e.target.value)}
                >
                  <option value="">– Kein Standort –</option>
                  {hierarchy.sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Gebäude</label>
                <select
                  className="input"
                  value={hierarchy.selectedBuildingId}
                  onChange={(e) => hierarchy.setSelectedBuildingId(e.target.value)}
                  disabled={!hierarchy.selectedSiteId}
                >
                  <option value="">– Kein Gebäude –</option>
                  {hierarchy.buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Nutzungseinheit</label>
                <select
                  className="input"
                  value={hierarchy.selectedUnitId}
                  onChange={(e) => hierarchy.setSelectedUnitId(e.target.value)}
                  disabled={!hierarchy.selectedBuildingId}
                >
                  <option value="">– Keine Einheit –</option>
                  {hierarchy.units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Zähler-Zuordnung */}
          {meters.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">
                Zähler-Zuordnung (optional)
              </p>
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                {meters.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-white"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMeterIds.includes(m.id)}
                      onChange={() => toggleMeter(m.id)}
                      className="rounded border-gray-300 text-primary-500"
                    />
                    <span className="text-sm">{m.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary"
            >
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving
                ? 'Speichern...'
                : replaceMode
                  ? 'Ersetzen'
                  : editingId
                    ? 'Speichern'
                    : 'Anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

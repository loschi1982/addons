import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Network } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';
import { useSiteHierarchy } from '@/hooks/useSiteHierarchy';

// ── Typen ──

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
  data_source: string;
  location: string | null;
  site_id: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  is_active: boolean;
  is_weather_corrected: boolean;
  source_config: Record<string, unknown> | null;
  created_at: string;
}

interface MeterForm {
  name: string;
  meter_number: string;
  energy_type: string;
  unit: string;
  data_source: string;
  location: string;
  is_weather_corrected: boolean;
  source_config_ip: string;
  source_config_channel: string;
  source_config_mode: string;
  source_config_register: string;
  source_config_entity_id: string;
}

const emptyForm: MeterForm = {
  name: '',
  meter_number: '',
  energy_type: 'electricity',
  unit: 'kWh',
  data_source: 'manual',
  location: '',
  is_weather_corrected: false,
  source_config_ip: '',
  source_config_channel: '0',
  source_config_mode: 'single',
  source_config_register: '',
  source_config_entity_id: '',
};

const DATA_SOURCES: Record<string, string> = {
  manual: 'Manuell',
  shelly: 'Shelly',
  modbus: 'Modbus',
  knx: 'KNX',
  homeassistant: 'Home Assistant',
};

// ── Komponente ──

export default function MetersPage() {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal-State
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [form, setForm] = useState<MeterForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

  const loadMeters = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (search) params.append('search', search);
      if (filterType) params.append('energy_type', filterType);

      const response = await apiClient.get<PaginatedResponse<Meter>>(
        `/api/v1/meters?${params}`
      );
      setMeters(response.data.items);
      setTotal(response.data.total);
    } catch {
      // Fehler wird vom Interceptor behandelt
    } finally {
      setLoading(false);
    }
  }, [page, search, filterType]);

  useEffect(() => {
    loadMeters();
  }, [loadMeters]);

  const handleCreate = () => {
    setEditingId(null);
    setEditingMeter(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const handleEdit = (meter: Meter) => {
    setEditingId(meter.id);
    setEditingMeter(meter);
    const cfg = meter.source_config || {};
    setForm({
      name: meter.name,
      meter_number: meter.meter_number || '',
      energy_type: meter.energy_type,
      unit: meter.unit,
      data_source: meter.data_source,
      location: meter.location || '',
      is_weather_corrected: meter.is_weather_corrected,
      source_config_ip: (cfg.ip as string) || '',
      source_config_channel: (cfg.channel?.toString()) || '0',
      source_config_mode: (cfg.mode as string) || 'single',
      source_config_register: (cfg.register?.toString()) || '',
      source_config_entity_id: (cfg.entity_id as string) || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleDelete = async (meter: Meter) => {
    if (!confirm(`Zähler "${meter.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/meters/${meter.id}`);
      loadMeters();
    } catch {
      // Fehler wird vom Interceptor behandelt
    }
  };

  const handleSubmit = async (e: React.FormEvent, hierarchy: { siteId: string; buildingId: string; unitId: string }) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    // source_config zusammenbauen
    const source_config: Record<string, unknown> = {};
    if (form.data_source === 'shelly') {
      if (form.source_config_ip) source_config.ip = form.source_config_ip;
      source_config.mode = form.source_config_mode;
      if (form.source_config_mode === 'balanced') {
        source_config.channels = [0, 1, 2];
      } else {
        source_config.channel = parseInt(form.source_config_channel) || 0;
      }
    } else if (form.data_source === 'modbus') {
      if (form.source_config_ip) source_config.ip = form.source_config_ip;
      if (form.source_config_register) source_config.register = parseInt(form.source_config_register);
    } else if (form.data_source === 'homeassistant') {
      if (form.source_config_entity_id) source_config.entity_id = form.source_config_entity_id;
    }

    // Zuordnung: nur die tiefste gewählte Ebene setzen
    const payload: Record<string, unknown> = {
      name: form.name,
      meter_number: form.meter_number || null,
      energy_type: form.energy_type,
      unit: form.unit,
      data_source: form.data_source,
      location: form.location || null,
      is_weather_corrected: form.is_weather_corrected,
      site_id: hierarchy.siteId || null,
      building_id: hierarchy.buildingId || null,
      usage_unit_id: hierarchy.unitId || null,
      source_config: Object.keys(source_config).length > 0 ? source_config : null,
    };

    try {
      if (editingId) {
        await apiClient.put(`/api/v1/meters/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/meters', payload);
      }
      setShowModal(false);
      loadMeters();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handlePoll = async (meter: Meter) => {
    try {
      const res = await apiClient.post(`/api/v1/meters/${meter.id}/poll`);
      const data = res.data;
      if (data.success) {
        if (data.skipped) {
          alert(`${meter.name}: Wert unverändert (${data.reason})`);
        } else {
          alert(`${meter.name}: Wert ${data.value} erfasst` + (data.consumption != null ? ` (Verbrauch: ${data.consumption})` : ''));
        }
      } else {
        alert(`${meter.name}: Fehler – ${data.error}`);
      }
    } catch {
      alert(`Polling fehlgeschlagen für ${meter.name}`);
    }
  };

  const handleTestConnection = async (meter: Meter) => {
    try {
      const res = await apiClient.get(`/api/v1/meters/${meter.id}/test-connection`);
      const data = res.data;
      if (data.success) {
        alert(
          `Verbindung OK!\n` +
          `Gerät: ${data.device?.model || 'unbekannt'} (Gen${data.device?.gen})\n` +
          `Modus: ${data.mode}\n` +
          `Aktuelle Leistung: ${data.current_power_w} W\n` +
          `Gesamtenergie: ${data.total_energy_kwh?.toFixed(2)} kWh`
        );
      } else {
        alert(`Verbindung fehlgeschlagen: ${data.error}`);
      }
    } catch {
      alert(`Verbindungstest fehlgeschlagen für ${meter.name}`);
    }
  };

  const handlePollAll = async () => {
    try {
      const res = await apiClient.post('/api/v1/meters/poll-all');
      const data = res.data;
      alert(`Polling abgeschlossen: ${data.success}/${data.polled} erfolgreich, ${data.errors} Fehler`);
    } catch {
      alert('Polling aller Zähler fehlgeschlagen');
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Zähler</h1>
          <p className="mt-1 text-sm text-gray-500">
            {total} Zähler insgesamt
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/meter-map"
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded border border-gray-300 transition-colors"
            title="Baumansicht"
          >
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">Karte</span>
          </Link>
          <button onClick={handlePollAll} className="btn-secondary" title="Alle Zähler jetzt abfragen">
            Alle abfragen
          </button>
          <button onClick={handleCreate} className="btn-primary">
            + Neuer Zähler
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="card mt-4 flex gap-4">
        <input
          type="text"
          className="input flex-1"
          placeholder="Suche nach Name, Nummer, Standort..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <select
          className="input w-48"
          value={filterType}
          onChange={(e) => { setFilterType(e.target.value); setPage(1); }}
        >
          <option value="">Alle Energiearten</option>
          {Object.entries(ENERGY_TYPE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {/* Tabelle */}
      <div className="card mt-4 overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : meters.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Keine Zähler gefunden. Legen Sie den ersten Zähler an.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Nummer</th>
                <th className="px-4 py-3">Energieart</th>
                <th className="px-4 py-3">Quelle</th>
                <th className="px-4 py-3">Standort</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {meters.map((meter) => (
                <tr key={meter.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{meter.name}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {meter.meter_number || '–'}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {ENERGY_TYPE_LABELS[meter.energy_type as EnergyType] || meter.energy_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {DATA_SOURCES[meter.data_source] || meter.data_source}
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {meter.location || '–'}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    {meter.data_source !== 'manual' && (
                      <>
                        <button
                          onClick={() => handleTestConnection(meter)}
                          className="text-gray-500 hover:text-gray-700"
                          title="Verbindung testen"
                        >
                          Test
                        </button>
                        <button
                          onClick={() => handlePoll(meter)}
                          className="text-green-600 hover:text-green-800"
                          title="Jetzt abfragen"
                        >
                          Abfragen
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleEdit(meter)}
                      className="text-primary-600 hover:text-primary-800"
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => handleDelete(meter)}
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

      {/* Modal: Zähler erstellen/bearbeiten */}
      {showModal && (
        <MeterModal
          editingId={editingId}
          editingMeter={editingMeter}
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

/* ── Zähler-Modal mit Standort-Kaskade + Datenquellen-Konfig ── */

function MeterModal({
  editingId,
  editingMeter,
  form,
  setForm,
  formError,
  saving,
  onSubmit,
  onClose,
}: {
  editingId: string | null;
  editingMeter: Meter | null;
  form: MeterForm;
  setForm: (f: MeterForm) => void;
  formError: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent, hierarchy: { siteId: string; buildingId: string; unitId: string }) => void;
  onClose: () => void;
}) {
  const hierarchy = useSiteHierarchy(editingMeter ? {
    siteId: editingMeter.site_id,
    buildingId: editingMeter.building_id,
    unitId: editingMeter.usage_unit_id,
  } : undefined);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">
          {editingId ? 'Zähler bearbeiten' : 'Neuer Zähler'}
        </h2>

        <form onSubmit={(e) => onSubmit(e, { siteId: hierarchy.selectedSiteId, buildingId: hierarchy.selectedBuildingId, unitId: hierarchy.selectedUnitId })} className="space-y-4">
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
              <label className="label">Zählernummer</label>
              <input
                type="text"
                className="input"
                value={form.meter_number}
                onChange={(e) => setForm({ ...form, meter_number: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Standort (Freitext)</label>
              <input
                type="text"
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="z.B. Keller, Technikraum"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Energieart *</label>
              <select
                className="input"
                value={form.energy_type}
                onChange={(e) => setForm({ ...form, energy_type: e.target.value })}
              >
                {Object.entries(ENERGY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Einheit</label>
              <select
                className="input"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                <option value="kWh">kWh</option>
                <option value="MWh">MWh</option>
                <option value="m³">m³</option>
                <option value="l">Liter</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div>
              <label className="label">Datenquelle</label>
              <select
                className="input"
                value={form.data_source}
                onChange={(e) => setForm({ ...form, data_source: e.target.value })}
              >
                {Object.entries(DATA_SOURCES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Datenquellen-Konfiguration */}
          {form.data_source === 'shelly' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Shelly-Konfiguration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">IP-Adresse *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.source_config_ip}
                    onChange={(e) => setForm({ ...form, source_config_ip: e.target.value })}
                    placeholder="192.168.1.42"
                  />
                </div>
                <div>
                  <label className="label">Messmodus</label>
                  <select
                    className="input"
                    value={form.source_config_mode}
                    onChange={(e) => setForm({ ...form, source_config_mode: e.target.value })}
                  >
                    <option value="single">Einzelkanal</option>
                    <option value="balanced">Saldierend (3 Phasen)</option>
                  </select>
                </div>
              </div>
              {form.source_config_mode === 'single' && (
                <div className="mt-3">
                  <label className="label">Kanal</label>
                  <input
                    type="number"
                    className="input w-24"
                    min={0}
                    max={3}
                    value={form.source_config_channel}
                    onChange={(e) => setForm({ ...form, source_config_channel: e.target.value })}
                  />
                </div>
              )}
              {form.source_config_mode === 'balanced' && (
                <p className="mt-3 text-xs text-gray-500">
                  Summiert Kanal 0 + 1 + 2. Bei PV-Einspeisung wird der Gesamtwert negativ.
                </p>
              )}
            </div>
          )}

          {form.data_source === 'modbus' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Modbus-Konfiguration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">IP-Adresse *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.source_config_ip}
                    onChange={(e) => setForm({ ...form, source_config_ip: e.target.value })}
                    placeholder="192.168.1.100"
                  />
                </div>
                <div>
                  <label className="label">Register</label>
                  <input
                    type="number"
                    className="input"
                    value={form.source_config_register}
                    onChange={(e) => setForm({ ...form, source_config_register: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </div>
            </div>
          )}

          {form.data_source === 'homeassistant' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Home Assistant-Konfiguration</p>
              <div>
                <label className="label">Entity-ID *</label>
                <input
                  type="text"
                  className="input"
                  value={form.source_config_entity_id}
                  onChange={(e) => setForm({ ...form, source_config_entity_id: e.target.value })}
                  placeholder="sensor.stromzaehler_total"
                />
              </div>
            </div>
          )}

          {/* Zuordnung: Standort → Gebäude → Nutzungseinheit */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Zuordnung (optional)</p>
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

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_weather_corrected"
              checked={form.is_weather_corrected}
              onChange={(e) => setForm({ ...form, is_weather_corrected: e.target.checked })}
            />
            <label htmlFor="is_weather_corrected" className="text-sm">
              Witterungskorrektur aktivieren
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
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
  );
}

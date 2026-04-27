import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';

// ── Typen ──

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
  data_source: string;
  is_active: boolean;
  is_delivery_based: boolean;
}

interface Reading {
  id: string;
  meter_id: string;
  timestamp: string;
  value: number;
  consumption: number | null;
  source: string;
  quality: string;
  cost_gross: number | null;
  vat_rate: number | null;
  cost_net: number | null;
  notes: string | null;
  import_batch_id: string | null;
}

type InputMode = 'meter_reading' | 'consumption';

interface ReadingForm {
  meter_id: string;
  timestamp: string;
  value: string;
  consumption: string;
  cost_gross: string;
  vat_rate: string;
  notes: string;
}

interface BulkRow {
  timestamp: string;
  value: string;
  consumption: string;
  cost_gross: string;
}

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manuell',
  csv_import: 'CSV-Import',
  shelly: 'Shelly',
  modbus: 'Modbus',
  knx: 'KNX',
  homeassistant: 'Home Assistant',
};

// ── Komponente ──

export default function ReadingsPage() {
  const [searchParams] = useSearchParams();
  const highlightReadingId = searchParams.get('highlight') ?? '';
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  // Zähler-Liste
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState(searchParams.get('meter_id') ?? '');

  // Readings-Liste
  const [readings, setReadings] = useState<Reading[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const pageSize = 25;

  // Einzelerfassung
  const [showSingleModal, setShowSingleModal] = useState(false);
  const [singleInputMode, setSingleInputMode] = useState<InputMode>('meter_reading');
  const [singleForm, setSingleForm] = useState<ReadingForm>({
    meter_id: '',
    timestamp: new Date().toISOString().slice(0, 16),
    value: '',
    consumption: '',
    cost_gross: '',
    vat_rate: '19',
    notes: '',
  });
  const [singleError, setSingleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Monatserfassung (Bulk)
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkInputMode, setBulkInputMode] = useState<InputMode>('meter_reading');
  const [bulkMeterId, setBulkMeterId] = useState('');
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  // Bearbeiten
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ value: '', notes: '' });

  // Zähler laden + ggf. Seite aus highlight ableiten
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<PaginatedResponse<Meter>>(
          '/api/v1/meters?page_size=500'
        );
        setMeters(res.data.items.filter((m) => m.is_active));
      } catch {
        // Interceptor handled
      }
      // Wenn highlight gesetzt: richtige Seite ermitteln
      if (highlightReadingId) {
        try {
          const info = await apiClient.get<{ meter_id: string; page: number; position_on_page: number; total: number }>(
            `/api/v1/readings/${highlightReadingId}/page-info`,
            { params: { page_size: pageSize } }
          );
          setSelectedMeterId(info.data.meter_id);
          setPage(info.data.page);
        } catch { /* leer */ }
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Readings laden
  const loadReadings = useCallback(async () => {
    if (!selectedMeterId) {
      setReadings([]);
      setTotal(0);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        meter_id: selectedMeterId,
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      const res = await apiClient.get<PaginatedResponse<Reading>>(
        `/api/v1/readings?${params}`
      );
      setReadings(res.data.items);
      setTotal(res.data.total);
    } catch {
      // Interceptor handled
    } finally {
      setLoading(false);
    }
  }, [selectedMeterId, page]);

  useEffect(() => {
    loadReadings();
  }, [loadReadings]);

  // Nach dem Laden zur markierten Zeile scrollen
  useEffect(() => {
    if (highlightReadingId && highlightRef.current && !loading) {
      setTimeout(() => highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }
  }, [readings, loading, highlightReadingId]);

  // Einzelerfassung
  const handleOpenSingle = () => {
    setSingleForm({
      meter_id: selectedMeterId || '',
      timestamp: new Date().toISOString().slice(0, 16),
      value: '',
      consumption: '',
      cost_gross: '',
      vat_rate: '19',
      notes: '',
    });
    setSingleError(null);
    setShowSingleModal(true);
  };

  const handleSingleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSingleError(null);
    setSaving(true);
    try {
      const costGross = singleForm.cost_gross ? parseFloat(singleForm.cost_gross.replace(',', '.')) : null;
      const vatRate = singleForm.vat_rate ? parseFloat(singleForm.vat_rate.replace(',', '.')) : null;
      const body: Record<string, unknown> = {
        meter_id: singleForm.meter_id,
        timestamp: new Date(singleForm.timestamp).toISOString(),
        source: 'manual',
        cost_gross: costGross,
        vat_rate: vatRate,
        notes: singleForm.notes || null,
      };
      if (singleInputMode === 'consumption') {
        body.consumption_direct = parseFloat(singleForm.consumption.replace(',', '.'));
      } else {
        body.value = parseFloat(singleForm.value.replace(',', '.'));
        body.quality = 'measured';
      }
      await apiClient.post('/api/v1/readings', body);
      setShowSingleModal(false);
      if (singleForm.meter_id === selectedMeterId) loadReadings();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setSingleError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  // Monatserfassung (Bulk)
  const handleOpenBulk = () => {
    setBulkMeterId(selectedMeterId || '');
    setBulkError(null);
    // 12 leere Zeilen fuer Monatsablesung generieren
    const now = new Date();
    const rows: BulkRow[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      rows.push({
        timestamp: d.toISOString().slice(0, 10),
        value: '',
        consumption: '',
        cost_gross: '',
      });
    }
    setBulkRows(rows);
    setShowBulkModal(true);
  };

  const handleBulkRowChange = (idx: number, field: keyof BulkRow, val: string) => {
    setBulkRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: val } : r)));
  };

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBulkError(null);
    const valueField = bulkInputMode === 'consumption' ? 'consumption' : 'value';
    const filled = bulkRows.filter((r) => r[valueField].trim() !== '');
    if (filled.length === 0) {
      setBulkError('Bitte mindestens einen Wert eingeben');
      return;
    }
    setBulkSaving(true);
    try {
      const readings = filled.map((r) => {
        const base: Record<string, unknown> = {
          meter_id: bulkMeterId,
          timestamp: new Date(r.timestamp + 'T00:00:00').toISOString(),
          source: 'manual',
        };
        if (bulkInputMode === 'consumption') {
          base.consumption_direct = parseFloat(r.consumption.replace(',', '.'));
          if (r.cost_gross.trim()) {
            base.cost_gross = parseFloat(r.cost_gross.replace(',', '.'));
            base.vat_rate = 19;
          }
        } else {
          base.value = parseFloat(r.value.replace(',', '.'));
          base.quality = 'measured';
        }
        return base;
      });
      await apiClient.post('/api/v1/readings/bulk', { readings });
      setShowBulkModal(false);
      if (bulkMeterId === selectedMeterId) loadReadings();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setBulkError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setBulkSaving(false);
    }
  };

  // Bearbeiten
  const handleEdit = (reading: Reading) => {
    setEditingId(reading.id);
    setEditForm({
      value: reading.value.toString(),
      notes: reading.notes || '',
    });
  };

  const handleEditSave = async (readingId: string) => {
    try {
      await apiClient.put(`/api/v1/readings/${readingId}`, {
        value: parseFloat(editForm.value.replace(',', '.')),
        notes: editForm.notes || null,
      });
      setEditingId(null);
      loadReadings();
    } catch {
      // Interceptor handled
    }
  };

  const handleDelete = async (reading: Reading) => {
    if (!confirm(`Zählerstand vom ${formatDate(reading.timestamp)} wirklich löschen?`)) return;
    try {
      await apiClient.delete(`/api/v1/readings/${reading.id}`);
      loadReadings();
    } catch {
      // Interceptor handled
    }
  };

  const selectedMeter = meters.find((m) => m.id === selectedMeterId);
  const isDelivery = selectedMeter?.is_delivery_based ?? false;
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Zählerstände</h1>
          <p className="mt-1 text-sm text-gray-500">
            Zählerstände erfassen und Verbrauch analysieren
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleOpenBulk} className="btn-secondary">
            Monatsablesung
          </button>
          <button onClick={handleOpenSingle} className="btn-primary">
            + Neuer Zählerstand
          </button>
        </div>
      </div>

      {/* Zähler-Auswahl */}
      <div className="card mt-4">
        <label className="label">Zähler auswählen</label>
        <select
          className="input max-w-md"
          value={selectedMeterId}
          onChange={(e) => { setSelectedMeterId(e.target.value); setPage(1); }}
        >
          <option value="">– Zähler wählen –</option>
          {meters.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} ({ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type}
              {m.meter_number ? ` – ${m.meter_number}` : ''})
            </option>
          ))}
        </select>

        {selectedMeter && (
          <div className="mt-2 flex gap-4 text-sm text-gray-500">
            <span>Einheit: <b>{selectedMeter.unit}</b></span>
            <span>
              Energieart:{' '}
              <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                {ENERGY_TYPE_LABELS[selectedMeter.energy_type as EnergyType] || selectedMeter.energy_type}
              </span>
            </span>
            <span>Stände gesamt: <b>{total}</b></span>
          </div>
        )}
      </div>

      {/* Tabelle */}
      {selectedMeterId && (
        <div className="card mt-4 overflow-hidden p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Laden...</div>
          ) : readings.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              Keine Zählerstände vorhanden. Erfassen Sie den ersten Stand.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Zeitpunkt</th>
                  <th className="px-4 py-3 text-right">{isDelivery ? 'Liefermenge' : 'Zählerstand'}</th>
                  <th className="px-4 py-3 text-right">{isDelivery ? 'Menge' : 'Verbrauch'}</th>
                  <th className="px-4 py-3 text-right">Kosten (brutto)</th>
                  <th className="px-4 py-3">Quelle</th>
                  <th className="px-4 py-3">Notizen</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {readings.map((r) => (
                  <tr
                    key={r.id}
                    ref={r.id === highlightReadingId ? highlightRef : undefined}
                    className={r.id === highlightReadingId
                      ? 'bg-amber-50 ring-2 ring-inset ring-amber-400'
                      : 'hover:bg-gray-50'}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">{formatDate(r.timestamp)}</td>
                    <td className="px-4 py-3 text-right font-mono">
                      {editingId === r.id ? (
                        <input
                          type="text"
                          className="input w-28 text-right"
                          value={editForm.value}
                          onChange={(e) => setEditForm({ ...editForm, value: e.target.value })}
                        />
                      ) : (
                        <span title={r.quality === 'estimated' ? 'Zählerstand geschätzt (aus Verbrauchsangabe)' : undefined}
                          className={r.quality === 'estimated' ? 'text-amber-600' : undefined}>
                          {formatNumber(r.value)} {selectedMeter?.unit}
                          {r.quality === 'estimated' && <span className="ml-1 text-xs">~</span>}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      {r.consumption != null ? (
                        <span className={r.consumption >= 0 ? 'text-green-600' : 'text-red-500'}>
                          {r.consumption >= 0 ? '+' : ''}{formatNumber(r.consumption)} {selectedMeter?.unit}
                        </span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-500">
                      {r.cost_gross != null ? (
                        <span title={r.cost_net != null ? `Netto: ${formatNumber(r.cost_net)} € (${r.vat_rate}% MwSt)` : ''}>
                          {formatNumber(r.cost_gross)} €
                        </span>
                      ) : (
                        <span className="text-gray-300">–</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {SOURCE_LABELS[r.source] || r.source}
                    </td>
                    <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">
                      {editingId === r.id ? (
                        <input
                          type="text"
                          className="input w-full"
                          value={editForm.notes}
                          onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                          placeholder="Notizen..."
                        />
                      ) : (
                        r.notes || '–'
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {editingId === r.id ? (
                        <>
                          <button
                            onClick={() => handleEditSave(r.id)}
                            className="mr-2 text-green-600 hover:text-green-800"
                          >
                            Speichern
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-500 hover:text-gray-700"
                          >
                            Abbrechen
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleEdit(r)}
                            className="mr-2 text-primary-600 hover:text-primary-800"
                          >
                            Bearbeiten
                          </button>
                          <button
                            onClick={() => handleDelete(r)}
                            className="text-red-500 hover:text-red-700"
                          >
                            Löschen
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Seite {page} von {totalPages}
          </p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Zurück
            </button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Weiter
            </button>
          </div>
        </div>
      )}

      {/* Kein Zähler ausgewählt */}
      {!selectedMeterId && (
        <div className="card mt-4">
          <div className="py-12 text-center text-gray-400">
            Bitte wählen Sie einen Zähler aus, um dessen Stände anzuzeigen.
          </div>
        </div>
      )}

      {/* ── Modal: Einzelerfassung ── */}
      {showSingleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-bold">
              {meters.find((m) => m.id === singleForm.meter_id)?.is_delivery_based
                ? 'Neue Lieferung erfassen'
                : 'Ablesung erfassen'}
            </h2>

            {/* Eingabemodus-Toggle */}
            {!meters.find((m) => m.id === singleForm.meter_id)?.is_delivery_based && (
              <div className="mb-4 flex rounded-lg border border-gray-200 overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => setSingleInputMode('meter_reading')}
                  className={`flex-1 px-3 py-2 font-medium transition-colors ${singleInputMode === 'meter_reading' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Zählerstand
                </button>
                <button
                  type="button"
                  onClick={() => setSingleInputMode('consumption')}
                  className={`flex-1 px-3 py-2 font-medium transition-colors ${singleInputMode === 'consumption' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  Nur Verbrauch
                </button>
              </div>
            )}
            {singleInputMode === 'consumption' && (
              <p className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                Der Zählerstand wird aus dem letzten bekannten Stand geschätzt und als "~" markiert.
                Geeignet für Monatsabrechnungen, bei denen nur der Verbrauch angegeben ist.
              </p>
            )}

            <form onSubmit={handleSingleSubmit} className="space-y-4">
              {singleError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{singleError}</div>
              )}

              <div>
                <label className="label">Zähler *</label>
                <select
                  className="input"
                  value={singleForm.meter_id}
                  onChange={(e) => setSingleForm({ ...singleForm, meter_id: e.target.value })}
                  required
                >
                  <option value="">– Zähler wählen –</option>
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Zeitpunkt *</label>
                  <input
                    type="datetime-local"
                    className="input"
                    value={singleForm.timestamp}
                    onChange={(e) => setSingleForm({ ...singleForm, timestamp: e.target.value })}
                    required
                  />
                </div>
                <div>
                  {singleInputMode === 'consumption' ? (
                    <>
                      <label className="label">
                        Verbrauch *{' '}
                        {singleForm.meter_id && (
                          <span className="font-normal text-gray-400">
                            ({meters.find((m) => m.id === singleForm.meter_id)?.unit})
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder="z.B. 450,00"
                        value={singleForm.consumption}
                        onChange={(e) => setSingleForm({ ...singleForm, consumption: e.target.value })}
                        required
                        autoFocus
                      />
                    </>
                  ) : (
                    <>
                      <label className="label">
                        {meters.find((m) => m.id === singleForm.meter_id)?.is_delivery_based
                          ? 'Liefermenge *'
                          : 'Zählerstand *'}{' '}
                        {singleForm.meter_id && (
                          <span className="font-normal text-gray-400">
                            ({meters.find((m) => m.id === singleForm.meter_id)?.unit})
                          </span>
                        )}
                      </label>
                      <input
                        type="text"
                        className="input"
                        placeholder={meters.find((m) => m.id === singleForm.meter_id)?.is_delivery_based
                          ? 'z.B. 2500'
                          : 'z.B. 12345,67'}
                        value={singleForm.value}
                        onChange={(e) => setSingleForm({ ...singleForm, value: e.target.value })}
                        required
                        autoFocus
                      />
                    </>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Bruttokosten (€)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="z.B. 1250,00"
                    value={singleForm.cost_gross}
                    onChange={(e) => setSingleForm({ ...singleForm, cost_gross: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">MwSt-Satz (%)</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="z.B. 19"
                    value={singleForm.vat_rate}
                    onChange={(e) => setSingleForm({ ...singleForm, vat_rate: e.target.value })}
                  />
                </div>
              </div>
              {singleForm.cost_gross && singleForm.vat_rate && (
                <div className="text-sm text-gray-500">
                  Netto: {formatNumber(
                    parseFloat(singleForm.cost_gross.replace(',', '.')) /
                    (1 + parseFloat(singleForm.vat_rate.replace(',', '.')) / 100)
                  )} €
                </div>
              )}

              <div>
                <label className="label">Notizen</label>
                <input
                  type="text"
                  className="input"
                  placeholder="Optionale Anmerkung..."
                  value={singleForm.notes}
                  onChange={(e) => setSingleForm({ ...singleForm, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSingleModal(false)} className="btn-secondary">
                  Abbrechen
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Speichern...' : 'Speichern'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Monatsablesung (Bulk) ── */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="mb-1 text-lg font-bold">Monatserfassung</h2>

            {/* Eingabemodus-Toggle */}
            <div className="mb-4 flex rounded-lg border border-gray-200 overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setBulkInputMode('meter_reading')}
                className={`flex-1 px-3 py-2 font-medium transition-colors ${bulkInputMode === 'meter_reading' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Zählerstände
              </button>
              <button
                type="button"
                onClick={() => setBulkInputMode('consumption')}
                className={`flex-1 px-3 py-2 font-medium transition-colors ${bulkInputMode === 'consumption' ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
              >
                Verbrauch + Kosten
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-500">
              {bulkInputMode === 'consumption'
                ? 'Verbrauch und optionale Kosten aus Monatsabrechnungen eintragen. Leere Zeilen werden übersprungen.'
                : 'Monatliche Zählerstände eintragen. Leere Zeilen werden übersprungen.'}
            </p>

            <form onSubmit={handleBulkSubmit} className="space-y-4">
              {bulkError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{bulkError}</div>
              )}

              <div>
                <label className="label">Zähler *</label>
                <select
                  className="input"
                  value={bulkMeterId}
                  onChange={(e) => setBulkMeterId(e.target.value)}
                  required
                >
                  <option value="">– Zähler wählen –</option>
                  {meters.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Datum</th>
                      {bulkInputMode === 'meter_reading' ? (
                        <th className="px-4 py-2 text-left">
                          Zählerstand{' '}
                          {bulkMeterId && (
                            <span className="normal-case font-normal text-gray-400">
                              ({meters.find((m) => m.id === bulkMeterId)?.unit})
                            </span>
                          )}
                        </th>
                      ) : (
                        <>
                          <th className="px-4 py-2 text-left">
                            Verbrauch{' '}
                            {bulkMeterId && (
                              <span className="normal-case font-normal text-gray-400">
                                ({meters.find((m) => m.id === bulkMeterId)?.unit})
                              </span>
                            )}
                          </th>
                          <th className="px-4 py-2 text-left">Kosten brutto (€)</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {bulkRows.map((row, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-1.5">
                          <input
                            type="date"
                            className="input"
                            value={row.timestamp}
                            onChange={(e) => handleBulkRowChange(idx, 'timestamp', e.target.value)}
                          />
                        </td>
                        {bulkInputMode === 'meter_reading' ? (
                          <td className="px-4 py-1.5">
                            <input
                              type="text"
                              className="input"
                              placeholder="z.B. 12345,67"
                              value={row.value}
                              onChange={(e) => handleBulkRowChange(idx, 'value', e.target.value)}
                            />
                          </td>
                        ) : (
                          <>
                            <td className="px-4 py-1.5">
                              <input
                                type="text"
                                className="input"
                                placeholder="z.B. 450,00"
                                value={row.consumption}
                                onChange={(e) => handleBulkRowChange(idx, 'consumption', e.target.value)}
                              />
                            </td>
                            <td className="px-4 py-1.5">
                              <input
                                type="text"
                                className="input"
                                placeholder="z.B. 135,00"
                                value={row.cost_gross}
                                onChange={(e) => handleBulkRowChange(idx, 'cost_gross', e.target.value)}
                              />
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowBulkModal(false)} className="btn-secondary">
                  Abbrechen
                </button>
                <button type="submit" className="btn-primary" disabled={bulkSaving}>
                  {bulkSaving ? 'Speichern...' : (() => {
                    const f = bulkInputMode === 'consumption'
                      ? bulkRows.filter((r) => r.consumption.trim()).length
                      : bulkRows.filter((r) => r.value.trim()).length;
                    return `${f} ${bulkInputMode === 'consumption' ? 'Verbrauchswerte' : 'Stände'} speichern`;
                  })()}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Hilfs-Funktionen ──

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatNumber(val: number): string {
  return val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

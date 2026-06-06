import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Pencil, Trash2, Plus, Grid2x2, MapPin, Gauge } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { type PaginatedResponse } from '@/types';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';
import { resolveEnergyKey, EM_ENERGY, type EnergyKey } from '@/utils/energyPalette';

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
  site_name?: string | null;
  latest_reading?: number | null;
  latest_reading_date?: string | null;
}

// Zähler-Ablesestatus aus dem Datum der letzten Ablesung.
type MeterStatus = { kind: 'good' | 'warn' | 'alert'; label: string };

function meterStatus(m: Meter): MeterStatus {
  if (!m.latest_reading_date) return { kind: 'alert', label: 'keine Ablesung' };
  const days = (Date.now() - new Date(m.latest_reading_date).getTime()) / 86_400_000;
  if (days <= 40) return { kind: 'good', label: 'aktuell' };
  if (days <= 70) return { kind: 'warn', label: 'fällig' };
  return { kind: 'alert', label: 'überfällig' };
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

// Nur Zähler dieser Quellen werden auf der Ablesungen-Seite (manuelle Eingabe)
// angeboten. Whitelist statt Sperrliste: automatische Quellen (Shelly, Modbus,
// KNX, Home Assistant, SPIE, API …) fallen automatisch raus.
const MANUAL_ENTRY_SOURCES = new Set(['manual', 'csv_import']);

// ── Komponente ──

export default function ReadingsPage() {
  const [searchParams] = useSearchParams();
  const highlightReadingId = searchParams.get('highlight') ?? '';
  const highlightRef = useRef<HTMLTableRowElement | null>(null);
  // Initial-Skip-Flag: beim Highlight-Sprung warten wir auf page-info,
  // damit nicht erst Page 1 und dann die richtige Seite geladen wird.
  const skipInitialLoad = useRef<boolean>(!!highlightReadingId);

  // Zähler-Liste
  const [meters, setMeters] = useState<Meter[]>([]);
  const [selectedMeterId, setSelectedMeterId] = useState(searchParams.get('meter_id') ?? '');

  // Master-Liste: Suche + Energie-Filter
  const [query, setQuery] = useState('');
  const [energyFilter, setEnergyFilter] = useState<Set<EnergyKey>>(new Set());

  // Readings-Liste
  const [readings, setReadings] = useState<Reading[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(!!highlightReadingId);
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

  // Initial: Zähler-Liste, page-info (bei highlight) und Readings parallel laden
  useEffect(() => {
    (async () => {
      const metersPromise = apiClient
        .get<PaginatedResponse<Meter>>('/api/v1/meters?page_size=500')
        .then((res) => setMeters(res.data.items.filter(
          (m) => m.is_active && MANUAL_ENTRY_SOURCES.has(m.data_source),
        )))
        .catch(() => { /* Interceptor handled */ });

      if (highlightReadingId) {
        // Page-Info ermittelt Zähler+Seite, dann sofort Readings laden
        try {
          const info = await apiClient.get<{ meter_id: string; page: number; position_on_page: number; total: number }>(
            `/api/v1/readings/${highlightReadingId}/page-info`,
            { params: { page_size: pageSize } }
          );
          const targetMeterId = info.data.meter_id;
          const targetPage = info.data.page;
          setSelectedMeterId(targetMeterId);
          setPage(targetPage);

          // Direkt Readings laden — nicht auf state-Update warten
          try {
            const params = new URLSearchParams({
              meter_id: targetMeterId,
              page: targetPage.toString(),
              page_size: pageSize.toString(),
            });
            const r = await apiClient.get<PaginatedResponse<Reading>>(`/api/v1/readings?${params}`);
            setReadings(r.data.items);
            setTotal(r.data.total);
          } catch { /* leer */ }
        } catch { /* leer */ } finally {
          skipInitialLoad.current = false;
          setLoading(false);
        }
      }
      await metersPromise;
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
    // Beim Highlight-Sprung wird der initiale Load aus dem Mount-Effekt erledigt,
    // damit nicht doppelt geladen wird (Page 1 + dann richtige Seite).
    if (skipInitialLoad.current) {
      skipInitialLoad.current = false;
      return;
    }
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

  // Gefilterte Master-Liste (Suche über Name/Nummer/Standort + Energie-Pills)
  const filteredMeters = useMemo(() => {
    const q = query.trim().toLowerCase();
    return meters.filter((m) => {
      const key = resolveEnergyKey(m.energy_type);
      if (energyFilter.size > 0 && (!key || !energyFilter.has(key))) return false;
      if (q) {
        const hay = `${m.name} ${m.meter_number ?? ''} ${m.site_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [meters, query, energyFilter]);

  const toggleEnergy = (k: EnergyKey) =>
    setEnergyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  // KPI-Kennzahlen aus den geladenen Ständen des gewählten Zählers.
  // readings ist absteigend sortiert (neueste zuerst).
  const kpi = useMemo(() => {
    const latest = readings[0];
    const prev = readings[1];
    const consDelta = latest?.consumption != null && prev?.consumption != null && prev.consumption !== 0
      ? ((latest.consumption - prev.consumption) / Math.abs(prev.consumption)) * 100
      : null;
    const withCost = readings.filter((r) => r.cost_gross != null);
    const avgCost = withCost.length
      ? withCost.reduce((a, r) => a + (r.cost_gross ?? 0), 0) / withCost.length
      : null;
    return { latest, consDelta, avgCost };
  }, [readings]);

  // Verlaufsbalken: letzte 12 Stände mit Verbrauch, ältester links.
  const verlaufRows = useMemo(() => {
    const withCons = readings.filter((r) => r.consumption != null).slice(0, 12).reverse();
    const max = Math.max(...withCons.map((r) => Math.abs(r.consumption ?? 0)), 1);
    return { rows: withCons, max };
  }, [readings]);

  // Header-Pips: manuelle Zähler gesamt, Stände (gewählt), fällige Zähler
  const dueCount = useMemo(
    () => meters.filter((m) => meterStatus(m).kind !== 'good').length,
    [meters],
  );

  const selKey = resolveEnergyKey(selectedMeter?.energy_type);
  const selTone = selKey ? EM_ENERGY[selKey] : null;

  return (
    <div>
      <PageHead
        eyebrow="Stammdaten"
        title="Ablesungen"
        actions={
          <>
            <button onClick={handleOpenBulk} className="btn-secondary">
              <Grid2x2 className="h-4 w-4" /> Monatserfassung
            </button>
            <button onClick={handleOpenSingle} className="btn-primary">
              <Plus className="h-4 w-4" /> Neue Ablesung
            </button>
          </>
        }
      />
      <div className="abl-head-sub">
        <span className="pip"><span className="dot" style={{ background: 'var(--ink)' }} /> <strong>{meters.length}</strong>&nbsp;manuelle Zähler</span>
        {selectedMeterId && <span className="pip"><span className="dot" /> <strong>{total}</strong>&nbsp;Stände erfasst</span>}
        {dueCount > 0 && <span className="pip warn"><span className="dot" /> <strong>{dueCount}</strong>&nbsp;Ablesung fällig</span>}
      </div>

      {/* Banner: direkter Sprung zu markiertem Messwert */}
      {highlightReadingId && (
        <div className="mt-4 flex items-center gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ background: 'color-mix(in srgb, var(--fw-strom) 14%, var(--surface))', border: '1px solid color-mix(in srgb, var(--fw-strom) 40%, transparent)', color: 'var(--ink-2)' }}>
          <span className="text-lg">⚑</span>
          <span>Springe direkt zum markierten Ausreißer-Messwert – dieser ist <strong>hervorgehoben</strong>.</span>
        </div>
      )}

      {/* ── Master/Detail ── */}
      <div className="abl">
        {/* Linke Spalte: Zählerliste */}
        <div className="meter-list">
          <div className="ml-head">
            <div className="ml-title">Manuelle Zähler <span className="badge-n">{filteredMeters.length}</span></div>
            <div className="ml-sub">Hauptzähler EVU · Verbrauch &amp; Kosten erfassen</div>
          </div>
          <div className="ml-tools">
            <div className="ml-search">
              <Search size={13} style={{ color: 'var(--ink-4)' }} />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zähler oder Standort suchen…" />
            </div>
            <div className="ml-pills">
              {(['fernwaerme', 'strom', 'kaelte', 'wasser'] as EnergyKey[]).map((k) => (
                <button key={k} className={`epill${energyFilter.has(k) ? ' active' : ''}`} onClick={() => toggleEnergy(k)}>
                  <span className="dot" style={{ background: EM_ENERGY[k].color }} />{EM_ENERGY[k].label}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-body">
            {filteredMeters.length === 0 && (
              <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
                Keine Zähler in dieser Auswahl.
              </div>
            )}
            {filteredMeters.map((m) => {
              const key = resolveEnergyKey(m.energy_type);
              const tone = key ? EM_ENERGY[key] : null;
              const st = meterStatus(m);
              return (
                <div key={m.id} className={`meter-row${m.id === selectedMeterId ? ' selected' : ''}`}
                  onClick={() => { setSelectedMeterId(m.id); setPage(1); }}>
                  <div className="mr-accent" style={{ background: tone?.color ?? 'var(--ink-4)' }} />
                  <div className="mr-body">
                    <div className="mr-top">
                      <span className="mr-name">{m.name}</span>
                      {tone && (
                        <span className="e-chip" style={{ background: tone.bg, color: tone.text }}>
                          <span className="dot" style={{ background: tone.color }} />
                        </span>
                      )}
                    </div>
                    <div className="mr-meta">
                      <MapPin size={11} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
                      <span className="mr-pos">{m.site_name || m.meter_number || '—'}</span>
                    </div>
                    <div className="mr-foot">
                      <span className="mr-last">
                        {m.latest_reading_date ? formatDateShort(m.latest_reading_date) : '—'}
                      </span>
                      <span className={`status-dot ${st.kind}`}><span className="dot" />{st.label}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rechte Spalte: Detail */}
        {!selectedMeter ? (
          <div className="detail-empty">
            <div className="mark"><Gauge size={22} /></div>
            <strong>Kein Zähler ausgewählt</strong>
            <p>Wähle links einen manuellen Zähler, um Zählerstände, Verbrauch und Kosten zu erfassen und den Verlauf zu sehen.</p>
          </div>
        ) : (
          <div className="detail">
            {/* Kopf + KPI-Strip */}
            <div className="acard">
              <div className="d-head">
                <div className="d-head-l">
                  <div className="d-mark" style={{ background: selTone?.bg ?? 'var(--surface-2)', color: selTone?.color ?? 'var(--ink-3)' }}>
                    <Gauge size={20} />
                  </div>
                  <div className="d-titlewrap">
                    <div className="d-title">{selectedMeter.name}</div>
                    {selectedMeter.meter_number && <div className="d-code">{selectedMeter.meter_number}</div>}
                    <div className="d-chips">
                      {selTone && (
                        <span className="e-chip" style={{ background: selTone.bg, color: selTone.text }}>
                          <span className="dot" style={{ background: selTone.color }} />
                          {selTone.label}
                        </span>
                      )}
                      {(() => { const st = meterStatus(selectedMeter); return (
                        <span className={`status-dot ${st.kind}`}><span className="dot" />{st.label}</span>
                      ); })()}
                      {selectedMeter.site_name && (
                        <span className="d-pos"><MapPin size={11} style={{ color: 'var(--ink-4)' }} />{selectedMeter.site_name}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="d-head-r">
                  <span className="d-unit-label">Einheit</span>
                  <span className="d-unit-val">{selectedMeter.unit}</span>
                </div>
              </div>

              <div className="kpi-strip">
                <div className="kpi">
                  <span className="kpi-label">{isDelivery ? 'Letzte Liefermenge' : 'Aktueller Zählerstand'}</span>
                  <span className="kpi-val">
                    <span className="kpi-num">{kpi.latest ? formatNumber(kpi.latest.value) : '—'}</span>
                    <span className="kpi-unit">{selectedMeter.unit}</span>
                  </span>
                  <span className="kpi-meta">{kpi.latest ? `Stand ${formatDateShort(kpi.latest.timestamp)}` : 'keine Ablesung'}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Verbrauch (letzter Stand)</span>
                  <span className="kpi-val">
                    <span className="kpi-num">{kpi.latest?.consumption != null ? formatNumber(kpi.latest.consumption) : '—'}</span>
                    <span className="kpi-unit">{selectedMeter.unit}</span>
                  </span>
                  <span className="kpi-meta">
                    {kpi.consDelta != null ? (
                      <>
                        <span className={`kpi-delta ${kpi.consDelta <= 0 ? 'good' : 'bad'}`}>
                          {kpi.consDelta <= 0 ? '▾' : '▴'} {Math.abs(kpi.consDelta).toFixed(1).replace('.', ',')}%
                        </span>
                        ggü. Vorperiode
                      </>
                    ) : '—'}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Kosten (letzter Stand)</span>
                  <span className="kpi-val">
                    <span className="kpi-num">{kpi.latest?.cost_gross != null ? formatNumber(kpi.latest.cost_gross, 0) : '—'}</span>
                    <span className="kpi-unit">€ brutto</span>
                  </span>
                  <span className="kpi-meta">{kpi.latest ? formatDateShort(kpi.latest.timestamp) : '—'}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">Ø Kosten / Stand</span>
                  <span className="kpi-val">
                    <span className="kpi-num">{kpi.avgCost != null ? formatNumber(kpi.avgCost, 0) : '—'}</span>
                    <span className="kpi-unit">€ brutto</span>
                  </span>
                  <span className="kpi-meta">aus {readings.filter((r) => r.cost_gross != null).length} Ständen</span>
                </div>
              </div>
            </div>

            {/* Verbrauchsverlauf */}
            {verlaufRows.rows.length > 0 && (
              <div className="acard verlauf-card">
                <div className="vc-head">
                  <span className="vc-title">Verbrauchsverlauf</span>
                  <span className="vc-legend">letzte {verlaufRows.rows.length} Stände · {selectedMeter.unit}</span>
                </div>
                <div className="bars">
                  {verlaufRows.rows.map((r, i) => {
                    const h = (Math.abs(r.consumption ?? 0) / verlaufRows.max) * 100;
                    return (
                      <div className="bar-col" key={r.id}>
                        <div className="bar-track">
                          <div className="bar"
                            title={`${formatNumber(r.consumption ?? 0)} ${selectedMeter.unit}`}
                            style={{ height: `${h}%`, background: selTone?.color ?? 'var(--ink-3)', animationDelay: `${i * 45}ms` }} />
                        </div>
                        <span className="bar-x">{formatDateShort(r.timestamp).slice(0, 6)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tabelle */}
            <div className="acard table-card">
              <div className="tc-bar">
                <span className="t">{isDelivery ? 'Lieferungen' : 'Zählerstände'} <span className="count">{total}</span></span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-secondary" onClick={handleOpenBulk}><Grid2x2 size={12} /> Monatserfassung</button>
                  <button className="btn-primary" onClick={handleOpenSingle}><Plus size={12} /> Neue Ablesung</button>
                </div>
              </div>

              {loading ? (
                <LoadingSpinner />
              ) : readings.length === 0 ? (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                  Noch keine Zählerstände erfasst.
                </div>
              ) : (
                <div className="tbl">
                  <div className="tr head">
                    <span>Zeitpunkt</span>
                    <span className="right">{isDelivery ? 'Liefermenge' : 'Zählerstand'}</span>
                    <span className="right">{isDelivery ? 'Menge' : 'Verbrauch'}</span>
                    <span className="right">Kosten brutto</span>
                    <span className="col-src">Quelle</span>
                    <span className="col-note">Notiz</span>
                    <span className="right">Aktionen</span>
                  </div>
                  {readings.map((r) => (
                    <div className={`tr${r.id === highlightReadingId ? ' highlight' : ''}`} key={r.id}
                      ref={r.id === highlightReadingId ? highlightRef : undefined}>
                      <span className="date">{formatDate(r.timestamp)}</span>
                      <span className="num mono reading">
                        {editingId === r.id ? (
                          <input type="text" className="input w-28 text-right"
                            value={editForm.value}
                            onChange={(e) => setEditForm({ ...editForm, value: e.target.value })} />
                        ) : (
                          <span title={r.quality === 'estimated' ? 'Zählerstand geschätzt (aus Verbrauchsangabe)' : undefined}
                            style={r.quality === 'estimated' ? { color: 'var(--warn)' } : undefined}>
                            {formatNumber(r.value)}<span className="u">{selectedMeter.unit}</span>
                            {r.quality === 'estimated' && <span style={{ marginLeft: 2 }}>~</span>}
                          </span>
                        )}
                      </span>
                      <span className={`num mono cons${r.consumption != null && r.consumption < 0 ? ' neg' : ''}`}>
                        {r.consumption != null ? (
                          <>{r.consumption >= 0 ? '+' : ''}{formatNumber(r.consumption)}<span className="u">{selectedMeter.unit}</span></>
                        ) : <span style={{ color: 'var(--ink-4)' }}>–</span>}
                      </span>
                      <span className="num mono cost">
                        {r.cost_gross != null ? (
                          <span title={r.cost_net != null ? `Netto: ${formatNumber(r.cost_net)} € (${r.vat_rate}% MwSt)` : ''}>
                            {formatNumber(r.cost_gross, 0)} €
                          </span>
                        ) : <span style={{ color: 'var(--ink-4)' }}>–</span>}
                      </span>
                      <span className="col-src"><span className="src-tag">{SOURCE_LABELS[r.source] || r.source}</span></span>
                      <span className={`col-note note${r.notes ? '' : ' empty'}`}>
                        {editingId === r.id ? (
                          <input type="text" className="input w-full"
                            value={editForm.notes}
                            onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                            placeholder="Notiz…" />
                        ) : (r.notes || '—')}
                      </span>
                      <span className="acts">
                        {editingId === r.id ? (
                          <>
                            <button className="icon-btn" title="Speichern" onClick={() => handleEditSave(r.id)} style={{ color: 'var(--good)' }}>✓</button>
                            <button className="icon-btn" title="Abbrechen" onClick={() => setEditingId(null)}>✕</button>
                          </>
                        ) : (
                          <>
                            <button className="icon-btn" title="Bearbeiten" onClick={() => handleEdit(r)}><Pencil size={13} /></button>
                            <button className="icon-btn danger" title="Löschen" onClick={() => handleDelete(r)}><Trash2 size={13} /></button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination innerhalb der Tabellen-Karte */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Seite {page} von {totalPages}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</button>
                    <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Weiter</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

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
              <div className="mb-4 flex gap-1 text-sm">
                <button
                  type="button"
                  onClick={() => setSingleInputMode('meter_reading')}
                  className={`abl-seg${singleInputMode === 'meter_reading' ? ' active' : ''}`}
                >
                  Zählerstand
                </button>
                <button
                  type="button"
                  onClick={() => setSingleInputMode('consumption')}
                  className={`abl-seg${singleInputMode === 'consumption' ? ' active' : ''}`}
                >
                  Nur Verbrauch
                </button>
              </div>
            )}
            {singleInputMode === 'consumption' && (
              <p className="mb-4 rounded-lg px-3 py-2 text-xs"
                style={{ color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '1px solid color-mix(in srgb, var(--warn) 38%, transparent)' }}>
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
            <div className="mb-4 flex gap-1 text-sm">
              <button
                type="button"
                onClick={() => setBulkInputMode('meter_reading')}
                className={`abl-seg${bulkInputMode === 'meter_reading' ? ' active' : ''}`}
              >
                Zählerstände
              </button>
              <button
                type="button"
                onClick={() => setBulkInputMode('consumption')}
                className={`abl-seg${bulkInputMode === 'consumption' ? ' active' : ''}`}
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

// Kurzform „Mär 25" für Listen-/Balken-/KPI-Beschriftung.
function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
}

function formatNumber(val: number, decimals = 2): string {
  return val.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

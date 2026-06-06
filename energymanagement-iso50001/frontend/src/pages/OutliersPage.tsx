import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Trash2, Flag, TrendingDown, RefreshCw,
  ExternalLink, ChevronDown, Check, Search, X, Info,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';
import PageHead from '@/components/ui/PageHead';
import { resolveEnergyKey, EM_ENERGY } from '@/utils/energyPalette';

// ── Typen ──

interface OutlierItem {
  reading_id: string;
  meter_id: string;
  meter_name: string;
  energy_type: string;
  timestamp: string;
  value: number;
  consumption: number;
  median_consumption: number;
  factor: number;
  quality: string;
}

type Action = 'delete' | 'flag' | 'interpolate';
type SortField = 'meter_name' | 'timestamp' | 'consumption' | 'median' | 'factor';

interface AnalyzeParams {
  energy: string;
  factor: string;
  minVal: string;
}

const ACTION_LABELS: Record<Action, string> = {
  delete: 'Löschen',
  flag: 'Markieren',
  interpolate: 'Interpolieren',
};

// Schweregrad aus dem Faktor — Farbgebung + Pill-Gruppierung.
type Severity = { key: 'extrem' | 'hoch' | 'auffaellig'; kind: 'alert' | 'warn' | 'info'; label: string };
function severityOf(factor: number): Severity {
  if (factor >= 50) return { key: 'extrem', kind: 'alert', label: 'Extrem' };
  if (factor >= 20) return { key: 'hoch', kind: 'warn', label: 'Hoch' };
  return { key: 'auffaellig', kind: 'info', label: 'Auffällig' };
}

// Aktueller Mess-Status aus dem quality-Feld.
function stateOf(quality: string): { cls: 'neutral' | 'alert' | 'info'; label: string } {
  if (quality === 'interpolated') return { cls: 'info', label: 'Interpoliert' };
  if (quality === 'outlier') return { cls: 'alert', label: 'Markiert' };
  return { cls: 'neutral', label: 'Offen' };
}

const fmtVal = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const fmtFactor = (n: number) => '×' + n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── Komponente ──

export default function OutliersPage() {
  const navigate = useNavigate();
  const [outliers, setOutliers] = useState<OutlierItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parameter: Entwurf (Eingabe) + angewandt. "Analysieren" übernimmt.
  const initParams: AnalyzeParams = { energy: '', factor: '10', minVal: '100' };
  const [draft, setDraft] = useState<AnalyzeParams>(initParams);
  const [applied, setApplied] = useState<AnalyzeParams>(initParams);
  const dirty = draft.energy !== applied.energy || draft.factor !== applied.factor || draft.minVal !== applied.minVal;

  // Sortierung
  const [sortField, setSortField] = useState<SortField>('factor');
  const [sortAsc, setSortAsc] = useState(false);

  // Selektion + Aktionsstatus
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionLoading, setActionLoading] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Detail-Modal + Toast
  const [detailId, setDetailId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };

  // Ausreißer laden (mit den angewandten Parametern)
  const loadOutliers = useCallback(async (params: AnalyzeParams) => {
    setLoading(true);
    setError(null);
    setSelectedIds(new Set());
    try {
      const qp = new URLSearchParams({
        factor_threshold: params.factor.replace(',', '.') || '10',
        min_value: params.minVal.replace(',', '.') || '0',
      });
      if (params.energy) qp.set('energy_type', params.energy);
      const res = await apiClient.get<OutlierItem[]>(`/api/v1/readings/outliers?${qp}`);
      setOutliers(res.data);
    } catch {
      setError('Ausreißer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadOutliers(initParams); /* initial */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const analyze = () => { setApplied({ ...draft }); loadOutliers(draft); };

  // Einzelaktion
  const handleAction = async (readingId: string, action: Action) => {
    setActionLoading((prev) => new Set(prev).add(readingId));
    try {
      await apiClient.post(`/api/v1/readings/outliers/${readingId}/action`, { action });
      setOutliers((prev) => prev.filter((o) => o.reading_id !== readingId));
      setSelectedIds((prev) => { const s = new Set(prev); s.delete(readingId); return s; });
      if (detailId === readingId) setDetailId(null);
      showToast(`Aktion „${ACTION_LABELS[action]}" ausgeführt.`);
    } catch {
      setError(`Aktion „${ACTION_LABELS[action]}" fehlgeschlagen.`);
    } finally {
      setActionLoading((prev) => { const s = new Set(prev); s.delete(readingId); return s; });
    }
  };

  // Massenaktion
  const handleBulkAction = async (action: 'delete' | 'flag') => {
    if (selectedIds.size === 0) return;
    setBulkLoading(true);
    setError(null);
    try {
      const ids = Array.from(selectedIds);
      await apiClient.post(`/api/v1/readings/outliers/bulk-action?action=${action}`, ids);
      setOutliers((prev) => prev.filter((o) => !selectedIds.has(o.reading_id)));
      showToast(`${ids.length} Messwert(e) „${ACTION_LABELS[action]}" ausgeführt.`);
      setSelectedIds(new Set());
    } catch {
      setError('Massenaktion fehlgeschlagen.');
    } finally {
      setBulkLoading(false);
    }
  };

  // Sortierung
  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortAsc((v) => !v);
    else { setSortField(field); setSortAsc(false); }
  };

  const sorted = useMemo(() => {
    const arr = [...outliers];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case 'meter_name': return dir * a.meter_name.localeCompare(b.meter_name);
        case 'timestamp':  return dir * a.timestamp.localeCompare(b.timestamp);
        case 'consumption':return dir * (a.consumption - b.consumption);
        case 'median':     return dir * (a.median_consumption - b.median_consumption);
        default:           return dir * (a.factor - b.factor);
      }
    });
    return arr;
  }, [outliers, sortField, sortAsc]);

  // Schweregrad-Aggregate
  const sev = useMemo(() => {
    const c = { extrem: 0, hoch: 0, auffaellig: 0 };
    outliers.forEach((o) => { c[severityOf(o.factor).key]++; });
    return c;
  }, [outliers]);
  const resolvedCount = useMemo(() => outliers.filter((o) => o.quality !== 'measured').length, [outliers]);

  // Selektion
  const allSelected = sorted.length > 0 && sorted.every((o) => selectedIds.has(o.reading_id));
  const toggleAll = () => setSelectedIds(allSelected ? new Set() : new Set(sorted.map((o) => o.reading_id)));
  const toggleOne = (id: string) => setSelectedIds((prev) => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  const detailObj = detailId ? outliers.find((o) => o.reading_id === detailId) ?? null : null;
  useEffect(() => { if (detailId && !detailObj) setDetailId(null); }, [detailId, detailObj]);

  const setDraftField = (k: keyof AnalyzeParams, v: string) => setDraft((p) => ({ ...p, [k]: v }));

  const Caret = ({ field }: { field: SortField }) => (
    <span className="x-caret">{sortField === field ? (sortAsc ? '▴' : '▾') : '▾'}</span>
  );

  return (
    <div className="outliers">
      <PageHead eyebrow="Stammdaten" title="Ausreißer-Erkennung" />
      <p className="ph-sub">Messwerte mit ungewöhnlich hohem Verbrauch erkennen und bereinigen</p>

      <div className="space-y-4" style={{ marginTop: 14 }}>
        {/* Analyse-Kontrollen */}
        <div className="x-controls">
          <div className="xc-field">
            <label>Energieart</label>
            <div className="xc-select">
              <select value={draft.energy} onChange={(e) => setDraftField('energy', e.target.value)}>
                <option value="">Alle Energiearten</option>
                {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <ChevronDown size={14} style={{ color: 'var(--ink-4)' }} />
            </div>
          </div>
          <div className="xc-field">
            <label>Faktor-Schwellwert <span className="dim">(× Median)</span></label>
            <input className="xc-input mono" inputMode="decimal" value={draft.factor}
              onChange={(e) => setDraftField('factor', e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
          <div className="xc-field">
            <label>Mindestwert <span className="dim">(kWh/m³)</span></label>
            <input className="xc-input mono" inputMode="decimal" value={draft.minVal}
              onChange={(e) => setDraftField('minVal', e.target.value.replace(/[^\d.,]/g, ''))} />
          </div>
          <button className={`x-analyze${dirty ? ' dirty' : ''}`} onClick={analyze} disabled={loading}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Analysieren
          </button>
        </div>

        {error && (
          <div className="rounded-lg p-3 text-sm"
            style={{ background: 'color-mix(in srgb, var(--alert) 12%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 38%, transparent)', color: 'var(--alert)' }}>
            {error}
          </div>
        )}

        {/* Summary */}
        {!loading && (
          <div className="x-summary">
            <div className="xs-count">
              <span className="n">{outliers.length}</span>
              <span className="l">Ausreißer gefunden</span>
            </div>
            {outliers.length > 0 && (
              <div className="xs-sev">
                <span className="xs-pill alert"><span className="dot" />{sev.extrem} Extrem</span>
                <span className="xs-pill warn"><span className="dot" />{sev.hoch} Hoch</span>
                <span className="xs-pill info"><span className="dot" />{sev.auffaellig} Auffällig</span>
              </div>
            )}
            {resolvedCount > 0 && (
              <div className="xs-resolved"><Check size={13} /> {resolvedCount} bereinigt</div>
            )}
          </div>
        )}

        {/* Tabellen-Karte */}
        <div className="x-table-card">
          {selectedIds.size > 0 ? (
            <div className="x-bulkbar">
              <span className="bb-count">{selectedIds.size} ausgewählt</span>
              <div className="bb-actions">
                <button className="x-act amber" onClick={() => handleBulkAction('flag')} disabled={bulkLoading}>
                  <Flag size={13} /><span>Markieren</span>
                </button>
                <button className="x-act red" onClick={() => handleBulkAction('delete')} disabled={bulkLoading}>
                  <Trash2 size={13} /><span>Löschen</span>
                </button>
              </div>
              <button className="bb-clear" onClick={() => setSelectedIds(new Set())}>Auswahl aufheben</button>
            </div>
          ) : (
            <div className="x-tablebar">
              <span className="tb-t">Ergebnisse <span className="count">{sorted.length}</span></span>
              <span className="tb-hint">Spalte klicken zum Sortieren · Zeile auswählen für Sammelaktionen</span>
            </div>
          )}

          <div className="x-thead">
            <label className="x-check head">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span className="box"><Check size={11} /></span>
            </label>
            <button className={`x-th${sortField === 'meter_name' ? ' active' : ''}`} onClick={() => toggleSort('meter_name')}>
              <span>Zähler</span><Caret field="meter_name" />
            </button>
            <span className="x-th static">Energieart</span>
            <button className={`x-th${sortField === 'timestamp' ? ' active' : ''}`} onClick={() => toggleSort('timestamp')}>
              <span>Zeitstempel</span><Caret field="timestamp" />
            </button>
            <button className={`x-th right${sortField === 'consumption' ? ' active' : ''}`} onClick={() => toggleSort('consumption')}>
              <span>Verbrauch</span><Caret field="consumption" />
            </button>
            <button className={`x-th right${sortField === 'median' ? ' active' : ''}`} onClick={() => toggleSort('median')}>
              <span>Median</span><Caret field="median" />
            </button>
            <button className={`x-th right${sortField === 'factor' ? ' active' : ''}`} onClick={() => toggleSort('factor')}>
              <span>Faktor</span><Caret field="factor" />
            </button>
            <span className="x-th static">Status</span>
            <span className="x-th static actions">Aktionen</span>
          </div>

          <div className="x-tbody">
            {loading ? (
              <div className="x-empty">
                <div className="ico"><RefreshCw size={20} className="animate-spin" /></div>
                <strong>Analysiere…</strong>
              </div>
            ) : sorted.length === 0 ? (
              <div className="x-empty">
                <div className="ico"><Search size={20} /></div>
                <strong>Keine Ausreißer in dieser Auswahl</strong>
                <p>Senke den Faktor-Schwellwert oder den Mindestwert und starte die Analyse erneut.</p>
              </div>
            ) : sorted.map((o) => {
              const s = severityOf(o.factor);
              const st = stateOf(o.quality);
              const key = resolveEnergyKey(o.energy_type);
              const tone = key ? EM_ENERGY[key] : null;
              const isSel = selectedIds.has(o.reading_id);
              const busy = actionLoading.has(o.reading_id);
              return (
                <div key={o.reading_id} className={`x-tr${isSel ? ' sel' : ''}${o.quality !== 'measured' ? ' resolved' : ''}`}>
                  <label className="x-check">
                    <input type="checkbox" checked={isSel} onChange={() => toggleOne(o.reading_id)} />
                    <span className="box"><Check size={11} /></span>
                  </label>
                  <button className="x-code mono" title={o.meter_name}
                    onClick={() => navigate(`/readings?meter_id=${o.meter_id}&highlight=${o.reading_id}`)}>
                    {o.meter_name}
                  </button>
                  <div>
                    {tone && (
                      <span className="x-echip" style={{ background: tone.bg, color: tone.text }}>
                        <span className="dot" style={{ background: tone.color }} />
                        {tone.label}
                      </span>
                    )}
                  </div>
                  <div className="x-stamp mono">{fmtDate(o.timestamp)}</div>
                  <div className="x-val mono">{fmtVal(o.consumption)}</div>
                  <div className="x-med mono">{fmtVal(o.median_consumption)}</div>
                  <div className={`x-factor mono ${s.kind}`}>{fmtFactor(o.factor)}</div>
                  <div><span className={`x-state ${st.cls}`}>{st.label}</span></div>
                  <div className="x-acts">
                    <button className="x-act" title="Im Verlauf anzeigen" onClick={() => setDetailId(o.reading_id)}>
                      <ExternalLink size={13} /><span>Anzeigen</span>
                    </button>
                    <button className="x-act blue" title="Mit Median interpolieren" disabled={busy}
                      onClick={() => handleAction(o.reading_id, 'interpolate')}>
                      <TrendingDown size={13} /><span>Interpolieren</span>
                    </button>
                    <button className="x-act amber" title="Zur Prüfung markieren" disabled={busy}
                      onClick={() => handleAction(o.reading_id, 'flag')}>
                      <Flag size={13} /><span>Markieren</span>
                    </button>
                    <button className="x-act red" title="Messwert löschen" disabled={busy}
                      onClick={() => handleAction(o.reading_id, 'delete')}>
                      <Trash2 size={13} /><span>Löschen</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {detailObj && (
        <DetailModal
          o={detailObj}
          onClose={() => setDetailId(null)}
          onAction={(a) => handleAction(detailObj.reading_id, a)}
        />
      )}

      {toast && (
        <div className="x-toast">
          <Check size={14} style={{ opacity: 0.75 }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

// ── Detail-Modal mit echtem Verlaufschart ──

interface ReadingPoint { id: string; timestamp: string; consumption: number | null; }

function DetailModal({ o, onClose, onAction }: {
  o: OutlierItem;
  onClose: () => void;
  onAction: (a: Action) => void;
}) {
  const [series, setSeries] = useState<ReadingPoint[]>([]);
  const key = resolveEnergyKey(o.energy_type);
  const tone = key ? EM_ENERGY[key] : null;
  const sev = severityOf(o.factor);
  const unit = ''; // Einheit ist je Zähler; im Outlier-DTO nicht enthalten

  // Echte Nachbarwerte des Zählers laden (jüngste 25 Stände).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get<{ items: ReadingPoint[] }>(
          `/api/v1/readings?meter_id=${o.meter_id}&page=1&page_size=25`,
        );
        if (cancelled) return;
        // Aufsteigend nach Zeit, nur Stände mit Verbrauch
        const pts = res.data.items
          .filter((r) => r.consumption != null)
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        setSeries(pts);
      } catch { /* interceptor */ }
    })();
    return () => { cancelled = true; };
  }, [o.meter_id]);

  // Fallback, falls noch keine Serie geladen: nur die Spitze + Median.
  const chartPoints = series.length > 0
    ? series
    : [{ id: o.reading_id, timestamp: o.timestamp, consumption: o.consumption }];
  const max = Math.max(...chartPoints.map((p) => Math.abs(p.consumption ?? 0)), o.median_consumption, 1);

  return (
    <div className="x-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="x-modal">
        <div className="xm-head">
          <div className="xm-head-l">
            <span className="xm-mark" style={{ background: tone?.bg ?? 'var(--surface-2)', color: tone?.color ?? 'var(--ink-3)' }}>
              <AlertTriangle size={18} />
            </span>
            <div>
              <div className="xm-code mono">{o.meter_name}</div>
              <div className="xm-meta">
                {tone && (
                  <span className="x-echip" style={{ background: tone.bg, color: tone.text }}>
                    <span className="dot" style={{ background: tone.color }} />{tone.label}
                  </span>
                )}
                <span className="xm-stamp">{fmtDate(o.timestamp)}</span>
              </div>
            </div>
          </div>
          <button className="xm-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="xm-kpis">
          <div className="xm-kpi">
            <span className="l">Gemessener Verbrauch</span>
            <span className="v alert">{fmtVal(o.consumption)}{unit && <span className="u">{unit}</span>}</span>
          </div>
          <div className="xm-kpi">
            <span className="l">Median des Zählers</span>
            <span className="v">{fmtVal(o.median_consumption)}</span>
          </div>
          <div className="xm-kpi">
            <span className="l">Faktor</span>
            <span className={`v ${sev.kind}`}>{fmtFactor(o.factor)}</span>
          </div>
          <div className="xm-kpi">
            <span className="l">Schweregrad</span>
            <span className="v">
              <span className={`x-state ${sev.kind === 'info' ? 'info' : 'alert'}`} style={sev.kind === 'warn' ? { color: 'var(--warn)' } : undefined}>{sev.label}</span>
            </span>
          </div>
        </div>

        <div className="xm-chart">
          <div className="xm-chart-head">
            <span className="t">Verbrauch im Verlauf</span>
            <span className="lg"><span className="lg-line" />Median {fmtVal(o.median_consumption)}</span>
          </div>
          <div className="xm-bars">
            <div className="xm-median-line" style={{ bottom: `${(o.median_consumption / max) * 100}%` }} />
            {chartPoints.map((p) => {
              const spike = p.id === o.reading_id;
              const h = Math.max(1.5, (Math.abs(p.consumption ?? 0) / max) * 100);
              return (
                <div className="xm-bar-col" key={p.id}>
                  <div className="xm-bar-track">
                    {spike && <div className="xm-interp" style={{ height: `${(o.median_consumption / max) * 100}%` }} title="Interpolationsvorschlag" />}
                    <div className={`xm-bar${spike ? ' spike' : ''}`}
                      style={{ height: `${h}%`, background: spike ? 'var(--alert)' : (tone?.color ?? 'var(--ink-3)') }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="xm-chart-foot">
            <Info size={13} style={{ color: 'var(--ink-4)' }} />
            Interpolation ersetzt den Wert durch <strong>{fmtVal(o.median_consumption)}</strong> (≈ Median benachbarter Ablesungen).
          </div>
        </div>

        <div className="xm-foot">
          <span className={`x-state ${stateOf(o.quality).cls}`}>{stateOf(o.quality).label}</span>
          <div className="xm-foot-btns">
            <button className="x-btn-soft red" onClick={() => onAction('delete')}><Trash2 size={13} /> Löschen</button>
            <button className="x-btn-soft amber" onClick={() => onAction('flag')}><Flag size={13} /> Markieren</button>
            <button className="x-btn-info" onClick={() => onAction('interpolate')}><TrendingDown size={13} /> Interpolieren</button>
          </div>
        </div>
      </div>
    </div>
  );
}

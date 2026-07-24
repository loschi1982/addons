import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Upload,
  History,
  Info,
  ChevronDown,
  ChevronRight,
  X,
  Check,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Plus,
  RefreshCw,
  Plug,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';

// ── Typen ──

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
}

interface DetectedMeterColumn {
  column_index: number;
  column_name: string;
  matched_meter_id: string | null;
  matched_meter_name: string | null;
}

interface UploadResult {
  batch_id: string;
  filename: string;
  detected_columns: string[];
  preview_rows: Record<string, string>[];
  row_count: number;
  is_multi_meter: boolean;
  meter_columns: DetectedMeterColumn[] | null;
}

interface ImportResult {
  batch_id: string;
  status: string;
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  errors: Array<{ row?: number; error?: string }>;
  meter_details?: Array<{ meter_id: string; imported: number; errors: number }>;
}

interface MappingProfile {
  id: string;
  name: string;
  column_mapping: Record<string, string>;
  meter_mapping: Record<string, string> | null;
  date_format: string | null;
  decimal_separator: string;
  created_at: string;
}

interface ImportBatch {
  batch_id: string;
  filename: string;
  status: string;
  total_rows: number;
  imported_count: number;
  created_at: string;
}

type WizardStep = 'upload' | 'mapping' | 'result';

const TARGET_COLUMNS: Record<string, string> = {
  '': '– Nicht zuordnen –',
  timestamp: 'Zeitstempel',
  value: 'Zählerstand',
  meter_id: 'Zähler-ID',
  notes: 'Notizen',
};

// ── Komponente ──

export default function ImportPage() {
  const [activeTab, setActiveTab] = useState<'wizard' | 'history'>('wizard');

  // Wizard
  const [step, setStep] = useState<WizardStep>('upload');
  const [meters, setMeters] = useState<Meter[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [fileName, setFileName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Single-Meter Mapping
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const [decimalSeparator, setDecimalSeparator] = useState(',');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  // Multi-Meter Mapping
  const [meterColumnMapping, setMeterColumnMapping] = useState<Record<string, string>>({});

  // Result
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // History
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Format-Hinweis
  const [showFormatHint, setShowFormatHint] = useState(false);

  // Zähler laden
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<PaginatedResponse<Meter>>('/api/v1/meters?page_size=100');
        setMeters(res.data.items);
      } catch {
        // Interceptor handled
      }
    })();
  }, []);

  // Profile laden
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<MappingProfile[]>('/api/v1/imports/profiles/list');
        setProfiles(res.data);
      } catch {
        // Interceptor handled
      }
    })();
  }, []);

  // ── Schritt 1: Upload ──

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await apiClient.post<UploadResult>('/api/v1/imports/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setUploadResult(res.data);

      if (res.data.is_multi_meter && res.data.meter_columns) {
        const autoMapping: Record<string, string> = {};
        for (const mc of res.data.meter_columns) {
          if (mc.matched_meter_id) {
            autoMapping[String(mc.column_index)] = mc.matched_meter_id;
          }
        }
        setMeterColumnMapping(autoMapping);
      } else {
        const autoMapping: Record<string, string> = {};
        for (const col of res.data.detected_columns) {
          const lower = col.toLowerCase();
          if (lower.includes('datum') || lower.includes('date') || lower.includes('zeit') || lower.includes('time')) {
            autoMapping[col] = 'timestamp';
          } else if (lower.includes('stand') || lower.includes('value') || lower.includes('wert') || lower.includes('kwh') || lower.includes('mwh')) {
            autoMapping[col] = 'value';
          } else if (lower.includes('notiz') || lower.includes('note') || lower.includes('bemerkung')) {
            autoMapping[col] = 'notes';
          }
        }
        setColumnMapping(autoMapping);
      }

      setStep('mapping');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setUploadError(error.response?.data?.detail || 'Fehler beim Hochladen');
    } finally {
      setUploading(false);
    }
  };

  const applyProfile = (profile: MappingProfile) => {
    setColumnMapping(profile.column_mapping);
    setDateFormat(profile.date_format || '');
    setDecimalSeparator(profile.decimal_separator);
    if (profile.meter_mapping) {
      setMeterColumnMapping(profile.meter_mapping);
    }
  };

  // ── Schritt 2: Import starten ──

  const handleProcess = async () => {
    setMappingError(null);

    if (uploadResult?.is_multi_meter) {
      const assignedCount = Object.values(meterColumnMapping).filter((v) => v).length;
      if (assignedCount === 0) {
        setMappingError('Bitte ordnen Sie mindestens eine Spalte einem Zähler zu.');
        return;
      }
    } else {
      const mapped = Object.values(columnMapping);
      if (!mapped.includes('timestamp')) {
        setMappingError('Bitte ordnen Sie eine Spalte als "Zeitstempel" zu.');
        return;
      }
      if (!mapped.includes('value')) {
        setMappingError('Bitte ordnen Sie eine Spalte als "Zählerstand" zu.');
        return;
      }
      if (!mapped.includes('meter_id') && !selectedMeterId) {
        setMappingError('Bitte wählen Sie einen Zähler aus oder ordnen Sie eine meter_id-Spalte zu.');
        return;
      }
    }

    setProcessing(true);

    try {
      if (uploadResult?.is_multi_meter) {
        const filteredMapping: Record<string, string> = {};
        for (const [colIdx, meterId] of Object.entries(meterColumnMapping)) {
          if (meterId) {
            filteredMapping[colIdx] = meterId;
          }
        }

        const res = await apiClient.post<ImportResult>('/api/v1/imports/process', {
          batch_id: uploadResult!.batch_id,
          column_mapping: {},
          meter_column_mapping: filteredMapping,
          date_format: dateFormat || null,
          decimal_separator: decimalSeparator,
          skip_duplicates: skipDuplicates,
          save_as_profile: profileName || null,
        });
        setImportResult(res.data);
      } else {
        const finalMapping = { ...columnMapping };
        const mapped = Object.values(columnMapping);
        if (!mapped.includes('meter_id') && selectedMeterId) {
          finalMapping['__meter_id__'] = selectedMeterId;
        }

        const res = await apiClient.post<ImportResult>('/api/v1/imports/process', {
          batch_id: uploadResult!.batch_id,
          column_mapping: finalMapping,
          date_format: dateFormat || null,
          decimal_separator: decimalSeparator,
          skip_duplicates: skipDuplicates,
          save_as_profile: profileName || null,
        });
        setImportResult(res.data);
      }
      setStep('result');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setMappingError(error.response?.data?.detail || 'Fehler beim Importieren');
    } finally {
      setProcessing(false);
    }
  };

  // ── Reset ──

  const handleReset = () => {
    setStep('upload');
    setUploadResult(null);
    setColumnMapping({});
    setMeterColumnMapping({});
    setSelectedMeterId('');
    setDateFormat('');
    setDecimalSeparator(',');
    setProfileName('');
    setImportResult(null);
    setUploadError(null);
    setMappingError(null);
    setFileName('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── History ──

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get('/api/v1/imports/history');
      setHistory(res.data.items || res.data || []);
    } catch {
      // Interceptor handled
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab, loadHistory]);

  const handleUndoImport = async (batchId: string) => {
    if (!confirm('Import wirklich rückgängig machen? Alle importierten Stände werden gelöscht.')) return;
    try {
      await apiClient.delete(`/api/v1/imports/${batchId}`);
      loadHistory();
    } catch {
      // Interceptor handled
    }
  };

  // ── Hilfsfunktionen ──

  const assignedMeterIds = new Set(Object.values(meterColumnMapping).filter(Boolean));
  const getMeterLabel = (meterId: string) => {
    const m = meters.find((m) => m.id === meterId);
    return m ? `${m.name} (${ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type})` : meterId;
  };
  const assignedColumnCount = Object.values(meterColumnMapping).filter(Boolean).length;

  const STEPS: Array<{ id: WizardStep; label: string }> = [
    { id: 'upload', label: 'Hochladen' },
    { id: 'mapping', label: 'Zuordnung' },
    { id: 'result', label: 'Ergebnis' },
  ];
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="imp">
      <PageHead eyebrow="System" title="Datenimport" />
      <div className="head-lead">Zählerstände aus CSV- oder Excel-Dateien importieren · SPIE-Automatik anbinden</div>

      <div className="imp-tabs">
        <button className={'imp-tab' + (activeTab === 'wizard' ? ' active' : '')} onClick={() => setActiveTab('wizard')}>
          <Upload size={15} /> Import-Assistent
        </button>
        <button className={'imp-tab' + (activeTab === 'history' ? ' active' : '')} onClick={() => setActiveTab('history')}>
          <History size={15} /> Import-Verlauf
          {history.length > 0 && <span className="tab-badge">{history.length}</span>}
        </button>
      </div>

      {activeTab === 'wizard' && (
        <div className="imp-wrap">
          {/* Stepper */}
          <div className="stepper">
            {STEPS.map((s, i) => (
              <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className={'step' + (i === stepIndex ? ' active' : i < stepIndex ? ' done' : '')}>
                  <span className="num">{i < stepIndex ? <Check size={12} /> : i + 1}</span>
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="step-sep"><ChevronRight size={14} /></span>}
              </span>
            ))}
          </div>

          {/* ── Schritt 1: Upload ── */}
          {step === 'upload' && (
            <>
              <FormatPanel open={showFormatHint} onToggle={() => setShowFormatHint((v) => !v)} />

              {uploadError && (
                <div className="result-banner" style={{ background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '12px 14px', color: 'var(--alert)', fontSize: 13 }}>
                  {uploadError}
                </div>
              )}

              <div className={'dropzone' + (fileName ? ' armed' : '')}>
                <span className="dz-ico"><Upload size={20} /></span>
                <div className="dz-body">
                  <div className="dz-title">
                    {fileName ? <>Bereit: <span className="fname">{fileName}</span></> : 'CSV- oder Excel-Datei hochladen'}
                  </div>
                  <div className="dz-sub">Unterstützt: .csv, .xlsx, .xls · Spalten werden automatisch erkannt</div>
                </div>
                <div className="dz-actions">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    className="file-native"
                    onChange={(e) => setFileName(e.target.files?.[0]?.name || '')}
                  />
                  <button onClick={handleUpload} className="btn-primary" disabled={uploading || !fileName}>
                    {uploading ? <RefreshCw size={14} /> : <Upload size={14} />}
                    {uploading ? 'Wird hochgeladen…' : 'Hochladen'}
                  </button>
                </div>
              </div>

              <SpiePanel />
            </>
          )}

          {/* ── Schritt 2: Mapping ── */}
          {step === 'mapping' && uploadResult && (
            <>
              <div className="file-summary">
                <span className="fs-ico"><CheckCircle2 size={18} /></span>
                <div>
                  <div className="fs-name">{uploadResult.filename}</div>
                  <div className="fs-sub">Datei eingelesen · Spalten automatisch erkannt</div>
                </div>
                <div className="fs-badges">
                  <span className="fs-badge">Zeilen <b>{uploadResult.row_count.toLocaleString('de-DE')}</b></span>
                  <span className="fs-badge">
                    {uploadResult.is_multi_meter ? 'Zähler-Spalten' : 'Spalten'}{' '}
                    <b>{uploadResult.is_multi_meter ? uploadResult.meter_columns?.length || 0 : uploadResult.detected_columns.length}</b>
                  </span>
                  <span className="fs-badge">Trennzeichen <b>auto</b></span>
                </div>
              </div>

              <div className="card">
                <div className="sec-title">{uploadResult.is_multi_meter ? 'Zähler-Zuordnung' : 'Spalten zuordnen'}</div>
                <p className="sec-sub">
                  {uploadResult.is_multi_meter
                    ? 'Ordnen Sie jede CSV-Spalte einem bestehenden Zähler zu. Automatisch erkannte Zuordnungen sind vorausgewählt.'
                    : 'Jede Datenspalte wird einer Zielspalte zugeordnet. Vorschläge stammen aus dem automatischen Abgleich – bitte prüfen.'}
                </p>

                {mappingError && (
                  <div style={{ marginBottom: 14, background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-sm)', padding: '9px 12px', color: 'var(--alert)', fontSize: 12.5 }}>
                    {mappingError}
                  </div>
                )}

                {/* Profile */}
                {((uploadResult.is_multi_meter && profiles.filter((p) => p.meter_mapping).length > 0) ||
                  (!uploadResult.is_multi_meter && profiles.length > 0)) && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="fmt-label" style={{ marginBottom: 7 }}>Gespeicherte Vorlage laden</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {(uploadResult.is_multi_meter ? profiles.filter((p) => p.meter_mapping) : profiles).map((p) => (
                        <button key={p.id} className="btn-soft small" onClick={() => applyProfile(p)}>{p.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Multi-Meter */}
                {uploadResult.is_multi_meter && uploadResult.meter_columns ? (
                  <>
                    <div className="map-list">
                      {uploadResult.meter_columns.map((mc) => {
                        const currentMeter = meterColumnMapping[String(mc.column_index)];
                        const isAutoMatched = mc.matched_meter_id && currentMeter === mc.matched_meter_id;
                        return (
                          <div key={mc.column_index} className={'map-rowc' + (currentMeter ? (isAutoMatched ? ' matched' : ' assigned') : '')}>
                            <div className="map-col">
                              <div style={{ minWidth: 0 }}>
                                <div className="col-name" title={mc.column_name}>{mc.column_name}</div>
                                {mc.matched_meter_name && isAutoMatched && <div className="col-hint">Automatisch erkannt</div>}
                              </div>
                            </div>
                            <span className="map-arrow"><ArrowRight size={15} /></span>
                            <select
                              className={'sel' + (currentMeter ? '' : ' empty')}
                              value={currentMeter || ''}
                              onChange={(e) => setMeterColumnMapping({ ...meterColumnMapping, [String(mc.column_index)]: e.target.value })}
                            >
                              <option value="">— nicht importieren —</option>
                              {meters.map((m) => (
                                <option key={m.id} value={m.id} disabled={assignedMeterIds.has(m.id) && currentMeter !== m.id}>
                                  {m.name} ({ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type} – {m.unit})
                                  {assignedMeterIds.has(m.id) && currentMeter !== m.id ? ' ✓' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--ink-3)' }}>
                      {assignedColumnCount} von {uploadResult.meter_columns.length} Spalten zugeordnet
                    </div>
                  </>
                ) : (
                  /* Single-Meter */
                  <>
                    <div className="map-list">
                      {uploadResult.detected_columns.map((col) => (
                        <div key={col} className={'map-rowc' + (columnMapping[col] ? ' assigned' : '')}>
                          <div className="map-col">
                            <span className="col-name" title={col}>{col}</span>
                          </div>
                          <span className="map-arrow"><ArrowRight size={15} /></span>
                          <select className="sel" value={columnMapping[col] || ''} onChange={(e) => setColumnMapping({ ...columnMapping, [col]: e.target.value })}>
                            {Object.entries(TARGET_COLUMNS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    {!Object.values(columnMapping).includes('meter_id') && (
                      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--line)' }}>
                        <div className="fmt-label" style={{ marginBottom: 7 }}>Zähler für alle Zeilen *</div>
                        <select className="sel" style={{ maxWidth: 420 }} value={selectedMeterId} onChange={(e) => setSelectedMeterId(e.target.value)}>
                          <option value="">– Zähler wählen –</option>
                          {meters.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type} – {m.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </>
                )}

                {/* Optionen */}
                <div className="opt-grid">
                  <div className="ifield">
                    <label>Datumsformat (optional)</label>
                    <input type="text" className="inp mono" placeholder="z. B. %d.%m.%Y %H:%M" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)} />
                  </div>
                  <div className="ifield">
                    <label>Dezimaltrennzeichen</label>
                    <select className="sel" value={decimalSeparator} onChange={(e) => setDecimalSeparator(e.target.value)}>
                      <option value=",">Komma (1.234,56)</option>
                      <option value=".">Punkt (1,234.56)</option>
                    </select>
                  </div>
                  <div className="ifield">
                    <label>Profil speichern als</label>
                    <input type="text" className="inp" placeholder="z. B. EVU-Abrechnung" value={profileName} onChange={(e) => setProfileName(e.target.value)} />
                  </div>
                </div>

                <label className={'check' + (skipDuplicates ? ' on' : '')} style={{ marginTop: 14 }} onClick={() => setSkipDuplicates((v) => !v)}>
                  <span className="box"><Check size={12} /></span> Duplikate überspringen (gleicher Zeitstempel + Zähler)
                </label>
              </div>

              {/* Vorschau */}
              <div className="card" style={{ padding: 0 }}>
                <div className="fmt-label" style={{ padding: '14px 16px 10px' }}>Vorschau · erste {Math.min(5, uploadResult.preview_rows.length)} Zeilen</div>
                <div className="preview-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0 }}>
                  <table className="pv-table">
                    <thead>
                      <tr>
                        {uploadResult.detected_columns.map((col, idx) => {
                          if (uploadResult.is_multi_meter && idx > 0) {
                            const meterId = meterColumnMapping[String(idx)];
                            const meter = meterId ? meters.find((m) => m.id === meterId) : null;
                            return (
                              <th key={col}>
                                <span title={col}>{meter ? meter.name : col.length > 25 ? col.slice(0, 25) + '…' : col}</span>
                                {meter && <span className="tag-ok">zugeordnet</span>}
                              </th>
                            );
                          }
                          return (
                            <th key={col}>
                              {col}
                              {!uploadResult.is_multi_meter && columnMapping[col] && (
                                <span className="tag-mapped"> ({TARGET_COLUMNS[columnMapping[col]]})</span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.preview_rows.slice(0, 5).map((row, idx) => (
                        <tr key={idx}>
                          {uploadResult.detected_columns.map((col) => (
                            <td key={col}>{row[col] ?? ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Aktionen */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <button onClick={handleReset} className="btn-soft">Zurück</button>
                <button onClick={handleProcess} className="btn-primary" disabled={processing}>
                  <Check size={14} />
                  {processing
                    ? 'Importiere…'
                    : uploadResult.is_multi_meter
                      ? `${uploadResult.row_count} Zeilen × ${assignedColumnCount} Zähler importieren`
                      : `${uploadResult.row_count} Zeilen importieren`}
                </button>
              </div>
            </>
          )}

          {/* ── Schritt 3: Ergebnis ── */}
          {step === 'result' && importResult && (
            <>
              <div className={'result-hero' + (importResult.error_count > 0 ? ' warnhero' : '')}>
                <span className="rh-ico">{importResult.error_count > 0 ? <AlertTriangle size={26} /> : <CheckCircle2 size={26} />}</span>
                <div>
                  <div className="rh-title">
                    {importResult.error_count > 0 ? 'Import mit Hinweisen abgeschlossen' : 'Import erfolgreich abgeschlossen'}
                  </div>
                  <div className="rh-sub">
                    {uploadResult?.filename} · {importResult.imported_count.toLocaleString('de-DE')} Werte importiert
                  </div>
                </div>
              </div>

              <div className="result-stats">
                <div className="rstat"><span className="l">Gesamt</span><span className="v">{importResult.total_rows.toLocaleString('de-DE')}</span><span className="m">Zeilen verarbeitet</span></div>
                <div className="rstat"><span className="l">Importiert</span><span className="v good">{importResult.imported_count.toLocaleString('de-DE')}</span><span className="m">Werte übernommen</span></div>
                <div className="rstat"><span className="l">Übersprungen</span><span className="v warn">{importResult.skipped_count.toLocaleString('de-DE')}</span><span className="m">Duplikate / leer</span></div>
                <div className="rstat"><span className="l">Fehler</span><span className={'v' + (importResult.error_count > 0 ? ' alert' : '')}>{importResult.error_count.toLocaleString('de-DE')}</span><span className="m">Konflikte</span></div>
              </div>

              {importResult.meter_details && importResult.meter_details.length > 0 && (
                <div className="card" style={{ padding: 0 }}>
                  <div className="sec-title" style={{ padding: '16px 16px 0' }}>Details pro Zähler</div>
                  <div className="preview-wrap" style={{ border: 'none', borderTop: '1px solid var(--line)', borderRadius: 0, marginTop: 12 }}>
                    <table className="pv-table" style={{ fontFamily: 'var(--font-sans)' }}>
                      <thead>
                        <tr>
                          <th>Zähler</th>
                          <th style={{ textAlign: 'right' }}>Importiert</th>
                          <th style={{ textAlign: 'right' }}>Fehler</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importResult.meter_details.map((md) => (
                          <tr key={md.meter_id}>
                            <td style={{ fontFamily: 'var(--font-sans)', fontWeight: 500, color: 'var(--ink)' }}>{getMeterLabel(md.meter_id)}</td>
                            <td style={{ textAlign: 'right', color: 'var(--good)' }}>{md.imported}</td>
                            <td style={{ textAlign: 'right', color: md.errors > 0 ? 'var(--alert)' : 'var(--ink-3)' }}>{md.errors}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResult.error_count > 0 && (
                <div className="card">
                  <div className="sec-title" style={{ color: 'var(--alert)' }}>Fehlerdetails</div>
                  <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: 10, fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>
                    {importResult.errors.map((err, idx) => (
                      <div key={idx} style={{ padding: '3px 0', color: 'var(--alert)' }}>
                        {err.row != null && <span>Zeile {err.row}: </span>}
                        {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={handleReset} className="btn-primary"><Plus size={14} /> Neuen Import starten</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      {activeTab === 'history' && (
        <div className="imp-wrap">
          {historyLoading ? (
            <div className="card"><LoadingSpinner /></div>
          ) : history.length === 0 ? (
            <div className="hist-table"><div className="empty-pad">Noch keine Imports durchgeführt.</div></div>
          ) : (
            <div className="hist-table">
              <div className="hist-row head">
                <span>Datei</span>
                <span>Datum</span>
                <span style={{ textAlign: 'right' }}>Zeilen</span>
                <span style={{ textAlign: 'right' }}>Importiert</span>
                <span>Status</span>
              </div>
              {history.map((batch) => (
                <div className="hist-row" key={batch.batch_id}>
                  <span className="hist-fname" title={batch.filename}>{batch.filename}</span>
                  <span className="hist-date">
                    {new Date(batch.created_at).toLocaleDateString('de-DE', {
                      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                  <span className="hist-num">{batch.total_rows.toLocaleString('de-DE')}</span>
                  <span className="hist-num">{batch.imported_count.toLocaleString('de-DE')}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <HistStatus status={batch.status} />
                    {batch.status === 'completed' && (
                      <button className="mini-link" style={{ color: 'var(--alert)' }} onClick={() => handleUndoImport(batch.batch_id)}>
                        Rückgängig
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Format-Panel (CSV-Vorgabe) ──

function FormatPanel({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="info-panel">
      <div className="info-head" onClick={onToggle}>
        <span className="ico"><Info size={15} /></span>
        <span className="t">CSV-Format-Vorgabe</span>
        <span className="toggle">
          {open ? 'Ausblenden' : 'Anzeigen'}
          <ChevronDown size={14} className={'chev' + (open ? ' open' : '')} />
        </span>
      </div>
      {open && (
        <div className="info-body">
          <div className="fmt-block">
            <span className="fmt-label">Einzelzähler-CSV</span>
            <div className="code-block">
              <span className="k">Zeitstempel;Zählerstand</span>{'\n'}01.01.2025;16600,49{'\n'}02.01.2025;22302,95
            </div>
          </div>
          <div className="fmt-block">
            <span className="fmt-label">Multi-Zähler-CSV</span>
            <div className="code-block">
              <span className="k">Datum;Zähler A;Zähler B;Zähler C</span>{'\n'}01.01.2025;16600,49;0;0,82{'\n'}02.01.2025;22302,95;0;0,19
            </div>
          </div>
          <div className="rules">
            {[
              ['1. Spalte:', ' Zeitstempel (TT.MM.JJJJ oder JJJJ-MM-TT)'],
              ['Ab Spalte 2:', ' Je ein Zählerwert pro Spalte'],
              ['1. Zeile:', ' Spaltenüberschriften (Name/Kennung)'],
              ['Trennzeichen:', ' Semikolon oder Komma (auto)'],
              ['Dezimalformat:', ' Komma (1.234,56) oder Punkt'],
              ['Keine', ' Status-, Einheiten- oder Zusatzspalten'],
            ].map(([b, t], i) => (
              <div className="rule-row" key={i}>
                <span className="dot" />
                <span><b>{b}</b>{t}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HistStatus({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    completed: { cls: 'ok', label: 'Erfolgreich' },
    processing: { cls: 'neutral', label: 'In Bearbeitung' },
    failed: { cls: 'err', label: 'Fehlgeschlagen' },
    reverted: { cls: 'neutral', label: 'Rückgängig' },
    uploaded: { cls: 'neutral', label: 'Hochgeladen' },
  };
  const m = map[status] || { cls: 'neutral', label: status };
  return <span className={'hist-status ' + m.cls}><span className="dot" />{m.label}</span>;
}

// ── SPIE-Automatik-Import ──

const LS_SPIE_JOB = 'spie_sync_job_id';

interface SpieProgress {
  status: 'running' | 'done' | 'error';
  phase?: string;
  current_meter?: number;
  total_meters?: number;
  meter_name?: string;
  imported?: number;
  errors?: number;
  percent?: number;
  error?: string;
}

interface SpieMeter {
  id: string;
  name: string;
  display_name: string | null;
  location: string | null;
  energy_type: string;
  data_source: string;
  spie_import_excluded: boolean;
}

function SpiePanel() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [passwordSet, setPasswordSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [lastSync, setLastSync] = useState<{ synced_at: string | null; imported: number; errors: number; meters_processed: number } | null>(null);
  const [syncProgress, setSyncProgress] = useState<SpieProgress | null>(null);
  const [spieMeters, setSpieMeters] = useState<SpieMeter[]>([]);
  const [metersExpanded, setMetersExpanded] = useState(false);
  const [metersLoading, setMetersLoading] = useState(false);
  // Fallback: ab Wunschdatum neu einlesen (optional mit Ersetzen)
  const [fbOpen, setFbOpen] = useState(false);
  const [fbDate, setFbDate] = useState('');
  const [fbReplace, setFbReplace] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);

  const loadConfig = async () => {
    try {
      const [cfgRes, statusRes] = await Promise.all([
        apiClient.get('/api/v1/spie/config'),
        apiClient.get('/api/v1/spie/status'),
      ]);
      const cfg = cfgRes.data;
      setUsername(cfg.username || '');
      setEnabled(cfg.enabled || false);
      setPasswordSet(cfg.password_set || false);
      setLastSync(statusRes.data);
      if (cfg.username) loadSpieMeters();
    } catch {
      /* ignorieren */
    }
  };

  const loadSpieMeters = async () => {
    setMetersLoading(true);
    try {
      const res = await apiClient.get<{ items: SpieMeter[] }>('/api/v1/meters?data_source=spie&page_size=500');
      setSpieMeters(res.data.items);
    } catch {
      /* ignorieren */
    } finally {
      setMetersLoading(false);
    }
  };

  const toggleExclude = async (meter: SpieMeter) => {
    try {
      await apiClient.put(`/api/v1/meters/${meter.id}`, { spie_import_excluded: !meter.spie_import_excluded });
      setSpieMeters((prev) => prev.map((m) => (m.id === meter.id ? { ...m, spie_import_excluded: !m.spie_import_excluded } : m)));
    } catch {
      /* ignorieren */
    }
  };

  const changeToManual = async (meter: SpieMeter) => {
    try {
      await apiClient.put(`/api/v1/meters/${meter.id}`, { data_source: 'manual', spie_import_excluded: true });
      setSpieMeters((prev) => prev.map((m) => (m.id === meter.id ? { ...m, data_source: 'manual', spie_import_excluded: true } : m)));
    } catch {
      /* ignorieren */
    }
  };

  const resumePoll = (jobId: string) => {
    setSyncProgress({ status: 'running', phase: 'import' });
    let fails = 0;
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/v1/spie/progress/${jobId}`);
        fails = 0;
        const p: SpieProgress = res.data;
        setSyncProgress(p);
        if (p.status === 'done' || p.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(LS_SPIE_JOB);
          if (p.status === 'done') await loadConfig();
        }
      } catch {
        // Job nicht (mehr) auffindbar (404) oder Backend neu gestartet. Nach
        // mehreren Fehlversuchen aufgeben, damit kein ewiger "läuft"-Zustand
        // hängen bleibt (früher wurde hier stumm weitergepollt).
        fails += 1;
        if (fails >= 5) {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(LS_SPIE_JOB);
          setSyncProgress(null);
        }
      }
    }, 2000);
  };

  useEffect(() => {
    loadConfig();
    const jobId = localStorage.getItem(LS_SPIE_JOB);
    if (jobId) resumePoll(jobId);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await apiClient.post('/api/v1/spie/config', { username, password: password || '', enabled });
      setPassword('');
      setPasswordSet(true);
    } catch {
      /* Fehler ignorieren */
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!username || !password) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.post('/api/v1/spie/test', { username, password });
      setTestResult({ ok: true, message: res.data.message });
    } catch {
      setTestResult({ ok: false, message: 'Login fehlgeschlagen. Zugangsdaten prüfen.' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncProgress({ status: 'running', phase: 'login' });
    try {
      const res = await apiClient.post('/api/v1/spie/sync', {});
      const { job_id } = res.data;
      localStorage.setItem(LS_SPIE_JOB, job_id);
      resumePoll(job_id);
    } catch {
      setSyncProgress({ status: 'error', error: 'Import konnte nicht gestartet werden.' });
    }
  };

  const handleRecompute = async () => {
    // Verbrauch aus den bereits vorhandenen Rohwerten neu berechnen – kein
    // erneutes Scraping. Läuft im Backend als Hintergrund-Task; gleiche
    // Fortschrittsanzeige wie der Import.
    setSyncProgress({ status: 'running', phase: 'recompute' });
    try {
      const res = await apiClient.post('/api/v1/spie/recompute', {});
      const { job_id } = res.data;
      localStorage.setItem(LS_SPIE_JOB, job_id);
      resumePoll(job_id);
    } catch {
      setSyncProgress({ status: 'error', error: 'Nachberechnung konnte nicht gestartet werden.' });
    }
  };

  const handleResync = async () => {
    if (!fbDate) return;
    const dateStr = new Date(fbDate).toLocaleDateString('de-DE');
    const msg = fbReplace
      ? `Achtung: Vorhandene Messwerte ALLER aktiven SPIE-Zähler ab ${dateStr} werden gelöscht und durch die SPIE-Werte ersetzt.\n\nFortfahren?`
      : `SPIE-Werte ab ${dateStr} importieren? Vorhandene Werte bleiben erhalten, Duplikate werden übersprungen.`;
    if (!window.confirm(msg)) return;
    setSyncProgress({ status: 'running', phase: 'login' });
    try {
      const res = await apiClient.post('/api/v1/spie/sync', { from_date: fbDate, replace: fbReplace });
      const { job_id } = res.data;
      localStorage.setItem(LS_SPIE_JOB, job_id);
      resumePoll(job_id);
    } catch {
      setSyncProgress({ status: 'error', error: 'Import konnte nicht gestartet werden.' });
    }
  };

  const isRunning = syncProgress?.status === 'running';
  const isDone = syncProgress?.status === 'done';
  const isError = syncProgress?.status === 'error';

  const activeCount = spieMeters.filter((m) => !m.spie_import_excluded && m.data_source === 'spie').length;
  const pct =
    syncProgress?.current_meter && syncProgress?.total_meters
      ? Math.round((syncProgress.current_meter / syncProgress.total_meters) * 100)
      : isRunning
        ? 30
        : 0;

  return (
    <div className="card">
      <div className="spie-head">
        <div className="spie-head-l">
          <span className="spie-mark"><RefreshCw size={17} /></span>
          <div>
            <div className="spie-title">SPIE-Automatik-Import</div>
            <div className="sec-sub" style={{ margin: 0 }}>Zählerstände automatisch über die SPIE-Schnittstelle abrufen</div>
          </div>
        </div>
        {lastSync?.synced_at && (
          <div className="spie-meta">
            Letzter Import: <strong>{new Date(lastSync.synced_at).toLocaleString('de-DE')}</strong>
            {lastSync.meters_processed > 0 && (
              <>
                <br />
                <strong>{lastSync.imported.toLocaleString('de-DE')}</strong> Werte · {lastSync.meters_processed} Zähler
              </>
            )}
          </div>
        )}
      </div>

      <div className="field-grid">
        <div className="ifield">
          <label>Benutzername</label>
          <input
            className="inp mono"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              setTestResult(null);
            }}
            placeholder="SPIE-Benutzername"
            disabled={isRunning}
          />
        </div>
        <div className="ifield">
          <label>
            Passwort {passwordSet && !password && <span className="muted">(gesetzt)</span>}
          </label>
          <input
            className="inp"
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setTestResult(null);
            }}
            placeholder={passwordSet ? 'Unverändert lassen' : 'SPIE-Passwort'}
            disabled={isRunning}
          />
        </div>
      </div>

      <div className="spie-actions">
        <button className="btn-soft" onClick={handleTest} disabled={testing || !username || !password || isRunning}>
          <Plug size={14} /> {testing ? 'Prüfe…' : 'Verbindung testen'}
        </button>
        {testResult && (
          <span className={'test-result ' + (testResult.ok ? 'ok' : 'err')}>
            {testResult.ok ? <Check size={14} /> : <X size={14} />} {testResult.message}
          </span>
        )}
        <span className="grow" />
        <label className={'check' + (enabled ? ' on' : '')} onClick={() => !isRunning && setEnabled((v) => !v)}>
          <span className="box"><Check size={12} /></span> Automatischer Import alle 3 Tage
        </label>
        <button className="btn-soft" onClick={handleSave} disabled={saving || isRunning || !username}>
          {saving ? 'Speichern…' : 'Speichern'}
        </button>
        <button
          className="btn-soft"
          onClick={handleRecompute}
          disabled={isRunning || !username}
          title="Verbrauch aller SPIE-Zähler aus den vorhandenen Rohwerten neu berechnen (kein erneutes Scraping)"
        >
          <RefreshCw size={14} /> Verbrauch neu berechnen
        </button>
        <button className="btn-primary" onClick={handleSync} disabled={isRunning || !username}>
          {isRunning ? <RefreshCw size={14} /> : <Upload size={14} />} {isRunning ? 'Läuft…' : 'Jetzt importieren'}
        </button>
      </div>

      {/* Fallback: ab Wunschdatum neu einlesen */}
      <div className="manage" style={{ marginTop: 10 }}>
        <button className="manage-head" onClick={() => setFbOpen((v) => !v)}>
          <ChevronRight size={14} className={'chev' + (fbOpen ? ' open' : '')} />
          Fallback: ab Wunschdatum neu einlesen
        </button>
        {fbOpen && (
          <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
              Liest die SPIE-Messwerte aller aktiven SPIE-Zähler ab dem gewählten Datum neu ein –
              z.&nbsp;B. wenn der reguläre Import Lücken hat oder ein Zeitraum korrigiert werden soll.
            </div>
            <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="ifield" style={{ maxWidth: 200 }}>
                <label>Startdatum</label>
                <input
                  type="date"
                  className="inp mono"
                  value={fbDate}
                  max={todayStr}
                  onChange={(e) => setFbDate(e.target.value)}
                  disabled={isRunning}
                />
              </div>
              <label
                className={'check' + (fbReplace ? ' on' : '')}
                onClick={() => !isRunning && setFbReplace((v) => !v)}
                style={{ marginBottom: 7 }}
              >
                <span className="box"><Check size={12} /></span> Vorhandene Werte ab diesem Datum löschen &amp; ersetzen
              </label>
            </div>
            {fbReplace && (
              <div
                style={{
                  fontSize: 12, color: '#92400E', background: '#FEF3C7',
                  border: '1px solid #FCD34D', borderRadius: 6, padding: '8px 10px',
                  display: 'flex', gap: 7, alignItems: 'flex-start',
                }}
              >
                <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>
                  Vorhandene Messwerte der SPIE-Zähler ab dem Startdatum werden <strong>unwiderruflich gelöscht</strong> und
                  durch die SPIE-Werte ersetzt. Liefert SPIE für einen Zähler keine Daten, bleibt dessen Bestand unverändert.
                </span>
              </div>
            )}
            <div>
              <button
                className="btn-primary"
                onClick={handleResync}
                disabled={isRunning || !username || !fbDate}
              >
                <Upload size={14} /> {fbReplace ? 'Ab Datum ersetzen' : 'Ab Datum importieren'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Auto-Run Bar (wenn aktiviert und kein laufender Import) */}
      {enabled && !syncProgress && <SpieNextRunBar lastSyncedAt={lastSync?.synced_at ?? null} />}

      {/* Fortschritt / Ergebnis */}
      {syncProgress && (
        <div className={'imp-status' + (isDone ? ' done' : isError ? ' errstate' : ' running')}>
          <div className="is-row">
            <span className="is-label">
              <span className="dot" />
              {isRunning && (
                <>
                  Import läuft – <b>{activeCount > 0 ? activeCount : syncProgress.total_meters || ''} Zähler</b>
                </>
              )}
              {isDone && (
                <>
                  Import <b>abgeschlossen</b> – {syncProgress.imported?.toLocaleString('de-DE')} neue Werte
                  {syncProgress.errors ? `, ${syncProgress.errors} Fehler` : ''}
                </>
              )}
              {isError && <>Import <b>fehlgeschlagen</b> – {syncProgress.error}</>}
            </span>
            {(isDone || isError) && <button className="mini-link" onClick={() => setSyncProgress(null)}>Schließen</button>}
          </div>
          {isRunning && (
            <>
              <div className="bar"><span style={{ width: `${pct}%` }} /></div>
              <div className="is-detail">
                <span className="who">
                  {syncProgress.current_meter && syncProgress.total_meters
                    ? `Zähler ${syncProgress.current_meter} / ${syncProgress.total_meters}${syncProgress.meter_name ? ' – ' + syncProgress.meter_name : ''}`
                    : syncProgress.phase === 'login'
                      ? 'SPIE-Login…'
                      : 'Import wird vorbereitet…'}
                </span>
                <span className="pct">{pct}%</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* SPIE-Zähler verwalten */}
      <div className="manage">
        <button
          className="manage-head"
          onClick={() => {
            const next = !metersExpanded;
            setMetersExpanded(next);
            if (next) loadSpieMeters();
          }}
        >
          <ChevronRight size={14} className={'chev' + (metersExpanded ? ' open' : '')} />
          SPIE-Zähler verwalten <span className="count">{spieMeters.length}</span>
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>
            {activeCount} aktiv · {spieMeters.length - activeCount} aus
          </span>
        </button>

        {metersExpanded && (
          <div className="manage-list">
            {metersLoading && <div style={{ padding: 14, fontSize: 13, color: 'var(--ink-3)' }}>Lade Zähler…</div>}
            {!metersLoading && spieMeters.length === 0 && (
              <div style={{ padding: 14, fontSize: 13, color: 'var(--ink-3)' }}>Keine SPIE-Zähler gefunden.</div>
            )}
            {spieMeters.map((meter) => (
              <div key={meter.id} className={'mrow' + (meter.spie_import_excluded ? ' off' : '')}>
                <div className="m-main">
                  <span className="m-code">{meter.display_name || meter.name}</span>
                  <span className="m-name">
                    {meter.location || '—'}
                    {meter.data_source !== 'spie' && <span style={{ marginLeft: 8, color: 'var(--info)' }}>Quelle: Manuell</span>}
                  </span>
                </div>
                <div className="m-right">
                  {!meter.spie_import_excluded && meter.data_source === 'spie' && (
                    <button className="m-link" onClick={() => changeToManual(meter)} title="Auf Manuell umstellen und ausschließen">
                      <ArrowRight size={12} /> Manuell
                    </button>
                  )}
                  <label className={'check' + (meter.spie_import_excluded ? ' on' : '')} onClick={() => toggleExclude(meter)}>
                    <span className="box"><Check size={11} /></span> Import aus
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Fortschrittsbalken: Zeit bis zum nächsten SPIE-Auto-Import ── */

const SPIE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // 3 Tage

function SpieNextRunBar({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(tick);
  }, []);

  if (!lastSyncedAt) {
    return (
      <div className="imp-status" style={{ marginTop: 14 }}>
        <div className="is-row">
          <span className="is-label"><span className="dot" />Noch kein Import durchgeführt – nächster Lauf beim nächsten Zyklus.</span>
        </div>
      </div>
    );
  }

  const last = new Date(lastSyncedAt).getTime();
  const next = last + SPIE_INTERVAL_MS;
  const remainingMs = Math.max(0, next - now);
  const elapsedMs = Math.min(SPIE_INTERVAL_MS, now - last);
  const percent = Math.min(100, Math.max(0, (elapsedMs / SPIE_INTERVAL_MS) * 100));

  const isOverdue = remainingMs === 0;
  const remainingLabel = formatRemaining(remainingMs);
  const nextLabel = new Date(next).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <div className="imp-status" style={{ marginTop: 14 }}>
      <div className="is-row">
        <span className="is-label">
          <span className="dot" />
          {isOverdue ? <>Nächster Import <b>überfällig</b> – läuft beim nächsten Zyklus.</> : <>Nächster Import in <b>{remainingLabel}</b></>}
        </span>
        <span className="is-meta">geplant: {nextLabel}</span>
      </div>
      <div className={'bar' + (isOverdue ? ' overdue' : '')}><span style={{ width: `${percent}%` }} /></div>
    </div>
  );
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '0 min';
  const total_min = Math.floor(ms / 60_000);
  const days = Math.floor(total_min / 1440);
  const hours = Math.floor((total_min % 1440) / 60);
  const mins = total_min % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} Tag${days === 1 ? '' : 'e'}`);
  if (hours > 0) parts.push(`${hours} Std`);
  if (mins > 0 && days === 0) parts.push(`${mins} Min`);
  return parts.length ? parts.join(' ') : '< 1 Min';
}

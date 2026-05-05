import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';
import { Info } from 'lucide-react';

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
        const res = await apiClient.get<PaginatedResponse<Meter>>(
          '/api/v1/meters?page_size=100'
        );
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
        // Multi-Meter: Auto-Matching übernehmen
        const autoMapping: Record<string, string> = {};
        for (const mc of res.data.meter_columns) {
          if (mc.matched_meter_id) {
            autoMapping[String(mc.column_index)] = mc.matched_meter_id;
          }
        }
        setMeterColumnMapping(autoMapping);
      } else {
        // Single-Meter: bisherige Auto-Erkennung
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

    // Multi-Meter: Spalten-Index → Meter-UUID aus Profil übernehmen
    if (profile.meter_mapping) {
      setMeterColumnMapping(profile.meter_mapping);
    }
  };

  // ── Schritt 2: Import starten ──

  const handleProcess = async () => {
    setMappingError(null);

    if (uploadResult?.is_multi_meter) {
      // Multi-Meter Validierung
      const assignedCount = Object.values(meterColumnMapping).filter(v => v).length;
      if (assignedCount === 0) {
        setMappingError('Bitte ordnen Sie mindestens eine Spalte einem Zähler zu.');
        return;
      }
    } else {
      // Single-Meter Validierung
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
        // Multi-Meter: meter_column_mapping senden
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
        // Single-Meter: bisheriger Flow
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

  // Für Multi-Meter: welche Meter-IDs sind bereits vergeben
  const assignedMeterIds = new Set(Object.values(meterColumnMapping).filter(Boolean));

  // Zähler-Name finden
  const getMeterLabel = (meterId: string) => {
    const m = meters.find(m => m.id === meterId);
    return m ? `${m.name} (${ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type})` : meterId;
  };

  // Multi-Meter: Anzahl zugeordneter Spalten
  const assignedColumnCount = Object.values(meterColumnMapping).filter(Boolean).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Datenimport</h1>
          <p className="mt-1 text-sm text-gray-500">
            Zählerstände aus CSV oder Excel-Dateien importieren
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          <button
            className={`pb-2 text-sm font-medium ${activeTab === 'wizard' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('wizard')}
          >
            Import-Assistent
          </button>
          <button
            className={`pb-2 text-sm font-medium ${activeTab === 'history' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('history')}
          >
            Import-Verlauf
          </button>
        </nav>
      </div>

      {activeTab === 'wizard' && (
        <div className="mt-4">
          {/* Fortschrittsanzeige */}
          <div className="mb-6 flex items-center gap-2 text-sm">
            <StepIndicator label="1. Hochladen" active={step === 'upload'} done={step !== 'upload'} />
            <span className="text-gray-300">→</span>
            <StepIndicator label="2. Zuordnung" active={step === 'mapping'} done={step === 'result'} />
            <span className="text-gray-300">→</span>
            <StepIndicator label="3. Ergebnis" active={step === 'result'} done={false} />
          </div>

          {/* ── Schritt 1: Upload ── */}
          {step === 'upload' && (
            <div className="space-y-4">
              {/* Format-Hinweis */}
              <div className="card border-blue-200 bg-blue-50/50">
                <button
                  onClick={() => setShowFormatHint(!showFormatHint)}
                  className="flex items-center gap-2 text-sm font-semibold text-blue-800 w-full text-left"
                >
                  <Info className="w-4 h-4" />
                  CSV-Format-Vorgabe
                  <span className="ml-auto text-xs text-blue-600">{showFormatHint ? 'Ausblenden' : 'Anzeigen'}</span>
                </button>
                {showFormatHint && (
                  <div className="mt-3 space-y-2 text-sm text-blue-900">
                    <p className="font-medium">Einzelzähler-CSV:</p>
                    <div className="rounded bg-white/70 px-3 py-2 font-mono text-xs border border-blue-200">
                      Zeitstempel;Zählerstand<br />
                      01.01.2025;16600,49<br />
                      02.01.2025;22302,95
                    </div>
                    <p className="font-medium mt-3">Multi-Zähler-CSV:</p>
                    <div className="rounded bg-white/70 px-3 py-2 font-mono text-xs border border-blue-200">
                      Datum;Zähler A;Zähler B;Zähler C<br />
                      01.01.2025;16600,49;0;0,82<br />
                      02.01.2025;22302,95;0;0,19
                    </div>
                    <ul className="list-disc list-inside text-xs space-y-1 mt-2 text-blue-800">
                      <li><strong>1. Spalte:</strong> Zeitstempel (TT.MM.JJJJ oder JJJJ-MM-TT)</li>
                      <li><strong>Ab Spalte 2:</strong> Je ein Zählerwert pro Spalte</li>
                      <li><strong>1. Zeile:</strong> Spaltenüberschriften (Name/Kennung des Zählers)</li>
                      <li><strong>Trennzeichen:</strong> Semikolon oder Komma (automatisch erkannt)</li>
                      <li><strong>Dezimalformat:</strong> Komma (1.234,56) oder Punkt (1,234.56)</li>
                      <li>Keine Messstatus-, Einheiten- oder sonstige Zusatzspalten</li>
                    </ul>
                  </div>
                )}
              </div>

              <div className="card">
                <h2 className="mb-4 text-base font-semibold">Datei hochladen</h2>
                <p className="mb-4 text-sm text-gray-500">
                  Unterstützte Formate: CSV (.csv), Excel (.xlsx, .xls).
                  Die Spalten werden automatisch erkannt.
                </p>

                {uploadError && (
                  <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
                )}

                <div className="flex items-end gap-4">
                  <div className="flex-1">
                    <label className="label">Datei auswählen *</label>
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      className="input"
                    />
                  </div>
                  <button
                    onClick={handleUpload}
                    className="btn-primary"
                    disabled={uploading}
                  >
                    {uploading ? 'Wird hochgeladen...' : 'Hochladen'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ── Schritt 2: Mapping ── */}
          {step === 'mapping' && uploadResult && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold">
                      {uploadResult.is_multi_meter ? 'Zähler-Zuordnung' : 'Spaltenzuordnung'}
                    </h2>
                    <p className="text-sm text-gray-500">
                      {uploadResult.filename} – {uploadResult.row_count} Zeilen,{' '}
                      {uploadResult.is_multi_meter
                        ? `${uploadResult.meter_columns?.length || 0} Zähler-Spalten erkannt`
                        : `${uploadResult.detected_columns.length} Spalten erkannt`}
                    </p>
                  </div>
                  <button onClick={handleReset} className="btn-secondary text-sm">
                    Andere Datei
                  </button>
                </div>

                {mappingError && (
                  <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{mappingError}</div>
                )}

                {/* ── Multi-Meter Mapping ── */}
                {uploadResult.is_multi_meter && uploadResult.meter_columns ? (
                  <div>
                    {/* Gespeicherte Vorlagen */}
                    {profiles.filter(p => p.meter_mapping).length > 0 && (
                      <div className="mb-4">
                        <label className="label">Gespeicherte Vorlage laden</label>
                        <div className="flex flex-wrap gap-2">
                          {profiles.filter(p => p.meter_mapping).map((p) => (
                            <button
                              key={p.id}
                              onClick={() => applyProfile(p)}
                              className="btn-secondary text-xs"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="text-sm text-gray-500 mb-3">
                      Ordnen Sie jede CSV-Spalte einem bestehenden Zähler zu.
                      Automatisch erkannte Zuordnungen sind vorausgewählt.
                    </p>
                    <div className="space-y-2">
                      {uploadResult.meter_columns.map((mc) => {
                        const currentMeter = meterColumnMapping[String(mc.column_index)];
                        const isAutoMatched = mc.matched_meter_id && currentMeter === mc.matched_meter_id;
                        return (
                          <div
                            key={mc.column_index}
                            className={`flex items-center gap-4 rounded-lg border p-3 ${
                              currentMeter
                                ? isAutoMatched
                                  ? 'border-green-200 bg-green-50/50'
                                  : 'border-primary-200 bg-primary-50/30'
                                : 'border-gray-200'
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium truncate" title={mc.column_name}>
                                {mc.column_name}
                              </div>
                              {mc.matched_meter_name && isAutoMatched && (
                                <div className="text-xs text-green-600 mt-0.5">
                                  Automatisch erkannt
                                </div>
                              )}
                            </div>
                            <span className="text-gray-300 flex-shrink-0">→</span>
                            <select
                              className="input w-72 flex-shrink-0"
                              value={currentMeter || ''}
                              onChange={(e) => {
                                setMeterColumnMapping({
                                  ...meterColumnMapping,
                                  [String(mc.column_index)]: e.target.value,
                                });
                              }}
                            >
                              <option value="">– Nicht importieren –</option>
                              {meters.map((m) => (
                                <option
                                  key={m.id}
                                  value={m.id}
                                  disabled={assignedMeterIds.has(m.id) && currentMeter !== m.id}
                                >
                                  {m.name} ({ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type} – {m.unit})
                                  {assignedMeterIds.has(m.id) && currentMeter !== m.id ? ' ✓' : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 text-sm text-gray-500">
                      {assignedColumnCount} von {uploadResult.meter_columns.length} Spalten zugeordnet
                    </div>
                  </div>
                ) : (
                  /* ── Single-Meter Mapping (bisheriger Flow) ── */
                  <div>
                    {/* Profil laden */}
                    {profiles.length > 0 && (
                      <div className="mb-4">
                        <label className="label">Gespeichertes Profil laden</label>
                        <div className="flex gap-2">
                          {profiles.map((p) => (
                            <button
                              key={p.id}
                              onClick={() => applyProfile(p)}
                              className="btn-secondary text-xs"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Spalten-Zuordnung */}
                    <div className="space-y-2">
                      {uploadResult.detected_columns.map((col) => (
                        <div key={col} className="flex items-center gap-4">
                          <span className="w-40 truncate text-sm font-medium" title={col}>
                            {col}
                          </span>
                          <span className="text-gray-300">→</span>
                          <select
                            className="input w-48"
                            value={columnMapping[col] || ''}
                            onChange={(e) =>
                              setColumnMapping({ ...columnMapping, [col]: e.target.value })
                            }
                          >
                            {Object.entries(TARGET_COLUMNS).map(([val, label]) => (
                              <option key={val} value={val}>{label}</option>
                            ))}
                          </select>
                        </div>
                      ))}
                    </div>

                    {/* Zähler-Auswahl */}
                    {!Object.values(columnMapping).includes('meter_id') && (
                      <div className="mt-4 border-t pt-4">
                        <label className="label">Zähler für alle Zeilen *</label>
                        <select
                          className="input max-w-md"
                          value={selectedMeterId}
                          onChange={(e) => setSelectedMeterId(e.target.value)}
                        >
                          <option value="">– Zähler wählen –</option>
                          {meters.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type} – {m.unit})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* Optionen */}
                <div className="mt-4 border-t pt-4 grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">Datumsformat (optional)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="z.B. %d.%m.%Y %H:%M"
                      value={dateFormat}
                      onChange={(e) => setDateFormat(e.target.value)}
                    />
                    <p className="mt-1 text-xs text-gray-400">Leer = automatische Erkennung</p>
                  </div>
                  <div>
                    <label className="label">Dezimaltrennzeichen</label>
                    <select
                      className="input"
                      value={decimalSeparator}
                      onChange={(e) => setDecimalSeparator(e.target.value)}
                    >
                      <option value=",">Komma (1.234,56)</option>
                      <option value=".">Punkt (1,234.56)</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Profil speichern als</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="z.B. EVU-Abrechnung"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="skip_duplicates"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                  />
                  <label htmlFor="skip_duplicates" className="text-sm">
                    Duplikate überspringen (gleicher Zeitstempel + Zähler)
                  </label>
                </div>
              </div>

              {/* Vorschau */}
              <div className="card overflow-hidden p-0">
                <div className="bg-gray-50 px-4 py-2 text-xs font-semibold uppercase text-gray-500">
                  Vorschau (erste {uploadResult.preview_rows.length} Zeilen)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50 text-xs text-gray-500">
                      <tr>
                        {uploadResult.detected_columns.map((col, idx) => {
                          if (uploadResult.is_multi_meter && idx > 0) {
                            // Multi-Meter: Zähler-Name anzeigen wenn zugeordnet
                            const meterId = meterColumnMapping[String(idx)];
                            const meter = meterId ? meters.find(m => m.id === meterId) : null;
                            return (
                              <th key={col} className="px-3 py-2 text-left whitespace-nowrap">
                                <span className="truncate block max-w-[150px]" title={col}>
                                  {meter ? meter.name : col.length > 25 ? col.slice(0, 25) + '…' : col}
                                </span>
                                {meter && (
                                  <span className="text-green-600 text-[10px] block">zugeordnet</span>
                                )}
                              </th>
                            );
                          }
                          return (
                            <th key={col} className="px-3 py-2 text-left whitespace-nowrap">
                              {col}
                              {!uploadResult.is_multi_meter && columnMapping[col] && (
                                <span className="ml-1 text-primary-600">
                                  ({TARGET_COLUMNS[columnMapping[col]]})
                                </span>
                              )}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {uploadResult.preview_rows.slice(0, 5).map((row, idx) => (
                        <tr key={idx} className="hover:bg-gray-50">
                          {uploadResult.detected_columns.map((col) => (
                            <td key={col} className="px-3 py-1.5 whitespace-nowrap text-gray-600">
                              {row[col] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Aktionen */}
              <div className="flex justify-end gap-3">
                <button onClick={handleReset} className="btn-secondary">
                  Abbrechen
                </button>
                <button
                  onClick={handleProcess}
                  className="btn-primary"
                  disabled={processing}
                >
                  {processing
                    ? 'Importiere...'
                    : uploadResult.is_multi_meter
                      ? `${uploadResult.row_count} Zeilen × ${assignedColumnCount} Zähler importieren`
                      : `${uploadResult.row_count} Zeilen importieren`}
                </button>
              </div>
            </div>
          )}

          {/* ── Schritt 3: Ergebnis ── */}
          {step === 'result' && importResult && (
            <div className="card">
              <h2 className="mb-4 text-base font-semibold">Import-Ergebnis</h2>

              <div className="grid grid-cols-4 gap-4 mb-4">
                <StatBox label="Gesamt" value={importResult.total_rows} />
                <StatBox label="Importiert" value={importResult.imported_count} color="text-green-600" />
                <StatBox label="Übersprungen" value={importResult.skipped_count} color="text-yellow-600" />
                <StatBox label="Fehler" value={importResult.error_count} color="text-red-600" />
              </div>

              {/* Multi-Meter: Details pro Zähler */}
              {importResult.meter_details && importResult.meter_details.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold">Details pro Zähler</h3>
                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Zähler</th>
                          <th className="px-3 py-2 text-right">Importiert</th>
                          <th className="px-3 py-2 text-right">Fehler</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {importResult.meter_details.map((md) => (
                          <tr key={md.meter_id}>
                            <td className="px-3 py-2 font-medium">{getMeterLabel(md.meter_id)}</td>
                            <td className="px-3 py-2 text-right text-green-600 font-mono">{md.imported}</td>
                            <td className="px-3 py-2 text-right text-red-600 font-mono">{md.errors}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {importResult.error_count > 0 && (
                <div className="mb-4">
                  <h3 className="mb-2 text-sm font-semibold text-red-600">Fehlerdetails</h3>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm">
                    {importResult.errors.map((err, idx) => (
                      <div key={idx} className="py-0.5 text-red-700">
                        {err.row != null && <span className="font-mono">Zeile {err.row}: </span>}
                        {err.error}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button onClick={handleReset} className="btn-primary">
                  Neuer Import
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Tab ── */}
      <SpiePanel />

      {activeTab === 'history' && (
        <div className="card mt-4 overflow-hidden p-0">
          {historyLoading ? (
            <div className="p-8 text-center text-gray-400">Laden...</div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              Noch keine Imports durchgeführt.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Datei</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Zeilen</th>
                  <th className="px-4 py-3 text-right">Importiert</th>
                  <th className="px-4 py-3">Datum</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {history.map((batch) => (
                  <tr key={batch.batch_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{batch.filename}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={batch.status} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{batch.total_rows}</td>
                    <td className="px-4 py-3 text-right font-mono">{batch.imported_count}</td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(batch.created_at).toLocaleDateString('de-DE', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {batch.status === 'completed' && (
                        <button
                          onClick={() => handleUndoImport(batch.batch_id)}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          Rückgängig
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    } catch { /* ignorieren */ }
  };

  const resumePoll = (jobId: string) => {
    setSyncProgress({ status: 'running', phase: 'import' });
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/v1/spie/progress/${jobId}`);
        const p: SpieProgress = res.data;
        setSyncProgress(p);
        if (p.status === 'done' || p.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(LS_SPIE_JOB);
          if (p.status === 'done') await loadConfig();
        }
      } catch { /* Job noch nicht bereit – weiter pollen */ }
    }, 2000);
  };

  useEffect(() => {
    loadConfig();
    const jobId = localStorage.getItem(LS_SPIE_JOB);
    if (jobId) resumePoll(jobId);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      await apiClient.post('/api/v1/spie/config', {
        username,
        password: password || '',
        enabled,
      });
      setPassword('');
      setPasswordSet(true);
    } catch { /* Fehler ignorieren */ }
    finally { setSaving(false); }
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
    } finally { setTesting(false); }
  };

  const handleSync = async () => {
    setSyncProgress({ status: 'running', phase: 'login' });
    try {
      const res = await apiClient.post('/api/v1/spie/sync');
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

  return (
    <div className="card mt-6 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🔄</span>
          <h2 className="font-semibold text-gray-800">SPIE-Automatik-Import</h2>
        </div>
        {lastSync?.synced_at && (
          <span className="text-xs text-gray-400">
            Letzter Import: {new Date(lastSync.synced_at).toLocaleString('de-DE')}
            {lastSync.meters_processed > 0 && ` · ${lastSync.imported.toLocaleString('de-DE')} Werte`}
          </span>
        )}
      </div>

      {/* Zugangsdaten */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Benutzername</label>
          <input
            type="text"
            value={username}
            onChange={e => { setUsername(e.target.value); setTestResult(null); }}
            className="input w-full"
            placeholder="SPIE-Benutzername"
            disabled={isRunning}
          />
        </div>
        <div>
          <label className="label">
            Passwort{passwordSet && !password && <span className="text-gray-400 font-normal ml-1">(gesetzt)</span>}
          </label>
          <input
            type="password"
            value={password}
            onChange={e => { setPassword(e.target.value); setTestResult(null); }}
            className="input w-full"
            placeholder={passwordSet ? 'Unverändert lassen' : 'SPIE-Passwort'}
            disabled={isRunning}
          />
        </div>
      </div>

      {/* Verbindungstest */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleTest}
          disabled={testing || !username || !password || isRunning}
          className="btn-secondary text-sm"
        >
          {testing ? 'Wird getestet…' : 'Verbindung testen'}
        </button>
        {testResult && (
          <span className={`text-sm ${testResult.ok ? 'text-green-600' : 'text-red-600'}`}>
            {testResult.ok ? '✓' : '✗'} {testResult.message}
          </span>
        )}
      </div>

      {/* Aktivieren + Speichern */}
      <div className="flex items-center justify-between border-t pt-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setEnabled(e.target.checked)}
            className="rounded"
            disabled={isRunning}
          />
          <span className="text-sm text-gray-700">Automatischer Import alle 3 Tage</span>
        </label>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || isRunning || !username}
            className="btn-primary text-sm"
          >
            {saving ? 'Speichern…' : 'Speichern'}
          </button>
          <button
            onClick={handleSync}
            disabled={isRunning || !username}
            className="btn-secondary text-sm"
          >
            Jetzt importieren
          </button>
        </div>
      </div>

      {/* Fortschrittsanzeige */}
      {syncProgress && (
        <div className="border-t pt-3 space-y-2">
          {isRunning && (
            <>
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  {syncProgress.current_meter && syncProgress.total_meters
                    ? `Zähler ${syncProgress.current_meter} / ${syncProgress.total_meters}${syncProgress.meter_name ? ` – ${syncProgress.meter_name}` : ''}`
                    : syncProgress.phase === 'login' ? 'SPIE-Login…' : 'Import wird vorbereitet…'}
                </span>
                <span>
                  {syncProgress.current_meter && syncProgress.total_meters
                    ? `${Math.round(syncProgress.current_meter / syncProgress.total_meters * 100)}%`
                    : '…'}
                </span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className="h-2 rounded-full bg-primary-500 transition-all duration-500"
                  style={{
                    width: syncProgress.total_meters
                      ? `${Math.round((syncProgress.current_meter ?? 0) / syncProgress.total_meters * 100)}%`
                      : '30%',
                  }}
                />
              </div>
            </>
          )}
          {isDone && (
            <div className="flex items-center gap-2 text-sm text-green-700">
              <span>✓</span>
              <span>
                Import abgeschlossen –{' '}
                {syncProgress.imported?.toLocaleString('de-DE')} neue Werte importiert
                {syncProgress.errors ? `, ${syncProgress.errors} Fehler` : ''}
              </span>
              <button onClick={() => setSyncProgress(null)} className="ml-auto text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
          {isError && (
            <div className="flex items-center gap-2 text-sm text-red-600">
              <span>✗</span>
              <span>{syncProgress.error}</span>
              <button onClick={() => setSyncProgress(null)} className="ml-auto text-xs text-gray-400 hover:text-gray-600">✕</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-Komponenten ──

function StepIndicator({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? 'bg-primary-100 text-primary-700'
          : done
            ? 'bg-green-100 text-green-700'
            : 'bg-gray-100 text-gray-500'
      }`}
    >
      {done ? '✓ ' : ''}{label}
    </span>
  );
}

function StatBox({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border bg-gray-50 p-3 text-center">
      <div className={`text-2xl font-bold ${color || 'text-gray-900'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-green-100 text-green-700',
    processing: 'bg-blue-100 text-blue-700',
    failed: 'bg-red-100 text-red-700',
    reverted: 'bg-yellow-100 text-yellow-700',
    uploaded: 'bg-gray-100 text-gray-600',
  };
  const labels: Record<string, string> = {
    completed: 'Abgeschlossen',
    processing: 'In Bearbeitung',
    failed: 'Fehlgeschlagen',
    reverted: 'Rückgängig',
    uploaded: 'Hochgeladen',
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-600'}`}>
      {labels[status] || status}
    </span>
  );
}

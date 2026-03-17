import { useEffect, useState, useCallback, useRef } from 'react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType, type PaginatedResponse } from '@/types';

// ── Typen ──

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
}

interface UploadResult {
  batch_id: string;
  filename: string;
  detected_columns: string[];
  preview_rows: Record<string, string>[];
  row_count: number;
}

interface ImportResult {
  batch_id: string;
  status: string;
  total_rows: number;
  imported_count: number;
  skipped_count: number;
  error_count: number;
  errors: Array<{ row?: number; error?: string }>;
}

interface MappingProfile {
  id: string;
  name: string;
  column_mapping: Record<string, string>;
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

  // Mapping
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [dateFormat, setDateFormat] = useState('');
  const [decimalSeparator, setDecimalSeparator] = useState(',');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [profileName, setProfileName] = useState('');
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);

  // Result
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // History
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

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

      // Auto-Mapping versuchen
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
  };

  // ── Schritt 2: Mapping bestätigen & Import ──

  const handleProcess = async () => {
    setMappingError(null);

    // Validierung: timestamp und value müssen zugeordnet sein
    const mapped = Object.values(columnMapping);
    if (!mapped.includes('timestamp')) {
      setMappingError('Bitte ordnen Sie eine Spalte als "Zeitstempel" zu.');
      return;
    }
    if (!mapped.includes('value')) {
      setMappingError('Bitte ordnen Sie eine Spalte als "Zählerstand" zu.');
      return;
    }

    // Wenn kein meter_id in Mapping → muss ein Zähler ausgewählt sein
    if (!mapped.includes('meter_id') && !selectedMeterId) {
      setMappingError('Bitte wählen Sie einen Zähler aus oder ordnen Sie eine meter_id-Spalte zu.');
      return;
    }

    setProcessing(true);

    // Column-Mapping für API: Quellspalte → Zielspalte
    const finalMapping = { ...columnMapping };

    // Wenn kein meter_id im Mapping, als festen Wert setzen
    if (!mapped.includes('meter_id') && selectedMeterId) {
      finalMapping['__meter_id__'] = selectedMeterId;
    }

    try {
      const res = await apiClient.post<ImportResult>('/api/v1/imports/process', {
        batch_id: uploadResult!.batch_id,
        column_mapping: finalMapping,
        date_format: dateFormat || null,
        decimal_separator: decimalSeparator,
        skip_duplicates: skipDuplicates,
        save_as_profile: profileName || null,
      });
      setImportResult(res.data);
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
          )}

          {/* ── Schritt 2: Mapping ── */}
          {step === 'mapping' && uploadResult && (
            <div className="space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h2 className="text-base font-semibold">Spaltenzuordnung</h2>
                    <p className="text-sm text-gray-500">
                      {uploadResult.filename} – {uploadResult.row_count} Zeilen erkannt, {uploadResult.detected_columns.length} Spalten
                    </p>
                  </div>
                  <button onClick={handleReset} className="btn-secondary text-sm">
                    Andere Datei
                  </button>
                </div>

                {mappingError && (
                  <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{mappingError}</div>
                )}

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

                {/* Zähler-Auswahl (wenn keine meter_id-Spalte) */}
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
                        {uploadResult.detected_columns.map((col) => (
                          <th key={col} className="px-3 py-2 text-left whitespace-nowrap">
                            {col}
                            {columnMapping[col] && (
                              <span className="ml-1 text-primary-600">
                                ({TARGET_COLUMNS[columnMapping[col]]})
                              </span>
                            )}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {uploadResult.preview_rows.map((row, idx) => (
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
                  {processing ? 'Importiere...' : `${uploadResult.row_count} Zeilen importieren`}
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
      {done ? '\u2713 ' : ''}{label}
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

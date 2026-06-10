import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, RefreshCw, Building2, Palette, FileText, Activity, Bell, Monitor, Download, CheckCircle, AlertTriangle, XCircle, Plug2, HeartPulse, Database, Server, Clock, HardDrive, Play, RotateCcw, Wifi, ScrollText, Trash2, Upload, ShieldCheck, ChevronDown, Check } from 'lucide-react';
import { apiClient, setBackupRunning } from '@/utils/api';
import { useAppDispatch } from '@/hooks/useRedux';
import { logout } from '@/store/slices/authSlice';
import { setBackupLocked } from '@/store/slices/uiSlice';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';

interface SettingEntry {
  value: Record<string, unknown>;
  description?: string;
  category?: string;
}

type AllSettings = Record<string, SettingEntry>;

const TABS = [
  { id: 'status', label: 'Status', icon: HeartPulse },
  { id: 'organization', label: 'Organisation', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'report_defaults', label: 'Berichte', icon: FileText },
  { id: 'enpi_config', label: 'EnPI', icon: Activity },
  { id: 'notifications', label: 'Benachrichtigungen', icon: Bell },
  { id: 'integrations', label: 'Integrationen', icon: Plug2 },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'logs', label: 'Log', icon: ScrollText },
  { id: 'backup', label: 'Datensicherung', icon: ShieldCheck },
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<AllSettings>({});
  const [activeTab, setActiveTab] = useState('status');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get('/api/v1/settings');
      setSettings(res.data);
      // Aktiven Tab initialisieren
      if (res.data[activeTab]) {
        setEditValues(res.data[activeTab].value || {});
      }
    } catch {
      console.error('Einstellungen konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadSettings();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (settings[activeTab]) {
      setEditValues(settings[activeTab].value || {});
    }
  }, [activeTab, settings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiClient.put(`/api/v1/settings/${activeTab}`, {
        value: editValues,
      });
      // Settings lokal aktualisieren
      setSettings((prev) => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], value: editValues },
      }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      console.error('Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  const updateField = (key: string, value: unknown) => {
    setEditValues((prev) => ({ ...prev, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  const saveable = !['system', 'integrations', 'status', 'logs', 'backup'].includes(activeTab);

  return (
    <div className="einstellungen">
      <PageHead
        eyebrow="System"
        title="Einstellungen"
        actions={
          saveable ? (
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              {saving ? 'Speichern…' : saved ? 'Gespeichert!' : 'Speichern'}
            </button>
          ) : undefined
        }
      />

      <div className="set-body">
        {/* Rail-Navigation */}
        <nav className="set-rail">
          {RAIL_GROUPS.map((grp) => (
            <div className="rail-group" key={grp.label}>
              <div className="rail-glabel">{grp.label}</div>
              {grp.items.map((id) => {
                const tab = TABS.find((t) => t.id === id)!;
                const Icon = tab.icon;
                return (
                  <button key={id} className={`rail-item${activeTab === id ? ' on' : ''}`} onClick={() => setActiveTab(id)}>
                    <span className="rail-ico"><Icon size={15} /></span>
                    <span className="rail-text">
                      <span className="rail-label">{tab.label}</span>
                      <span className="rail-desc">{RAIL_DESC[id]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Panel */}
        <div className="set-panel">
          {activeTab === 'status' && <StatusPanel />}
          {activeTab === 'organization' && <OrganizationForm values={editValues} onChange={updateField} />}
          {activeTab === 'branding' && <BrandingForm values={editValues} onChange={updateField} />}
          {activeTab === 'report_defaults' && <ReportForm values={editValues} onChange={updateField} />}
          {activeTab === 'enpi_config' && <EnPIForm values={editValues} onChange={updateField} />}
          {activeTab === 'notifications' && <NotificationsForm values={editValues} onChange={updateField} />}
          {activeTab === 'integrations' && <IntegrationsPanel />}
          {activeTab === 'system' && <SystemPanel />}
          {activeTab === 'logs' && <LogPanel />}
          {activeTab === 'backup' && <BackupPanel />}
        </div>
      </div>
    </div>
  );
}

// Rail-Gruppen (4) + Item-Beschreibungen (aus dem Design)
const RAIL_GROUPS: { label: string; items: string[] }[] = [
  { label: 'Allgemein', items: ['organization', 'branding', 'report_defaults'] },
  { label: 'Energiemanagement', items: ['enpi_config', 'notifications'] },
  { label: 'Daten & Geräte', items: ['integrations'] },
  { label: 'System & Wartung', items: ['status', 'system', 'logs', 'backup'] },
];
const RAIL_DESC: Record<string, string> = {
  organization: 'Stammdaten für Berichte & ISO-Dokumente',
  branding: 'Farben & Logo',
  report_defaults: 'Standardwerte der Berichtsgenerierung',
  enpi_config: 'Energieleistungskennzahlen & Referenz',
  notifications: 'E-Mail, Fristen & Audit-Erinnerungen',
  integrations: 'Home Assistant, Wetter, MQTT, BACnet …',
  status: 'Live-Zustand der Hintergrunddienste',
  system: 'Version & Updates',
  logs: 'Fehler & Warnungen der Sitzung',
  backup: 'Backup, Wiederherstellung, Reset',
};

/* ── Backup-Panel (Export / Import) ── */

interface BackupProgress {
  status: 'running' | 'done' | 'error';
  phase: string;
  percent?: number;
  size_kb?: number;
  error?: string;
}

function ProgressBar({ progress }: { progress: BackupProgress }) {
  const isError = progress.status === 'error';
  const isDone = progress.status === 'done';

  const phaseLabel: Record<string, string> = {
    export: 'Datenbank wird gesichert…',
    prepare: 'TimescaleDB wird vorbereitet…',
    import: 'Daten werden wiederhergestellt…',
    finalize: 'TimescaleDB wird finalisiert…',
  };

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-gray-500">
        <span>
          {isError ? 'Fehler'
            : isDone ? 'Abgeschlossen'
            : phaseLabel[progress.phase] ?? `${progress.phase}…`}
        </span>
        <span>{isDone ? '100' : isError ? '' : '…'}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2.5">
        <div
          className={`h-2.5 rounded-full transition-all duration-300 ${
            isError ? 'bg-red-500' : isDone ? 'bg-green-500' : 'bg-primary-500 animate-pulse'
          }`}
          style={{ width: isDone ? '100%' : isError ? '100%' : '60%' }}
        />
      </div>
      {isError && <p className="text-xs text-red-600">{progress.error}</p>}
    </div>
  );
}

const LS_EXPORT_JOB = 'backup_export_job_id';
const LS_IMPORT_JOB = 'backup_import_job_id';

function BackupPanel() {
  const dispatch = useAppDispatch();
  const [exportProgress, setExportProgress] = useState<BackupProgress | null>(null);
  const [importProgress, setImportProgress] = useState<BackupProgress | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const importPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const lock = () => { dispatch(setBackupLocked(true)); setBackupRunning(true); };
  const unlock = () => { dispatch(setBackupLocked(false)); setBackupRunning(false); };

  const startPoll = (
    jobId: string,
    setter: (p: BackupProgress) => void,
    pollRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
    lsKey: string,
    onDone?: (p: BackupProgress) => void,
  ) => {
    localStorage.setItem(lsKey, jobId);
    lock();
    pollRef.current = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/v1/backup/progress/${jobId}`);
        const p: BackupProgress = res.data;
        setter(p);
        if (p.status === 'done' || p.status === 'error') {
          if (pollRef.current) clearInterval(pollRef.current);
          localStorage.removeItem(lsKey);
          unlock();
          if (p.status === 'done' && onDone) onDone(p);
        }
      } catch {
        // 404 = Job unbekannt (Backend neugestartet, Status-Datei noch nicht da)
        // → weiter pollen bis Datei erscheint oder Timeout
      }
    }, 2000);
  };

  // Beim Mounten: laufende Jobs aus localStorage wiederherstellen
  useEffect(() => {
    const exportJobId = localStorage.getItem(LS_EXPORT_JOB);
    if (exportJobId) {
      setExportProgress({ status: 'running', phase: 'export' });
      startPoll(exportJobId, setExportProgress, exportPollRef, LS_EXPORT_JOB, async (_p) => {
        const dl = await apiClient.get(`/api/v1/backup/download/${exportJobId}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([dl.data]));
        const a = document.createElement('a');
        const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = url;
        a.download = `energy_backup_${now}.dump`;
        a.click();
        window.URL.revokeObjectURL(url);
      });
    }
    const importJobId = localStorage.getItem(LS_IMPORT_JOB);
    if (importJobId) {
      setImportProgress({ status: 'running', phase: 'import' });
      startPoll(importJobId, setImportProgress, importPollRef, LS_IMPORT_JOB, undefined);
    }
    return () => {
      if (exportPollRef.current) clearInterval(exportPollRef.current);
      if (importPollRef.current) clearInterval(importPollRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExport = async () => {
    setError(null);
    setExportProgress({ status: 'running', phase: 'export' });
    try {
      const res = await apiClient.post('/api/v1/backup/export/start');
      const { job_id } = res.data;
      startPoll(job_id, setExportProgress, exportPollRef, LS_EXPORT_JOB, async () => {
        const dl = await apiClient.get(`/api/v1/backup/download/${job_id}`, { responseType: 'blob' });
        const url = window.URL.createObjectURL(new Blob([dl.data]));
        const a = document.createElement('a');
        const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        a.href = url;
        a.download = `energy_backup_${now}.dump`;
        a.click();
        window.URL.revokeObjectURL(url);
      });
    } catch {
      setError('Export konnte nicht gestartet werden.');
      setExportProgress(null);
      unlock();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportProgress(null);
    setError(null);
  };

  const handleImport = async () => {
    if (!importFile) return;
    setError(null);
    setImportProgress({ status: 'running', phase: 'prepare' });
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await apiClient.post('/api/v1/backup/import/start', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const { job_id } = res.data;
      startPoll(job_id, setImportProgress, importPollRef, LS_IMPORT_JOB);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Import konnte nicht gestartet werden.');
      setImportProgress(null);
      unlock();
    }
  };

  const exportRunning = exportProgress?.status === 'running';
  const importRunning = importProgress?.status === 'running';
  const importDone = importProgress?.status === 'done';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Datensicherung</h2>
        <p className="text-sm text-gray-500">
          Vollständige PostgreSQL-Datenbanksicherung via pg_dump. Die Datei kann auf demselben
          oder einem anderen System wiederhergestellt werden.
        </p>
      </div>

      {/* Export */}
      <div className="border border-gray-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Download className="w-5 h-5 text-primary-600" />
          <h3 className="font-medium text-gray-800">Datenbank exportieren</h3>
        </div>
        <p className="text-sm text-gray-500">
          Erstellt eine vollständige Sicherung aller Tabellen (pg_dump Custom-Format, <code>.dump</code>).
          Enthält alle Zähler, Messwerte, Einstellungen, ISO 50001-Daten und Benutzer.
        </p>
        {exportProgress ? (
          <div className="space-y-3">
            <ProgressBar progress={exportProgress} />
            {exportProgress.status === 'done' && (
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle className="w-4 h-4" />
                Export abgeschlossen – Download wird gestartet ({exportProgress.size_kb?.toLocaleString('de-DE')} KB)
              </div>
            )}
            {exportProgress.status !== 'running' && (
              <button onClick={() => setExportProgress(null)} className="btn-secondary text-sm">
                Neuer Export
              </button>
            )}
          </div>
        ) : (
          <button onClick={handleExport} disabled={exportRunning} className="btn-primary flex items-center gap-2">
            <Download className="w-4 h-4" /> Backup herunterladen
          </button>
        )}
      </div>

      {/* Import */}
      <div className="border border-gray-200 rounded-lg p-5 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Upload className="w-5 h-5 text-primary-600" />
          <h3 className="font-medium text-gray-800">Datenbank importieren</h3>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800">
            <strong>Achtung:</strong> Beim Import werden alle bestehenden Daten überschrieben.
            Erstelle zuerst ein Backup des aktuellen Systems.
          </p>
        </div>

        {/* Datei wählen */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".dump"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importRunning}
            className="btn-secondary flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {importFile ? importFile.name : 'Backup-Datei auswählen (.dump)'}
          </button>
        </div>

        {importFile && !importProgress && (
          <div className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" />
            <span>{importFile.name} ({(importFile.size / 1024 / 1024).toFixed(1)} MB) – bereit zum Importieren</span>
          </div>
        )}

        {/* Fortschrittsbalken Import */}
        {importProgress && <ProgressBar progress={importProgress} />}

        {/* Import-Button */}
        {importFile && !importProgress && (
          <button
            onClick={handleImport}
            disabled={importRunning}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <Upload className="w-4 h-4" /> Jetzt importieren (Daten überschreiben)
          </button>
        )}

        {/* Import-Ergebnis */}
        {importDone && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">Import erfolgreich abgeschlossen</span>
            </div>
          </div>
        )}
      </div>

      {/* Fehler */}
      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
          <XCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Werksreset */}
      <FactoryResetSection />
    </div>
  );
}

/* ── Werksreset-Sektion ── */
function FactoryResetSection() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [showDialog, setShowDialog] = useState(false);
  const [password, setPassword] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const handleReset = async () => {
    setResetting(true);
    setResetError(null);
    try {
      await apiClient.post('/api/v1/backup/factory-reset', { password });
      // Ausloggen und Ersteinrichtung starten
      dispatch(logout());
      navigate('/setup');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setResetError(msg || 'Werksreset fehlgeschlagen.');
      setResetting(false);
    }
  };

  return (
    <>
      <div className="border border-red-200 rounded-lg p-5 space-y-3 bg-red-50">
        <div className="flex items-center gap-2 mb-1">
          <Trash2 className="w-5 h-5 text-red-600" />
          <h3 className="font-medium text-red-800">Werkseinstellungen wiederherstellen</h3>
        </div>
        <p className="text-sm text-red-700">
          Löscht alle Benutzer, Messdaten, Zähler, Standorte, Berichte, ISO-Daten und Einstellungen.
          Rollen, Berechtigungen, Emissionsfaktoren und Wetterstationen bleiben erhalten.
          Danach startet die Ersteinrichtung automatisch.
        </p>
        <button
          onClick={() => { setShowDialog(true); setResetError(null); setPassword(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Auf Werkseinstellungen zurücksetzen…
        </button>
      </div>

      {/* Bestätigungs-Dialog */}
      {showDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6 space-y-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 text-red-600 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Werksreset bestätigen</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Diese Aktion löscht unwiderruflich alle Benutzer- und Messdaten.
                  Stelle sicher, dass du vorher ein Backup erstellt hast.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="label">Administratorpasswort zur Bestätigung</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && password && handleReset()}
                placeholder="Passwort eingeben…"
                className="input w-full"
                autoFocus
              />
            </div>

            {resetError && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-3">
                <XCircle className="w-4 h-4 shrink-0" />
                {resetError}
              </div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDialog(false); setPassword(''); setResetError(null); }}
                className="btn-secondary"
                disabled={resetting}
              >
                Abbrechen
              </button>
              <button
                onClick={handleReset}
                disabled={!password || resetting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {resetting
                  ? <><RefreshCw className="w-4 h-4 animate-spin" /> Wird zurückgesetzt…</>
                  : <><Trash2 className="w-4 h-4" /> Jetzt zurücksetzen</>
                }
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ── Status-Panel (Dienste-Übersicht mit Ampelsystem) ── */

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'error' | 'warning' | 'unknown' | 'not_configured';
  latency_ms?: number;
  error?: string;
  details?: Record<string, unknown>;
}

interface SystemInfo {
  hostname: string;
  platform: string;
  python: string;
  deployment_mode: string;
  version: string;
  uptime_seconds: number | null;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_free_gb: number;
  disk_usage_percent: number;
}

interface SystemStatusResponse {
  overall: 'healthy' | 'warning' | 'error';
  services: ServiceStatus[];
  system: SystemInfo;
  timestamp: string;
}

function formatUptime(seconds: number | null): string {
  if (!seconds) return '–';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const SERVICE_ICONS: Record<string, typeof Database> = {
  'PostgreSQL / TimescaleDB': Database,
  'Redis': Server,
  'Celery Worker': Activity,
  'Celery Beat (Scheduler)': Clock,
  'Home Assistant': Wifi,
};

function StatusPanel() {
  const [data, setData] = useState<SystemStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [restarting, setRestarting] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadStatus = useCallback(async (showSpinner = true) => {
    try {
      if (showSpinner) setRefreshing(true);
      const res = await apiClient.get('/api/v1/system/status');
      setData(res.data);
      setLastRefresh(new Date());
    } catch {
      console.error('Systemstatus konnte nicht geladen werden');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatus(false);
    // Auto-Refresh alle 30 Sekunden
    const interval = setInterval(() => loadStatus(false), 30000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  const restartService = async (serviceName: string) => {
    try {
      setRestarting(serviceName);
      await apiClient.post(`/api/v1/system/services/${serviceName}/restart`);
      // Nach 3 Sekunden Status aktualisieren
      setTimeout(() => loadStatus(true), 3000);
    } catch {
      console.error('Neustart fehlgeschlagen');
    } finally {
      setRestarting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw className="w-6 h-6 animate-spin text-primary-500" />
      </div>
    );
  }

  if (!data) {
    return <p className="text-gray-500">Status konnte nicht geladen werden.</p>;
  }

  const isOk = data.overall === 'healthy';
  const DETAIL_LABELS: Record<string, string> = {
    version: 'Version', timescaledb: 'TimescaleDB', database_size: 'Größe', tables: 'Tabellen',
    active_connections: 'Verbindungen', memory_used: 'Speicher', pending_tasks: 'Wart. Tasks',
    worker_count: 'Worker', minutes_ago: 'Letzter Task', base_url: 'URL',
  };

  return (
    <div className="intg-stack">
      {/* Gesamtstatus-Banner */}
      <div className={`status-banner ${isOk ? 'ok' : 'degraded'}`}>
        <div className="sb-left"><span className="sb-dot" />{isOk ? 'Alle Systeme betriebsbereit' : data.overall === 'warning' ? 'Eingeschränkt' : 'Störung'}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {lastRefresh && <span className="sb-time">Aktualisiert {lastRefresh.toLocaleTimeString('de-DE')}</span>}
          <button className="sbtn-ghost sm" onClick={() => loadStatus(true)} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Aktualisieren
          </button>
        </div>
      </div>

      {/* Dienste */}
      <SetCard title="Hintergrunddienste">
        <div className="svc-list">
          {data.services.map((service) => {
            const ServiceIcon = SERVICE_ICONS[service.name] || Server;
            const running = service.status === 'running';
            const stopped = service.status === 'stopped' || service.status === 'error';
            const canRestart = service.name === 'Celery Worker' || service.name === 'Celery Beat (Scheduler)';
            const restartKey = service.name === 'Celery Worker' ? 'celery_worker' : 'celery_beat';
            return (
              <div key={service.name} className={`svc-row${running ? ' running' : stopped ? ' stopped' : ''}`}>
                <span className="svc-ico"><ServiceIcon size={18} /></span>
                <div className="svc-main">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span className="svc-name">{service.name}</span>
                    <span className={`svc-state${running ? ' running' : stopped ? ' stopped' : ''}`}><span className="dot" />{running ? 'Läuft' : stopped ? 'Gestoppt' : service.status}</span>
                    {service.latency_ms != null && <span className="svc-lat">{service.latency_ms} ms</span>}
                  </div>
                  {service.details && (
                    <div className="svc-meta">
                      {Object.entries(service.details)
                        .filter(([k]) => k !== 'workers' && k !== 'last_task_execution')
                        .map(([k, v]) => (
                          <span key={k}><i>{DETAIL_LABELS[k] || k}:</i> {k === 'minutes_ago' ? `vor ${v} Min.` : String(v)}</span>
                        ))}
                    </div>
                  )}
                  {service.error && <p style={{ marginTop: 4, fontSize: 11.5, color: 'var(--alert)' }}>{service.error}</p>}
                </div>
                {canRestart && (
                  <button className={stopped ? 'sbtn-primary' : 'sbtn-ghost sm'} onClick={() => restartService(restartKey)} disabled={restarting === restartKey} style={{ flexShrink: 0 }}>
                    {restarting === restartKey ? <RotateCcw size={13} className="animate-spin" /> : <Play size={13} />}
                    {stopped ? (restarting === restartKey ? 'Startet…' : 'Starten') : 'Neustart'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </SetCard>

      {/* System-Ressourcen */}
      <SetCard title="System-Ressourcen">
        <div className="res-grid">
          <div className="res-card"><div className="res-label"><Server size={13} /> Hostname</div><div className="res-value sm">{data.system.hostname}</div></div>
          <div className="res-card"><div className="res-label"><Clock size={13} /> Uptime</div><div className="res-value sm">{formatUptime(data.system.uptime_seconds)}</div></div>
          <div className="res-card">
            <div className="res-label"><HardDrive size={13} /> Festplatte</div>
            <div className="res-value sm">{data.system.disk_used_gb} / {data.system.disk_total_gb} GB</div>
            <div className="res-bar"><span style={{ width: `${data.system.disk_usage_percent}%` }} /></div>
            <div className="res-foot">{data.system.disk_free_gb} GB frei ({data.system.disk_usage_percent}% belegt)</div>
          </div>
          <div className="res-card"><div className="res-label"><Monitor size={13} /> Version</div><div className="res-value sm">v{data.system.version}</div><div className="res-foot">Python {data.system.python}</div></div>
        </div>
      </SetCard>
    </div>
  );
}

/* ── Kompat-Wrapper (von IntegrationsPanel u. a. genutzt) ── */

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

/* ── Design-Primitive (analog settings-ui.jsx) ── */

function SetCard({ title, desc, right, tone, children }: { title: string; desc?: string; right?: React.ReactNode; tone?: 'danger'; children: React.ReactNode }) {
  return (
    <section className={`set-card${tone === 'danger' ? ' tone-danger' : ''}`}>
      <div className="set-card-head">
        <div>
          <h3 className="set-card-title">{title}</h3>
          {desc && <p className="set-card-desc">{desc}</p>}
        </div>
        {right && <div className="set-card-right">{right}</div>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, full, required, children }: { label: string; hint?: string; full?: boolean; required?: boolean; children: React.ReactNode }) {
  return (
    <div className={`field${full ? ' full' : ''}`}>
      <label className="field-label">{label}{required && <span className="req">*</span>}</label>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function SInput({ value, onChange, placeholder, mono, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; type?: string }) {
  return <input className={`sinp${mono ? ' mono' : ''}`} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}

function NumberInput({ value, onChange, min, max, suffix }: { value: number; onChange: (v: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <div className="num-wrap">
      <input className="sinp mono" type="number" min={min} max={max} value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </div>
  );
}

function SelectInput({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="sel-wrap">
      <select className="ssel" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
      <span className="sel-caret"><ChevronDown size={14} /></span>
    </div>
  );
}

function Toggle({ checked, onChange, label, desc }: { checked: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div className={`tog-row${checked ? ' on' : ''}`} onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <div className="tog-text"><span className="tog-label">{label}</span>{desc && <span className="tog-desc">{desc}</span>}</div>
      <div className="tog-switch"><div className="tog-knob" /></div>
    </div>
  );
}

function CheckRow({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub?: string }) {
  return (
    <div className={`chkrow${checked ? ' on' : ''}`} onClick={() => onChange(!checked)} role="checkbox" aria-checked={checked}>
      <span className="chkbox">{checked && <Check size={12} />}</span>
      <span className="chk-text">{label}{sub && <span className="chk-sub">{sub}</span>}</span>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <div className="color-row">
        <span className="color-swatch" style={{ background: value || 'var(--ink)' }}>
          <input type="color" value={value || '#1B5E7B'} onChange={(e) => onChange(e.target.value)} />
        </span>
        <input className="sinp mono" value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="#1B5E7B" />
      </div>
    </Field>
  );
}

/* ── Konfig-Panels ── */

function OrganizationForm({ values, onChange }: { values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const v = (k: string) => (values[k] as string) || '';
  return (
    <SetCard title="Organisationsdaten" desc="Stammdaten für Berichte und ISO-50001-Dokumente.">
      <div className="form-grid">
        <Field label="Organisationsname"><SInput value={v('name')} onChange={(x) => onChange('name', x)} placeholder="Muster GmbH" /></Field>
        <Field label="Logo-URL"><SInput value={v('logo_url')} onChange={(x) => onChange('logo_url', x)} placeholder="https://…" mono /></Field>
        <Field label="Adresse" full><SInput value={v('address')} onChange={(x) => onChange('address', x)} placeholder="Musterstraße 1, 12345 Musterstadt" /></Field>
        <Field label="E-Mail"><SInput value={v('contact_email')} onChange={(x) => onChange('contact_email', x)} placeholder="energie@firma.de" mono type="email" /></Field>
        <Field label="Telefon"><SInput value={v('contact_phone')} onChange={(x) => onChange('contact_phone', x)} placeholder="+49 123 456789" mono /></Field>
      </div>
    </SetCard>
  );
}

function BrandingForm({ values, onChange }: { values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const v = (k: string) => (values[k] as string) || '';
  return (
    <SetCard title="Farben für UI &amp; Berichte" desc="Primär-, Sekundär- und Akzentfarbe für Oberfläche und PDF-Berichte.">
      <div className="form-grid c3">
        <ColorField label="Primärfarbe" value={v('primary_color')} onChange={(x) => onChange('primary_color', x)} />
        <ColorField label="Sekundärfarbe" value={v('secondary_color')} onChange={(x) => onChange('secondary_color', x)} />
        <ColorField label="Akzentfarbe" value={v('accent_color')} onChange={(x) => onChange('accent_color', x)} />
      </div>
      <div className="brand-preview">
        <div className="bp-label">Vorschau</div>
        <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
          {[['Primär', v('primary_color') || '#1B5E7B'], ['Sekundär', v('secondary_color') || '#2D8EB9'], ['Akzent', v('accent_color') || '#E89A3C']].map(([l, c]) => (
            <div key={l} style={{ width: 96, height: 40, borderRadius: 8, background: c, color: '#fff', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 500 }}>{l}</div>
          ))}
        </div>
      </div>
    </SetCard>
  );
}

function ReportForm({ values, onChange }: { values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  return (
    <SetCard title="Standardeinstellungen für Berichtsgenerierung" desc="Vorgaben für neue Berichte.">
      <div className="form-grid">
        <Field label="Firmenname im Bericht"><SInput value={(values.company_name as string) || ''} onChange={(x) => onChange('company_name', x)} /></Field>
        <Field label="Berichtssprache">
          <SelectInput value={(values.report_language as string) || 'de'} onChange={(x) => onChange('report_language', x)}>
            <option value="de">Deutsch</option><option value="en">Englisch</option>
          </SelectInput>
        </Field>
        <Field label="Standard-Berichtszeitraum">
          <NumberInput value={(values.default_period_months as number) || 12} onChange={(x) => onChange('default_period_months', x)} min={1} max={36} suffix="Monate" />
        </Field>
        <div className="field full"><div className="check-stack">
          <CheckRow checked={Boolean(values.include_logo)} onChange={(x) => onChange('include_logo', x)} label="Logo im Bericht anzeigen" />
          <CheckRow checked={Boolean(values.include_weather_correction)} onChange={(x) => onChange('include_weather_correction', x)} label="Witterungskorrektur einbeziehen" />
          <CheckRow checked={Boolean(values.include_co2)} onChange={(x) => onChange('include_co2', x)} label="CO₂-Bilanz einbeziehen" />
        </div></div>
      </div>
    </SetCard>
  );
}

function EnPIForm({ values, onChange }: { values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const allMetrics = [
    { id: 'kwh_per_m2', label: 'kWh/m²', sub: 'Flächenbezogen' },
    { id: 'kwh_per_person', label: 'kWh/Mitarbeiter', sub: 'Personenbezogen' },
    { id: 'kwh_per_unit', label: 'kWh/Produktionseinheit', sub: 'Produktionsbezogen' },
    { id: 'co2_per_m2', label: 'kg CO₂/m²', sub: 'Emissionsintensität' },
  ];
  const selected = (values.metrics as string[]) || [];
  const toggle = (id: string) => onChange('metrics', selected.includes(id) ? selected.filter((m) => m !== id) : [...selected, id]);
  return (
    <SetCard title="EnPI-Kennzahlen-Konfiguration" desc="Aktive Energieleistungskennzahlen und Referenz-Standard.">
      <Field label="Aktive Kennzahlen">
        <div className="kpi-grid">
          {allMetrics.map((m) => <CheckRow key={m.id} checked={selected.includes(m.id)} onChange={() => toggle(m.id)} label={m.label} sub={m.sub} />)}
        </div>
      </Field>
      <div style={{ marginTop: 16 }}>
        <Field label="Referenz-Standard">
          <SelectInput value={(values.reference_standard as string) || 'vdi_3807'} onChange={(x) => onChange('reference_standard', x)}>
            <option value="vdi_3807">VDI 3807</option><option value="din_v_18599">DIN V 18599</option><option value="custom">Eigene Referenzwerte</option>
          </SelectInput>
        </Field>
      </div>
      <div style={{ marginTop: 16 }}>
        <CheckRow checked={Boolean(values.show_reference_values)} onChange={(x) => onChange('show_reference_values', x)} label="Referenzwerte in Benchmarks anzeigen" />
      </div>
    </SetCard>
  );
}

function NotificationsForm({ values, onChange }: { values: Record<string, unknown>; onChange: (k: string, v: unknown) => void }) {
  const enabled = Boolean(values.email_enabled);
  return (
    <SetCard title="Benachrichtigungseinstellungen" desc="Automatische Erinnerungen für ISO-50001-Fristen und Systemereignisse.">
      <Toggle checked={enabled} onChange={(x) => onChange('email_enabled', x)} label="E-Mail-Benachrichtigungen aktivieren" desc="Versand an die in der Organisation hinterlegte Adresse" />
      <div className={`form-grid fade-block${enabled ? '' : ' disabled'}`} style={{ marginTop: 16 }}>
        <Field label="Dokumenten-Überprüfung – Vorlauf" hint="Erinnerung vor Ablauf der Dokumentenprüfung">
          <NumberInput value={(values.review_reminder_days as number) || 30} onChange={(x) => onChange('review_reminder_days', x)} min={1} max={180} suffix="Tage" />
        </Field>
        <Field label="Audit-Erinnerung – Vorlauf" hint="Erinnerung vor dem nächsten internen Audit">
          <NumberInput value={(values.audit_reminder_days as number) || 14} onChange={(x) => onChange('audit_reminder_days', x)} min={1} max={180} suffix="Tage" />
        </Field>
      </div>
    </SetCard>
  );
}

/* ── System-Panel (Version + Updates) ── */

interface VersionInfo {
  current_version: string;
  deployment_mode: string;
  app_name: string;
}

interface UpdateCheck {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  deployment_mode: string;
  release_notes: string;
  checked_at: string;
  error?: string;
}

interface UpdateResult {
  success: boolean;
  message: string;
  old_version?: string;
  new_version?: string;
  log?: string;
  restart_required?: boolean;
}

function SystemPanel() {
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<UpdateResult | null>(null);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    loadVersionInfo();
  }, []);

  const loadVersionInfo = async () => {
    try {
      const res = await apiClient.get('/api/v1/system/version');
      setVersionInfo(res.data);
    } catch {
      console.error('Versionsinformationen konnten nicht geladen werden');
    }
  };

  const checkForUpdates = async () => {
    try {
      setChecking(true);
      setInstallResult(null);
      const res = await apiClient.get('/api/v1/system/updates/check');
      setUpdateCheck(res.data);
    } catch {
      console.error('Update-Prüfung fehlgeschlagen');
    } finally {
      setChecking(false);
    }
  };

  const installUpdate = async () => {
    try {
      setInstalling(true);
      const res = await apiClient.post('/api/v1/system/updates/install');
      setInstallResult(res.data);
      if (res.data.success && res.data.restart_required) {
        setTimeout(() => window.location.reload(), 5000);
      }
    } catch {
      setInstallResult({
        success: false,
        message: 'Update-Installation fehlgeschlagen.',
      });
    } finally {
      setInstalling(false);
    }
  };

  const deploymentLabel = versionInfo?.deployment_mode === 'ha-addon'
    ? 'Home Assistant Add-on'
    : 'Standalone';

  return (
    <div className="space-y-6">
      {/* Versionsinformationen */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Systeminformationen</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Version</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">
              {versionInfo?.current_version || '...'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Deployment</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">
              {versionInfo ? deploymentLabel : '...'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Anwendung</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">
              {versionInfo?.app_name || '...'}
            </p>
          </div>
        </div>
      </div>

      {/* Update-Prüfung */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-gray-900">Updates</h3>
          <button
            onClick={checkForUpdates}
            disabled={checking}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Prüfe...' : 'Nach Updates suchen'}
          </button>
        </div>

        {/* Update-Status */}
        {updateCheck && (
          <div className={`rounded-lg border p-4 ${
            updateCheck.error
              ? 'border-red-200 bg-red-50'
              : updateCheck.update_available
              ? 'border-primary-200 bg-primary-50'
              : 'border-green-200 bg-green-50'
          }`}>
            {updateCheck.error ? (
              <div className="flex items-start gap-3">
                <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="font-medium text-red-800">Fehler bei der Update-Prüfung</p>
                  <p className="text-sm text-red-600 mt-1">{updateCheck.error}</p>
                </div>
              </div>
            ) : updateCheck.update_available ? (
              <div>
                <div className="flex items-start gap-3">
                  <Download className="w-5 h-5 text-primary-600 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium text-primary-800">
                      Update verfügbar: v{updateCheck.latest_version}
                    </p>
                    <p className="text-sm text-primary-600 mt-1">
                      Aktuelle Version: v{updateCheck.current_version}
                    </p>
                  </div>
                </div>

                {/* Release-Notes */}
                {updateCheck.release_notes && (
                  <div className="mt-3 ml-8">
                    <p className="text-sm font-medium text-gray-700 mb-1">Letzte Änderungen:</p>
                    <pre className="text-xs text-gray-600 bg-white rounded p-3 border border-gray-200 whitespace-pre-wrap">
                      {updateCheck.release_notes}
                    </pre>
                  </div>
                )}

                {/* Install-Button */}
                {versionInfo?.deployment_mode === 'standalone' ? (
                  <div className="mt-4 ml-8">
                    <button
                      onClick={installUpdate}
                      disabled={installing}
                      className="btn-primary flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      {installing ? 'Update wird installiert...' : 'Update installieren'}
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 ml-8">
                    <p className="text-sm text-amber-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" />
                      Updates werden über den Home Assistant Supervisor verwaltet.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 text-green-500 shrink-0" />
                <div>
                  <p className="font-medium text-green-800">System ist aktuell</p>
                  <p className="text-sm text-green-600">
                    Version v{updateCheck.current_version} ist die neueste Version.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Install-Ergebnis */}
        {installResult && (
          <div className={`mt-4 rounded-lg border p-4 ${
            installResult.success
              ? 'border-green-200 bg-green-50'
              : 'border-red-200 bg-red-50'
          }`}>
            <div className="flex items-start gap-3">
              {installResult.success ? (
                <CheckCircle className="w-5 h-5 text-green-500 mt-0.5 shrink-0" />
              ) : (
                <XCircle className="w-5 h-5 text-red-500 mt-0.5 shrink-0" />
              )}
              <div className="flex-1">
                <p className={`font-medium ${installResult.success ? 'text-green-800' : 'text-red-800'}`}>
                  {installResult.message}
                </p>
                {installResult.success && installResult.restart_required && (
                  <p className="text-sm text-green-600 mt-1">
                    Seite wird in 5 Sekunden neu geladen...
                  </p>
                )}
                {installResult.log && (
                  <div className="mt-2">
                    <button
                      onClick={() => setShowLog(!showLog)}
                      className="text-sm text-gray-600 hover:text-gray-900 underline"
                    >
                      {showLog ? 'Log verbergen' : 'Log anzeigen'}
                    </button>
                    {showLog && (
                      <pre className="mt-2 text-xs text-gray-600 bg-white rounded p-3 border border-gray-200 whitespace-pre-wrap max-h-64 overflow-auto">
                        {installResult.log}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Hinweis wenn noch nicht geprüft */}
        {!updateCheck && !checking && (
          <p className="text-sm text-gray-500">
            Klicken Sie auf "Nach Updates suchen", um zu prüfen ob eine neue Version verfügbar ist.
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Integrationen-Panel ── */

interface IntegrationTestResult {
  success: boolean;
  message: string;
}

interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  friendly_name?: string;
  device_class?: string;
  unit_of_measurement?: string;
}

interface ShellyTestResult {
  connected: boolean;
  error?: string;
  device_info?: {
    model: string;
    firmware: string;
    mac: string;
    gen: number;
    name: string;
  };
  current_energy?: {
    power: number;
    energy_wh: number;
    voltage: number;
    current: number;
  };
}

interface ConnectionTestResult {
  connected: boolean;
  error?: string;
}

interface PollResult {
  polled?: number;
  success?: number;
  errors?: number;
  details?: Array<Record<string, unknown>>;
}

function IntegrationsPanel() {
  const [haConfig, setHaConfig] = useState({ base_url: '', access_token: '', auth_enabled: false, default_role: 'viewer' });
  const [weatherConfig, setWeatherConfig] = useState({ enabled: true, station_id: '', latitude: '', longitude: '' });
  const [co2Config, setCo2Config] = useState({ enabled: false, api_key: '', zone: 'DE' });
  const [dhProviders, setDhProviders] = useState<{ id: string; name: string; city: string; co2_g_per_kwh: number; primary_energy_factor: number | null; certification_year: number }[]>([]);
  const [dhConfig, setDhConfig] = useState<{ provider_id: string; provider_name: string }>({ provider_id: '', provider_name: '' });
  const [dhSearch, setDhSearch] = useState('');
  const [mqttConfig, setMqttConfig] = useState({ enabled: false, broker_host: '', port: 1883, username: '', password: '' });
  const [bacnetConfig, setBacnetConfig] = useState({ enabled: false, interface: '', port: 47808 });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState('');
  const [testResults, setTestResults] = useState<Record<string, IntegrationTestResult | null>>({});
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [stations, setStations] = useState<{ id: string; name: string; dwd_station_id: string }[]>([]);

  // HA Entity-Browser
  const [showEntityBrowser, setShowEntityBrowser] = useState(false);
  const [haEntities, setHaEntities] = useState<HAEntity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [domainFilter, setDomainFilter] = useState('');
  const [entitySearch, setEntitySearch] = useState('');

  // Verbindungstests
  const [deviceTestTab, setDeviceTestTab] = useState<'shelly' | 'modbus' | 'knx'>('shelly');
  const [shellyHost, setShellyHost] = useState('');
  const [shellyTesting, setShellyTesting] = useState(false);
  const [shellyResult, setShellyResult] = useState<ShellyTestResult | null>(null);
  const [modbusHost, setModbusHost] = useState('');
  const [modbusPort, setModbusPort] = useState('502');
  const [modbusUnitId, setModbusUnitId] = useState('1');
  const [modbusRegister, setModbusRegister] = useState('0');
  const [modbusTesting, setModbusTesting] = useState(false);
  const [modbusResult, setModbusResult] = useState<ConnectionTestResult | null>(null);
  const [knxGatewayIp, setKnxGatewayIp] = useState('');
  const [knxPort, setKnxPort] = useState('3671');
  const [knxTesting, setKnxTesting] = useState(false);
  const [knxResult, setKnxResult] = useState<ConnectionTestResult | null>(null);

  // Manuelles Polling
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);

  useEffect(() => {
    // Settings laden
    Promise.all([
      apiClient.get('/api/v1/settings/integrations_ha'),
      apiClient.get('/api/v1/settings/integrations_weather'),
      apiClient.get('/api/v1/settings/integrations_co2'),
      apiClient.get('/api/v1/weather/stations').catch(() => ({ data: [] })),
      apiClient.get('/api/v1/settings/integrations_mqtt').catch(() => ({ data: {} })),
      apiClient.get('/api/v1/settings/integrations_bacnet').catch(() => ({ data: {} })),
    ]).then(([ha, weather, co2, stationsRes, mqtt, bacnet]) => {
      if (ha.data.value) setHaConfig({ ...haConfig, ...ha.data.value });
      if (weather.data.value) setWeatherConfig({ ...weatherConfig, ...weather.data.value });
      if (co2.data.value) setCo2Config({ ...co2Config, ...co2.data.value });
      if (mqtt.data.value) setMqttConfig({ ...mqttConfig, ...mqtt.data.value });
      if (bacnet.data.value) setBacnetConfig({ ...bacnetConfig, ...bacnet.data.value });
      setStations(Array.isArray(stationsRes.data) ? stationsRes.data : []);
    });
    // Fernwärmeversorger laden
    apiClient.get('/api/v1/emissions/district-heating-providers').then((res) => {
      setDhProviders(Array.isArray(res.data) ? res.data : []);
    }).catch(() => {});
    apiClient.get('/api/v1/settings/district_heating_provider').then((res) => {
      if (res.data.value) setDhConfig({ ...dhConfig, ...res.data.value });
    }).catch(() => {});
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const saveSection = async (key: string, value: Record<string, unknown>) => {
    setSaving(true);
    try {
      await apiClient.put(`/api/v1/settings/${key}`, { value });
      setSaved(key);
      setTimeout(() => setSaved(''), 2000);
    } catch { /* leer */ }
    setSaving(false);
  };

  const testConnection = async (type: string) => {
    setTesting((p) => ({ ...p, [type]: true }));
    setTestResults((p) => ({ ...p, [type]: null }));
    try {
      const res = await apiClient.post(`/api/v1/settings/integrations/test/${type}`);
      setTestResults((p) => ({ ...p, [type]: res.data }));
    } catch (err: unknown) {
      setTestResults((p) => ({ ...p, [type]: { success: false, message: 'Verbindungsfehler' } }));
    }
    setTesting((p) => ({ ...p, [type]: false }));
  };

  const StatusBadge = ({ type }: { type: string }) => {
    const result = testResults[type];
    if (!result) return null;
    return (
      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
        result.success ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}>
        {result.success ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
        {result.message}
      </span>
    );
  };

  return (
    <div className="space-y-8">
      {/* Home Assistant */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Home Assistant</h3>
          <div className="flex items-center gap-2">
            <StatusBadge type="ha" />
            <button
              onClick={() => testConnection('ha')}
              disabled={testing.ha}
              className="btn-secondary text-xs px-3 py-1"
            >
              {testing.ha ? 'Teste…' : 'Verbindung testen'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField label="Base-URL">
            <input
              className="input"
              placeholder="http://supervisor/core"
              value={haConfig.base_url}
              onChange={(e) => setHaConfig({ ...haConfig, base_url: e.target.value })}
            />
          </FormField>
          <FormField label="Access Token">
            <input
              className="input"
              type="password"
              placeholder="Long-Lived Access Token"
              value={haConfig.access_token}
              onChange={(e) => setHaConfig({ ...haConfig, access_token: e.target.value })}
            />
          </FormField>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={haConfig.auth_enabled}
                onChange={(e) => setHaConfig({ ...haConfig, auth_enabled: e.target.checked })}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">HA-Authentifizierung aktivieren</span>
            </label>
          </div>
          <FormField label="Standard-Rolle">
            <select
              className="input"
              value={haConfig.default_role}
              onChange={(e) => setHaConfig({ ...haConfig, default_role: e.target.value })}
            >
              <option value="viewer">Betrachter</option>
              <option value="editor">Bearbeiter</option>
              <option value="admin">Administrator</option>
            </select>
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('integrations_ha', haConfig)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'integrations_ha' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>

        {/* Entity-Browser */}
        <div className="mt-4 border-t pt-4">
          <button
            onClick={() => setShowEntityBrowser(!showEntityBrowser)}
            className="text-sm font-medium text-primary-600 hover:text-primary-700"
          >
            {showEntityBrowser ? '▾ Entity-Browser ausblenden' : '▸ Entity-Browser anzeigen'}
          </button>

          {showEntityBrowser && (
            <div className="mt-3">
              <div className="flex gap-3 mb-3">
                <select
                  className="input w-48"
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value)}
                >
                  <option value="">Alle Domains</option>
                  <option value="sensor">sensor</option>
                  <option value="input_number">input_number</option>
                  <option value="climate">climate</option>
                  <option value="switch">switch</option>
                  <option value="binary_sensor">binary_sensor</option>
                </select>
                <input
                  type="text"
                  className="input flex-1"
                  placeholder="Suche nach Entity-ID oder Name…"
                  value={entitySearch}
                  onChange={(e) => setEntitySearch(e.target.value)}
                />
                <button
                  onClick={async () => {
                    setLoadingEntities(true);
                    try {
                      const params = new URLSearchParams();
                      if (domainFilter) params.append('domain', domainFilter);
                      const res = await apiClient.get<{ entities: HAEntity[]; count: number }>(
                        `/api/v1/integrations/ha/entities?${params}`
                      );
                      setHaEntities(res.data.entities);
                    } catch { /* interceptor */ }
                    setLoadingEntities(false);
                  }}
                  className="btn-primary text-sm"
                  disabled={loadingEntities}
                >
                  {loadingEntities ? 'Laden…' : 'Entitäten laden'}
                </button>
              </div>

              {haEntities.length > 0 && (
                <div className="overflow-hidden rounded-lg border">
                  <div className="max-h-96 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 border-b bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-3 py-2 text-left">Entity-ID</th>
                          <th className="px-3 py-2 text-left">Name</th>
                          <th className="px-3 py-2 text-right">Wert</th>
                          <th className="px-3 py-2 text-left">Einheit</th>
                          <th className="px-3 py-2 text-left">Klasse</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {haEntities
                          .filter((e) => {
                            if (!entitySearch) return true;
                            const lower = entitySearch.toLowerCase();
                            return (
                              e.entity_id.toLowerCase().includes(lower) ||
                              (e.friendly_name || '').toLowerCase().includes(lower)
                            );
                          })
                          .map((e) => (
                            <tr key={e.entity_id} className="hover:bg-gray-50">
                              <td className="px-3 py-2 font-mono text-xs">{e.entity_id}</td>
                              <td className="px-3 py-2">{e.friendly_name || '–'}</td>
                              <td className="px-3 py-2 text-right font-mono">{e.state}</td>
                              <td className="px-3 py-2 text-gray-500">{e.unit_of_measurement || '–'}</td>
                              <td className="px-3 py-2 text-gray-500">{e.device_class || '–'}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-500">
                    {haEntities.filter((e) => {
                      if (!entitySearch) return true;
                      const lower = entitySearch.toLowerCase();
                      return e.entity_id.toLowerCase().includes(lower) || (e.friendly_name || '').toLowerCase().includes(lower);
                    }).length} von {haEntities.length} Entitäten
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Wetter (BrightSky) */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Wetter (BrightSky / DWD)</h3>
          <div className="flex items-center gap-2">
            <StatusBadge type="weather" />
            <button
              onClick={() => testConnection('weather')}
              disabled={testing.weather}
              className="btn-secondary text-xs px-3 py-1"
            >
              {testing.weather ? 'Teste…' : 'Verbindung testen'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={weatherConfig.enabled}
                onChange={(e) => setWeatherConfig({ ...weatherConfig, enabled: e.target.checked })}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">Wetterdaten aktivieren</span>
            </label>
          </div>
          <FormField label="DWD-Station">
            <select
              className="input"
              value={weatherConfig.station_id}
              onChange={(e) => setWeatherConfig({ ...weatherConfig, station_id: e.target.value })}
            >
              <option value="">Bitte wählen…</option>
              {stations.map((s) => (
                <option key={s.id} value={s.dwd_station_id}>
                  {s.name} ({s.dwd_station_id})
                </option>
              ))}
            </select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Breitengrad">
              <input
                className="input"
                type="number"
                step="0.001"
                placeholder="51.05"
                value={weatherConfig.latitude || ''}
                onChange={(e) => setWeatherConfig({ ...weatherConfig, latitude: e.target.value })}
              />
            </FormField>
            <FormField label="Längengrad">
              <input
                className="input"
                type="number"
                step="0.001"
                placeholder="13.74"
                value={weatherConfig.longitude || ''}
                onChange={(e) => setWeatherConfig({ ...weatherConfig, longitude: e.target.value })}
              />
            </FormField>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('integrations_weather', weatherConfig)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'integrations_weather' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* CO₂ (Electricity Maps) */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">CO₂-Intensität (Electricity Maps)</h3>
          <div className="flex items-center gap-2">
            <StatusBadge type="co2" />
            <button
              onClick={() => testConnection('co2')}
              disabled={testing.co2}
              className="btn-secondary text-xs px-3 py-1"
            >
              {testing.co2 ? 'Teste…' : 'Verbindung testen'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={co2Config.enabled}
                onChange={(e) => setCo2Config({ ...co2Config, enabled: e.target.checked })}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">CO₂-Intensität aktivieren</span>
            </label>
          </div>
          <FormField label="API-Key">
            <input
              className="input"
              type="password"
              placeholder="Electricity Maps API Key"
              value={co2Config.api_key}
              onChange={(e) => setCo2Config({ ...co2Config, api_key: e.target.value })}
            />
          </FormField>
          <FormField label="Zone">
            <select
              className="input"
              value={co2Config.zone}
              onChange={(e) => setCo2Config({ ...co2Config, zone: e.target.value })}
            >
              <option value="DE">Deutschland (DE)</option>
              <option value="AT">Österreich (AT)</option>
              <option value="CH">Schweiz (CH)</option>
              <option value="FR">Frankreich (FR)</option>
              <option value="NL">Niederlande (NL)</option>
              <option value="PL">Polen (PL)</option>
              <option value="CZ">Tschechien (CZ)</option>
              <option value="DK-DK1">Dänemark West (DK-DK1)</option>
              <option value="DK-DK2">Dänemark Ost (DK-DK2)</option>
            </select>
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('integrations_co2', co2Config)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'integrations_co2' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Fernwärmeversorger */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">Fernwärmeversorger (CO₂-Faktor)</h3>
          {dhConfig.provider_name && (
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
              <CheckCircle className="w-3 h-3" />
              {dhConfig.provider_name}
            </span>
          )}
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Fernwärmeversorger auswählen, um den standortspezifischen CO₂-Emissionsfaktor (FW 309) zu verwenden.
          Ohne Auswahl wird der BAFA-Pauschalwert verwendet.
        </p>
        <div className="space-y-3">
          <FormField label="Versorger suchen">
            <input
              className="input"
              placeholder="Name oder Stadt eingeben…"
              value={dhSearch}
              onChange={(e) => setDhSearch(e.target.value)}
            />
          </FormField>
          <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
            {dhProviders
              .filter((p) => {
                if (!dhSearch) return true;
                const s = dhSearch.toLowerCase();
                return p.name.toLowerCase().includes(s) || p.city.toLowerCase().includes(s);
              })
              .map((provider) => (
                <label
                  key={provider.id}
                  className={`flex items-center justify-between p-3 cursor-pointer hover:bg-gray-50 ${
                    dhConfig.provider_id === provider.id ? 'bg-primary-50 border-l-2 border-primary-500' : ''
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="dh_provider"
                      checked={dhConfig.provider_id === provider.id}
                      onChange={() => setDhConfig({ provider_id: provider.id, provider_name: provider.name })}
                      className="text-primary-500"
                    />
                    <div>
                      <div className="text-sm font-medium text-gray-900">{provider.name}</div>
                      <div className="text-xs text-gray-500">{provider.city}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-primary-700">{provider.co2_g_per_kwh} g CO₂/kWh</div>
                    {provider.primary_energy_factor && (
                      <div className="text-xs text-gray-500">PEF {provider.primary_energy_factor} · {provider.certification_year}</div>
                    )}
                  </div>
                </label>
              ))}
            {dhProviders.length === 0 && (
              <div className="p-4 text-center text-sm text-gray-400">Keine Versorger geladen</div>
            )}
          </div>
          {dhConfig.provider_id && (
            <button
              onClick={() => setDhConfig({ provider_id: '', provider_name: '' })}
              className="text-xs text-gray-500 hover:text-red-600"
            >
              Auswahl aufheben (BAFA-Pauschalwert verwenden)
            </button>
          )}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('district_heating_provider', dhConfig as unknown as Record<string, unknown>)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'district_heating_provider' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* MQTT */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">MQTT</h3>
          <div className="flex items-center gap-2">
            <StatusBadge type="mqtt" />
            <button
              onClick={() => testConnection('mqtt')}
              disabled={testing.mqtt}
              className="btn-secondary text-xs px-3 py-1"
            >
              {testing.mqtt ? 'Teste…' : 'Verbindung testen'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={mqttConfig.enabled}
                onChange={(e) => setMqttConfig({ ...mqttConfig, enabled: e.target.checked })}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">MQTT aktivieren</span>
            </label>
          </div>
          <FormField label="Broker-Host">
            <input
              className="input"
              placeholder="192.168.1.100 oder mqtt.local"
              value={mqttConfig.broker_host}
              onChange={(e) => setMqttConfig({ ...mqttConfig, broker_host: e.target.value })}
            />
          </FormField>
          <FormField label="Port">
            <input
              className="input"
              type="number"
              value={mqttConfig.port}
              onChange={(e) => setMqttConfig({ ...mqttConfig, port: parseInt(e.target.value) || 1883 })}
            />
          </FormField>
          <FormField label="Benutzername">
            <input
              className="input"
              placeholder="optional"
              value={mqttConfig.username}
              onChange={(e) => setMqttConfig({ ...mqttConfig, username: e.target.value })}
            />
          </FormField>
          <FormField label="Passwort">
            <input
              className="input"
              type="password"
              placeholder="optional"
              value={mqttConfig.password}
              onChange={(e) => setMqttConfig({ ...mqttConfig, password: e.target.value })}
            />
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('integrations_mqtt', mqttConfig)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'integrations_mqtt' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* BACnet */}
      <div className="border rounded-lg p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-900">BACnet/IP</h3>
          <div className="flex items-center gap-2">
            <StatusBadge type="bacnet" />
            <button
              onClick={() => testConnection('bacnet')}
              disabled={testing.bacnet}
              className="btn-secondary text-xs px-3 py-1"
            >
              {testing.bacnet ? 'Teste…' : 'Verbindung testen'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={bacnetConfig.enabled}
                onChange={(e) => setBacnetConfig({ ...bacnetConfig, enabled: e.target.checked })}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">BACnet aktivieren</span>
            </label>
          </div>
          <FormField label="Netzwerk-Interface (optional)">
            <input
              className="input"
              placeholder="z.B. 192.168.1.50 oder leer für Auto"
              value={bacnetConfig.interface}
              onChange={(e) => setBacnetConfig({ ...bacnetConfig, interface: e.target.value })}
            />
          </FormField>
          <FormField label="Port">
            <input
              className="input"
              type="number"
              value={bacnetConfig.port}
              onChange={(e) => setBacnetConfig({ ...bacnetConfig, port: parseInt(e.target.value) || 47808 })}
            />
          </FormField>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={() => saveSection('integrations_bacnet', bacnetConfig)}
            disabled={saving}
            className="btn-primary text-sm flex items-center gap-1.5"
          >
            <Save className="w-3.5 h-3.5" />
            {saved === 'integrations_bacnet' ? 'Gespeichert!' : 'Speichern'}
          </button>
        </div>
      </div>

      {/* Verbindungstest – Feldgeräte */}
      <div className="border rounded-lg p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Verbindungstest</h3>
        <p className="text-sm text-gray-500 mb-4">Ad-hoc Verbindungstests für Feldgeräte</p>

        <div className="flex gap-4 mb-4 border-b">
          {(['shelly', 'modbus', 'knx'] as const).map((tab) => (
            <button
              key={tab}
              className={`pb-2 text-sm font-medium ${
                deviceTestTab === tab
                  ? 'border-b-2 border-primary-600 text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setDeviceTestTab(tab)}
            >
              {tab === 'shelly' ? 'Shelly' : tab === 'modbus' ? 'Modbus' : 'KNX'}
            </button>
          ))}
        </div>

        {/* Shelly */}
        {deviceTestTab === 'shelly' && (
          <div>
            <p className="mb-3 text-sm text-gray-500">
              IP-Adresse eines Shelly-Geräts eingeben (Gen1 + Gen2+).
            </p>
            <div className="flex gap-3 mb-4">
              <input
                type="text"
                className="input flex-1 max-w-xs"
                placeholder="z.B. 192.168.1.100"
                value={shellyHost}
                onChange={(e) => setShellyHost(e.target.value)}
              />
              <button
                onClick={async () => {
                  if (!shellyHost) return;
                  setShellyTesting(true);
                  setShellyResult(null);
                  try {
                    const res = await apiClient.post<ShellyTestResult>(
                      `/api/v1/integrations/shelly/test?host=${encodeURIComponent(shellyHost)}`
                    );
                    setShellyResult(res.data);
                  } catch (err: unknown) {
                    const error = err as { response?: { data?: { detail?: string } } };
                    setShellyResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
                  }
                  setShellyTesting(false);
                }}
                className="btn-primary text-sm"
                disabled={shellyTesting || !shellyHost}
              >
                {shellyTesting ? 'Teste…' : 'Verbindung testen'}
              </button>
            </div>
            {shellyResult && (
              <div className={`rounded-lg p-4 ${shellyResult.connected ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${shellyResult.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className={`font-medium ${shellyResult.connected ? 'text-green-700' : 'text-red-700'}`}>
                    {shellyResult.connected ? 'Verbindung erfolgreich' : 'Verbindung fehlgeschlagen'}
                  </span>
                </div>
                {shellyResult.error && <p className="text-sm text-red-600">{shellyResult.error}</p>}
                {shellyResult.device_info && (
                  <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                    <div><span className="text-gray-500">Modell:</span> {shellyResult.device_info.model}</div>
                    <div><span className="text-gray-500">Generation:</span> Gen{shellyResult.device_info.gen}</div>
                    <div><span className="text-gray-500">Name:</span> {shellyResult.device_info.name || '–'}</div>
                    <div><span className="text-gray-500">MAC:</span> {shellyResult.device_info.mac}</div>
                    <div><span className="text-gray-500">Firmware:</span> {shellyResult.device_info.firmware}</div>
                  </div>
                )}
                {shellyResult.current_energy && (
                  <div className="mt-3 grid grid-cols-4 gap-3">
                    {[
                      ['Leistung', `${shellyResult.current_energy.power} W`],
                      ['Energie', `${(shellyResult.current_energy.energy_wh / 1000).toFixed(2)} kWh`],
                      ['Spannung', `${shellyResult.current_energy.voltage} V`],
                      ['Strom', `${shellyResult.current_energy.current} A`],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border bg-white p-2 text-center">
                        <div className="text-sm font-semibold">{value}</div>
                        <div className="text-xs text-gray-500">{label}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Modbus */}
        {deviceTestTab === 'modbus' && (
          <div>
            <p className="mb-3 text-sm text-gray-500">
              Verbindung zu einem Modbus TCP-Gerät testen (z.B. Janitza, Siemens, ABB).
            </p>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div>
                <label className="label">Host / IP *</label>
                <input type="text" className="input" placeholder="192.168.1.50" value={modbusHost} onChange={(e) => setModbusHost(e.target.value)} />
              </div>
              <div>
                <label className="label">Port</label>
                <input type="number" className="input" value={modbusPort} onChange={(e) => setModbusPort(e.target.value)} />
              </div>
              <div>
                <label className="label">Unit-ID</label>
                <input type="number" className="input" value={modbusUnitId} onChange={(e) => setModbusUnitId(e.target.value)} />
              </div>
              <div>
                <label className="label">Test-Register</label>
                <input type="number" className="input" value={modbusRegister} onChange={(e) => setModbusRegister(e.target.value)} />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!modbusHost) return;
                setModbusTesting(true);
                setModbusResult(null);
                try {
                  const params = new URLSearchParams({ host: modbusHost, port: modbusPort, unit_id: modbusUnitId, register: modbusRegister });
                  const res = await apiClient.post<ConnectionTestResult>(`/api/v1/integrations/modbus/test?${params}`);
                  setModbusResult(res.data);
                } catch (err: unknown) {
                  const error = err as { response?: { data?: { detail?: string } } };
                  setModbusResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
                }
                setModbusTesting(false);
              }}
              className="btn-primary text-sm"
              disabled={modbusTesting || !modbusHost}
            >
              {modbusTesting ? 'Teste…' : 'Verbindung testen'}
            </button>
            {modbusResult && (
              <div className={`mt-4 rounded-lg p-4 ${modbusResult.connected ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${modbusResult.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className={`font-medium ${modbusResult.connected ? 'text-green-700' : 'text-red-700'}`}>
                    {modbusResult.connected ? 'Modbus-Gerät erreichbar' : 'Verbindung fehlgeschlagen'}
                  </span>
                </div>
                {modbusResult.error && <p className="mt-1 text-sm text-red-600">{modbusResult.error}</p>}
              </div>
            )}
          </div>
        )}

        {/* KNX */}
        {deviceTestTab === 'knx' && (
          <div>
            <p className="mb-3 text-sm text-gray-500">
              Verbindung zu einem KNX/IP-Gateway testen (Tunneling-Modus).
            </p>
            <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
              <div>
                <label className="label">Gateway-IP *</label>
                <input type="text" className="input" placeholder="192.168.1.10" value={knxGatewayIp} onChange={(e) => setKnxGatewayIp(e.target.value)} />
              </div>
              <div>
                <label className="label">Port</label>
                <input type="number" className="input" value={knxPort} onChange={(e) => setKnxPort(e.target.value)} />
              </div>
            </div>
            <button
              onClick={async () => {
                if (!knxGatewayIp) return;
                setKnxTesting(true);
                setKnxResult(null);
                try {
                  const params = new URLSearchParams({ gateway_ip: knxGatewayIp, gateway_port: knxPort });
                  const res = await apiClient.post<ConnectionTestResult>(`/api/v1/integrations/knx/test?${params}`);
                  setKnxResult(res.data);
                } catch (err: unknown) {
                  const error = err as { response?: { data?: { detail?: string } } };
                  setKnxResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
                }
                setKnxTesting(false);
              }}
              className="btn-primary text-sm"
              disabled={knxTesting || !knxGatewayIp}
            >
              {knxTesting ? 'Teste…' : 'Verbindung testen'}
            </button>
            {knxResult && (
              <div className={`mt-4 rounded-lg p-4 ${knxResult.connected ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${knxResult.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                  <span className={`font-medium ${knxResult.connected ? 'text-green-700' : 'text-red-700'}`}>
                    {knxResult.connected ? 'KNX-Gateway erreichbar' : 'Verbindung fehlgeschlagen'}
                  </span>
                </div>
                {knxResult.error && <p className="mt-1 text-sm text-red-600">{knxResult.error}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Manuelles Polling */}
      <div className="border rounded-lg p-5">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Manuelles Polling</h3>
        <p className="mb-4 text-sm text-gray-500">
          Alle Zähler mit automatischer Datenquelle (Shelly, Modbus, KNX, Home Assistant) sofort abfragen.
          Im Normalbetrieb erfolgt dies automatisch per Celery-Beat.
        </p>

        <button
          onClick={async () => {
            setPolling(true);
            setPollResult(null);
            try {
              const res = await apiClient.post<PollResult>('/api/v1/integrations/poll');
              setPollResult(res.data);
            } catch {
              setPollResult({ errors: 1, polled: 0, success: 0 });
            }
            setPolling(false);
          }}
          className="btn-primary text-sm"
          disabled={polling}
        >
          {polling ? 'Polling läuft…' : 'Alle Zähler jetzt abfragen'}
        </button>

        {pollResult && (
          <div className="mt-4">
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg border bg-gray-50 p-3 text-center">
                <div className="text-2xl font-bold">{pollResult.polled ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">Abgefragt</div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3 text-center">
                <div className="text-2xl font-bold text-green-600">{pollResult.success ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">Erfolgreich</div>
              </div>
              <div className="rounded-lg border bg-gray-50 p-3 text-center">
                <div className="text-2xl font-bold text-red-600">{pollResult.errors ?? 0}</div>
                <div className="text-xs text-gray-500 mt-1">Fehler</div>
              </div>
            </div>

            {pollResult.details && pollResult.details.length > 0 && (
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Zähler</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-right">Wert</th>
                      <th className="px-3 py-2 text-right">Verbrauch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {pollResult.details.map((d, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-3 py-2">{(d.meter_name as string) || (d.meter_id as string)}</td>
                        <td className="px-3 py-2">
                          {d.success ? (
                            <span className="text-green-600">{d.skipped ? 'Unverändert' : 'OK'}</span>
                          ) : (
                            <span className="text-red-600">{(d.error as string) || 'Fehler'}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {d.value != null ? (d.value as number).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '–'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {d.consumption != null ? (d.consumption as number).toLocaleString('de-DE', { minimumFractionDigits: 2 }) : '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Log-Panel ── */

interface LogEntry {
  timestamp: string;
  level: string;
  source: string;
  message: string;
  details: Record<string, unknown>;
}


function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'ERROR' | 'WARNING' | 'INFO'>('all');

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/api/v1/system/logs?limit=100');
      setEntries(res.data.entries || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const clearLogs = async () => {
    if (!confirm('Log-Puffer wirklich leeren?')) return;
    await apiClient.delete('/api/v1/system/logs');
    setEntries([]);
  };

  useEffect(() => { loadLogs(); }, []);

  const formatTs = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch { return ts; }
  };

  const toneOf = (lvl: string) => lvl === 'ERROR' ? 'tone-alert' : lvl === 'WARNING' ? 'tone-warn' : 'tone-info';
  const counts = { all: entries.length, ERROR: entries.filter((e) => e.level === 'ERROR').length, WARNING: entries.filter((e) => e.level === 'WARNING').length, INFO: entries.filter((e) => e.level === 'INFO').length };
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.level === filter);
  const FILTERS: { id: typeof filter; label: string }[] = [
    { id: 'all', label: `Alle (${counts.all})` }, { id: 'ERROR', label: `Fehler (${counts.ERROR})` },
    { id: 'WARNING', label: `Warnung (${counts.WARNING})` }, { id: 'INFO', label: `Info (${counts.INFO})` },
  ];

  return (
    <SetCard
      title="Anwendungs-Protokoll"
      desc="Fehler und Warnungen der laufenden Sitzung (max. 200 Einträge, nicht persistent)."
      right={
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="sbtn-ghost sm" onClick={loadLogs}><RefreshCw size={13} /> Aktualisieren</button>
          <button className="sbtn-danger" onClick={clearLogs} style={{ padding: '7px 12px', fontSize: 12 }}><Trash2 size={13} /> Leeren</button>
        </div>
      }
    >
      <div className="log-filter">
        {FILTERS.map((f) => <button key={f.id} className={`lf-btn${filter === f.id ? ' on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
          <CheckCircle size={28} style={{ color: 'var(--good)', margin: '0 auto 10px' }} />
          <p style={{ fontSize: 13 }}>Keine Einträge in dieser Auswahl.</p>
        </div>
      ) : (
        <div className="log-list">
          {filtered.map((entry, i) => {
            const hasDetails = entry.details && Object.keys(entry.details).length > 0;
            return (
              <div key={i} className={`log-row ${toneOf(entry.level)}`}>
                <div className="log-top">
                  <span className={`log-lvl ${toneOf(entry.level)}`}>{entry.level}</span>
                  <span className="log-ts">{formatTs(entry.timestamp)}</span>
                  <span className="log-src">{entry.source}</span>
                  {hasDetails && (
                    <button onClick={() => setExpanded(expanded === i ? null : i)} style={{ fontSize: 11, color: 'var(--ink-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                      {expanded === i ? 'Schließen' : 'Details'}
                    </button>
                  )}
                </div>
                <p className="log-msg">{entry.message}</p>
                {expanded === i && hasDetails && (
                  <pre style={{ marginTop: 8, fontSize: 11, background: 'var(--surface-2)', borderRadius: 6, padding: 8, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--ink-2)' }}>
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SetCard>
  );
}

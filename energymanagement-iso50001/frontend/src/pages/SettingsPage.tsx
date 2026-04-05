import { useState, useEffect, useCallback, useRef } from 'react';
import { Save, RefreshCw, Building2, Palette, FileText, Activity, Bell, Monitor, Download, CheckCircle, AlertTriangle, XCircle, Plug2, HeartPulse, Database, Server, Clock, HardDrive, Play, RotateCcw, Wifi, WifiOff, ScrollText, Trash2, Upload, ShieldCheck } from 'lucide-react';
import { apiClient } from '@/utils/api';

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Einstellungen</h1>
        {activeTab !== 'system' && activeTab !== 'integrations' && activeTab !== 'status' && activeTab !== 'logs' && activeTab !== 'backup' && (
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
            <Save className="w-4 h-4" />
            {saving ? 'Speichern...' : saved ? 'Gespeichert!' : 'Speichern'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab-Inhalt */}
      <div className="card p-6">
        {settings[activeTab]?.description && (
          <p className="text-sm text-gray-500 mb-6">
            {settings[activeTab].description}
          </p>
        )}

        {activeTab === 'status' && <StatusPanel />}
        {activeTab === 'organization' && (
          <OrganizationForm values={editValues} onChange={updateField} />
        )}
        {activeTab === 'branding' && (
          <BrandingForm values={editValues} onChange={updateField} />
        )}
        {activeTab === 'report_defaults' && (
          <ReportForm values={editValues} onChange={updateField} />
        )}
        {activeTab === 'enpi_config' && (
          <EnPIForm values={editValues} onChange={updateField} />
        )}
        {activeTab === 'notifications' && (
          <NotificationsForm values={editValues} onChange={updateField} />
        )}
        {activeTab === 'integrations' && <IntegrationsPanel />}
        {activeTab === 'system' && <SystemPanel />}
        {activeTab === 'logs' && <LogPanel />}
        {activeTab === 'backup' && <BackupPanel />}
      </div>
    </div>
  );
}

/* ── Backup-Panel (Export / Import) ── */

interface InspectResult {
  version: string;
  compatible: boolean;
  exported_at: string;
  file_size_kb: number;
  total_rows: number;
  tables: Record<string, number>;
  skipped_tables: string[];
}

function BackupPanel() {
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectResult | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ imported_rows: number; skipped_tables: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await apiClient.get('/api/v1/backup/export', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      a.href = url;
      a.download = `energy_backup_${now}.json.gz`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Export fehlgeschlagen. Bitte erneut versuchen.');
    } finally {
      setExporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setInspectResult(null);
    setImportResult(null);
    setError(null);

    // Direkt Metadaten prüfen
    setInspecting(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiClient.post('/api/v1/backup/inspect', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setInspectResult(res.data);
    } catch {
      setError('Backup-Datei konnte nicht gelesen werden.');
    } finally {
      setInspecting(false);
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const formData = new FormData();
      formData.append('file', importFile);
      const res = await apiClient.post('/api/v1/backup/import?replace=true', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setImportResult(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || 'Import fehlgeschlagen.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Datensicherung</h2>
        <p className="text-sm text-gray-500">
          Exportiere alle Daten als komprimierte JSON-Datei und spiele sie auf einem neuen System ein.
        </p>
      </div>

      {/* Export */}
      <div className="border border-gray-200 rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Download className="w-5 h-5 text-primary-600" />
          <h3 className="font-medium text-gray-800">Datenbank exportieren</h3>
        </div>
        <p className="text-sm text-gray-500">
          Erstellt eine vollständige Sicherung aller Zähler, Messwerte, Einstellungen,
          ISO 50001-Daten und Benutzer als <code>.json.gz</code>-Datei.
        </p>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="btn-primary flex items-center gap-2"
        >
          {exporting
            ? <><RefreshCw className="w-4 h-4 animate-spin" /> Exportiere…</>
            : <><Download className="w-4 h-4" /> Backup herunterladen</>
          }
        </button>
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
            accept=".gz"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="btn-secondary flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            {importFile ? importFile.name : 'Backup-Datei auswählen (.json.gz)'}
          </button>
        </div>

        {/* Datei-Inspektion */}
        {inspecting && (
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <RefreshCw className="w-4 h-4 animate-spin" /> Datei wird geprüft…
          </div>
        )}

        {inspectResult && (
          <div className={`rounded-lg border p-4 space-y-3 ${inspectResult.compatible ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
            <div className="flex items-center gap-2">
              {inspectResult.compatible
                ? <CheckCircle className="w-4 h-4 text-green-600" />
                : <XCircle className="w-4 h-4 text-red-600" />
              }
              <span className="text-sm font-medium">
                {inspectResult.compatible ? 'Kompatible Backup-Datei' : 'Inkompatible Version'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-gray-500">Exportiert am</div>
              <div className="text-gray-800">{new Date(inspectResult.exported_at).toLocaleString('de-DE')}</div>
              <div className="text-gray-500">Dateigröße</div>
              <div className="text-gray-800">{inspectResult.file_size_kb} KB</div>
              <div className="text-gray-500">Datensätze gesamt</div>
              <div className="text-gray-800">{inspectResult.total_rows.toLocaleString('de-DE')}</div>
              <div className="text-gray-500">Tabellen</div>
              <div className="text-gray-800">{Object.keys(inspectResult.tables).length}</div>
            </div>
            <details className="text-xs text-gray-600 cursor-pointer">
              <summary className="font-medium hover:text-primary-600">Tabellen-Details</summary>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 max-h-40 overflow-y-auto">
                {Object.entries(inspectResult.tables).map(([t, n]) => (
                  <div key={t} className="flex justify-between">
                    <span>{t}</span>
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}

        {/* Import-Button */}
        {inspectResult?.compatible && !importResult && (
          <button
            onClick={handleImport}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {importing
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Importiere…</>
              : <><Upload className="w-4 h-4" /> Jetzt importieren (Daten überschreiben)</>
            }
          </button>
        )}

        {/* Import-Ergebnis */}
        {importResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm font-medium text-green-800">Import erfolgreich abgeschlossen</span>
            </div>
            <div className="text-sm text-green-700">
              {importResult.imported_rows.toLocaleString('de-DE')} Datensätze importiert
            </div>
            {importResult.errors.length > 0 && (
              <div className="text-xs text-amber-700 mt-1">
                <strong>Hinweise:</strong>
                <ul className="list-disc ml-4 mt-1">
                  {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
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
    </div>
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

const STATUS_CONFIG: Record<string, { color: string; bg: string; border: string; label: string; Icon: typeof CheckCircle }> = {
  running: { color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', label: 'Läuft', Icon: CheckCircle },
  warning: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Warnung', Icon: AlertTriangle },
  stopped: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Gestoppt', Icon: XCircle },
  error: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Fehler', Icon: XCircle },
  unknown: { color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200', label: 'Unbekannt', Icon: AlertTriangle },
  not_configured: { color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-200', label: 'Nicht konfiguriert', Icon: WifiOff },
};

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

  const overallConfig = data.overall === 'healthy'
    ? { color: 'text-green-600', bg: 'bg-green-100', label: 'Alle Systeme laufen' }
    : data.overall === 'warning'
    ? { color: 'text-amber-600', bg: 'bg-amber-100', label: 'Eingeschränkt' }
    : { color: 'text-red-600', bg: 'bg-red-100', label: 'Störung' };

  return (
    <div className="space-y-6">
      {/* Gesamtstatus-Banner */}
      <div className={`flex items-center justify-between rounded-lg ${overallConfig.bg} px-5 py-4`}>
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${
            data.overall === 'healthy' ? 'bg-green-500' : data.overall === 'warning' ? 'bg-amber-500' : 'bg-red-500'
          } animate-pulse`} />
          <span className={`text-lg font-semibold ${overallConfig.color}`}>
            {overallConfig.label}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {lastRefresh && (
            <span className="text-xs text-gray-500">
              Aktualisiert: {lastRefresh.toLocaleTimeString('de-DE')}
            </span>
          )}
          <button
            onClick={() => loadStatus(true)}
            disabled={refreshing}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Aktualisieren
          </button>
        </div>
      </div>

      {/* Dienste-Karten */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">Dienste</h3>
        <div className="grid grid-cols-1 gap-3">
          {data.services.map((service) => {
            const cfg = STATUS_CONFIG[service.status] || STATUS_CONFIG.unknown;
            const ServiceIcon = SERVICE_ICONS[service.name] || Server;
            const canRestart = service.name === 'Celery Worker' || service.name === 'Celery Beat (Scheduler)';
            const restartKey = service.name === 'Celery Worker' ? 'celery_worker' : 'celery_beat';

            return (
              <div
                key={service.name}
                className={`rounded-lg border ${cfg.border} ${cfg.bg} p-4`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <ServiceIcon className={`w-5 h-5 mt-0.5 ${cfg.color}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">{service.name}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color} ${cfg.bg}`}>
                          <cfg.Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                        {service.latency_ms != null && (
                          <span className="text-xs text-gray-400">{service.latency_ms} ms</span>
                        )}
                      </div>

                      {/* Details */}
                      {service.details && (
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                          {Object.entries(service.details).map(([key, value]) => (
                            <span key={key} className="text-xs text-gray-600">
                              <span className="text-gray-400">{
                                key === 'version' ? 'Version' :
                                key === 'timescaledb' ? 'TimescaleDB' :
                                key === 'database_size' ? 'Größe' :
                                key === 'tables' ? 'Tabellen' :
                                key === 'active_connections' ? 'Verbindungen' :
                                key === 'memory_used' ? 'Speicher' :
                                key === 'pending_tasks' ? 'Wart. Tasks' :
                                key === 'worker_count' ? 'Worker' :
                                key === 'workers' ? '' :
                                key === 'minutes_ago' ? 'Letzter Task' :
                                key === 'last_task_execution' ? '' :
                                key === 'base_url' ? 'URL' :
                                key
                              }: </span>
                              {key === 'workers' ? '' :
                               key === 'last_task_execution' ? '' :
                               key === 'minutes_ago' ? `vor ${value} Min.` :
                               String(value)}
                            </span>
                          )).filter(el => {
                            const key = el.key as string;
                            return key !== 'workers' && key !== 'last_task_execution';
                          })}
                        </div>
                      )}

                      {/* Fehlermeldung */}
                      {service.error && (
                        <p className="mt-1 text-xs text-red-600">{service.error}</p>
                      )}
                    </div>
                  </div>

                  {/* Restart-Button */}
                  {canRestart && (service.status === 'stopped' || service.status === 'error') && (
                    <button
                      onClick={() => restartService(restartKey)}
                      disabled={restarting === restartKey}
                      className="ml-3 btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5 shrink-0"
                    >
                      {restarting === restartKey ? (
                        <RotateCcw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                      {restarting === restartKey ? 'Startet...' : 'Starten'}
                    </button>
                  )}
                  {canRestart && service.status === 'running' && (
                    <button
                      onClick={() => restartService(restartKey)}
                      disabled={restarting === restartKey}
                      className="ml-3 btn-secondary flex items-center gap-1.5 text-xs px-2.5 py-1 shrink-0"
                    >
                      <RotateCcw className={`w-3 h-3 ${restarting === restartKey ? 'animate-spin' : ''}`} />
                      Neustart
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* System-Ressourcen */}
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-3">System-Ressourcen</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wide">
              <Server className="w-3.5 h-3.5" />
              Hostname
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900 truncate">{data.system.hostname}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wide">
              <Clock className="w-3.5 h-3.5" />
              Uptime
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">{formatUptime(data.system.uptime_seconds)}</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wide">
              <HardDrive className="w-3.5 h-3.5" />
              Festplatte
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {data.system.disk_used_gb} / {data.system.disk_total_gb} GB
            </p>
            <div className="mt-1.5 w-full bg-gray-200 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${
                  data.system.disk_usage_percent > 90 ? 'bg-red-500' :
                  data.system.disk_usage_percent > 75 ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: `${data.system.disk_usage_percent}%` }}
              />
            </div>
            <p className="mt-0.5 text-xs text-gray-400">{data.system.disk_free_gb} GB frei ({data.system.disk_usage_percent}% belegt)</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center gap-2 text-xs text-gray-500 uppercase tracking-wide">
              <Monitor className="w-3.5 h-3.5" />
              Version
            </div>
            <p className="mt-1 text-sm font-semibold text-gray-900">v{data.system.version}</p>
            <p className="mt-0.5 text-xs text-gray-400">Python {data.system.python}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Formular-Komponenten ── */

function FormField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function OrganizationForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label="Organisationsname">
        <input
          className="input"
          value={(values.name as string) || ''}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="Muster GmbH"
        />
      </FormField>
      <FormField label="Logo-URL">
        <input
          className="input"
          value={(values.logo_url as string) || ''}
          onChange={(e) => onChange('logo_url', e.target.value)}
          placeholder="https://..."
        />
      </FormField>
      <FormField label="Adresse">
        <input
          className="input"
          value={(values.address as string) || ''}
          onChange={(e) => onChange('address', e.target.value)}
          placeholder="Musterstraße 1, 12345 Musterstadt"
        />
      </FormField>
      <FormField label="E-Mail">
        <input
          className="input"
          type="email"
          value={(values.contact_email as string) || ''}
          onChange={(e) => onChange('contact_email', e.target.value)}
          placeholder="energie@firma.de"
        />
      </FormField>
      <FormField label="Telefon">
        <input
          className="input"
          value={(values.contact_phone as string) || ''}
          onChange={(e) => onChange('contact_phone', e.target.value)}
          placeholder="+49 123 456789"
        />
      </FormField>
    </div>
  );
}

function BrandingForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
}) {
  const colors = [
    { key: 'primary_color', label: 'Primärfarbe' },
    { key: 'secondary_color', label: 'Sekundärfarbe' },
    { key: 'accent_color', label: 'Akzentfarbe' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {colors.map((c) => (
          <FormField key={c.key} label={c.label}>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={(values[c.key] as string) || '#1B5E7B'}
                onChange={(e) => onChange(c.key, e.target.value)}
                className="w-12 h-10 rounded cursor-pointer border border-gray-300"
              />
              <input
                className="input flex-1"
                value={(values[c.key] as string) || ''}
                onChange={(e) => onChange(c.key, e.target.value)}
                placeholder="#1B5E7B"
              />
            </div>
          </FormField>
        ))}
      </div>
      {/* Vorschau */}
      <div className="mt-4 p-4 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-500 mb-3">Vorschau</p>
        <div className="flex gap-3">
          <div
            className="w-24 h-10 rounded flex items-center justify-center text-white text-sm font-medium"
            style={{ backgroundColor: (values.primary_color as string) || '#1B5E7B' }}
          >
            Primär
          </div>
          <div
            className="w-24 h-10 rounded flex items-center justify-center text-white text-sm font-medium"
            style={{ backgroundColor: (values.secondary_color as string) || '#2D8EB9' }}
          >
            Sekundär
          </div>
          <div
            className="w-24 h-10 rounded flex items-center justify-center text-white text-sm font-medium"
            style={{ backgroundColor: (values.accent_color as string) || '#F59E0B' }}
          >
            Akzent
          </div>
        </div>
      </div>
    </div>
  );
}

function ReportForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <FormField label="Firmenname im Bericht">
        <input
          className="input"
          value={(values.company_name as string) || ''}
          onChange={(e) => onChange('company_name', e.target.value)}
        />
      </FormField>
      <FormField label="Berichtssprache">
        <select
          className="input"
          value={(values.report_language as string) || 'de'}
          onChange={(e) => onChange('report_language', e.target.value)}
        >
          <option value="de">Deutsch</option>
          <option value="en">Englisch</option>
        </select>
      </FormField>
      <FormField label="Standard-Berichtszeitraum (Monate)">
        <input
          className="input"
          type="number"
          min={1}
          max={36}
          value={(values.default_period_months as number) || 12}
          onChange={(e) => onChange('default_period_months', parseInt(e.target.value) || 12)}
        />
      </FormField>
      <div className="space-y-3 pt-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(values.include_logo)}
            onChange={(e) => onChange('include_logo', e.target.checked)}
            className="rounded border-gray-300 text-primary-500"
          />
          <span className="text-sm">Logo im Bericht anzeigen</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(values.include_weather_correction)}
            onChange={(e) => onChange('include_weather_correction', e.target.checked)}
            className="rounded border-gray-300 text-primary-500"
          />
          <span className="text-sm">Witterungskorrektur einbeziehen</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(values.include_co2)}
            onChange={(e) => onChange('include_co2', e.target.checked)}
            className="rounded border-gray-300 text-primary-500"
          />
          <span className="text-sm">CO₂-Bilanz einbeziehen</span>
        </label>
      </div>
    </div>
  );
}

function EnPIForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
}) {
  const allMetrics = [
    { id: 'kwh_per_m2', label: 'kWh/m²' },
    { id: 'kwh_per_person', label: 'kWh/Mitarbeiter' },
    { id: 'kwh_per_unit', label: 'kWh/Produktionseinheit' },
    { id: 'co2_per_m2', label: 'kg CO₂/m²' },
  ];
  const selectedMetrics = (values.metrics as string[]) || [];

  const toggleMetric = (id: string) => {
    const next = selectedMetrics.includes(id)
      ? selectedMetrics.filter((m) => m !== id)
      : [...selectedMetrics, id];
    onChange('metrics', next);
  };

  return (
    <div className="space-y-6">
      <FormField label="Aktive Kennzahlen">
        <div className="grid grid-cols-2 gap-2 mt-2">
          {allMetrics.map((m) => (
            <label key={m.id} className="flex items-center gap-2 cursor-pointer p-2 rounded hover:bg-gray-50">
              <input
                type="checkbox"
                checked={selectedMetrics.includes(m.id)}
                onChange={() => toggleMetric(m.id)}
                className="rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm">{m.label}</span>
            </label>
          ))}
        </div>
      </FormField>
      <FormField label="Referenz-Standard">
        <select
          className="input"
          value={(values.reference_standard as string) || 'vdi_3807'}
          onChange={(e) => onChange('reference_standard', e.target.value)}
        >
          <option value="vdi_3807">VDI 3807</option>
          <option value="din_v_18599">DIN V 18599</option>
          <option value="custom">Eigene Referenzwerte</option>
        </select>
      </FormField>
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(values.show_reference_values)}
          onChange={(e) => onChange('show_reference_values', e.target.checked)}
          className="rounded border-gray-300 text-primary-500"
        />
        <span className="text-sm">Referenzwerte in Benchmarks anzeigen</span>
      </label>
    </div>
  );
}

function NotificationsForm({
  values,
  onChange,
}: {
  values: Record<string, unknown>;
  onChange: (k: string, v: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(values.email_enabled)}
          onChange={(e) => onChange('email_enabled', e.target.checked)}
          className="rounded border-gray-300 text-primary-500"
        />
        <span className="text-sm">E-Mail-Benachrichtigungen aktivieren</span>
      </label>
      <FormField label="Dokumenten-Überprüfung Vorlauf (Tage)">
        <input
          className="input w-32"
          type="number"
          min={1}
          max={90}
          value={(values.review_reminder_days as number) || 30}
          onChange={(e) => onChange('review_reminder_days', parseInt(e.target.value) || 30)}
        />
      </FormField>
      <FormField label="Audit-Erinnerung Vorlauf (Tage)">
        <input
          className="input w-32"
          type="number"
          min={1}
          max={90}
          value={(values.audit_reminder_days as number) || 14}
          onChange={(e) => onChange('audit_reminder_days', parseInt(e.target.value) || 14)}
        />
      </FormField>
    </div>
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

const LEVEL_STYLE: Record<string, string> = {
  ERROR: 'bg-red-50 text-red-700 border-red-200',
  WARNING: 'bg-amber-50 text-amber-700 border-amber-200',
  INFO: 'bg-blue-50 text-blue-700 border-blue-200',
};

function LogPanel() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

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

  useEffect(() => {
    loadLogs();
  }, []);

  const formatTs = (ts: string) => {
    try {
      return new Date(ts).toLocaleString('de-DE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Anwendungs-Log</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Fehler und Warnungen der laufenden Sitzung (max. 200 Einträge, nicht persistent)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadLogs}
            className="btn-secondary flex items-center gap-1"
            title="Aktualisieren"
          >
            <RefreshCw className="w-4 h-4" />
            Aktualisieren
          </button>
          <button
            onClick={clearLogs}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50"
            title="Log leeren"
          >
            <Trash2 className="w-4 h-4" />
            Leeren
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-8 text-center text-gray-400">Laden...</div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center">
          <CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
          <p className="text-gray-500">Keine Fehler seit dem letzten Start</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => {
            const style = LEVEL_STYLE[entry.level] || LEVEL_STYLE.INFO;
            const hasDetails = entry.details && Object.keys(entry.details).length > 0;
            return (
              <div key={i} className={`rounded-lg border p-3 ${style}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-bold">{entry.level}</span>
                      <span className="text-xs font-mono text-gray-500">{formatTs(entry.timestamp)}</span>
                      <span className="text-xs text-gray-500 truncate">{entry.source}</span>
                    </div>
                    <p className="mt-1 text-sm font-medium break-words">{entry.message}</p>
                  </div>
                  {hasDetails && (
                    <button
                      onClick={() => setExpanded(expanded === i ? null : i)}
                      className="text-xs underline whitespace-nowrap shrink-0"
                    >
                      {expanded === i ? 'Schließen' : 'Details'}
                    </button>
                  )}
                </div>
                {expanded === i && hasDetails && (
                  <pre className="mt-2 text-xs bg-white/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(entry.details, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

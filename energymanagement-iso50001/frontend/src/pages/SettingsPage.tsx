import { useState, useEffect, useCallback } from 'react';
import { Save, RefreshCw, Building2, Palette, FileText, Activity, Bell, Monitor, Download, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { apiClient } from '@/utils/api';

interface SettingEntry {
  value: Record<string, unknown>;
  description?: string;
  category?: string;
}

type AllSettings = Record<string, SettingEntry>;

const TABS = [
  { id: 'organization', label: 'Organisation', icon: Building2 },
  { id: 'branding', label: 'Branding', icon: Palette },
  { id: 'report_defaults', label: 'Berichte', icon: FileText },
  { id: 'enpi_config', label: 'EnPI', icon: Activity },
  { id: 'notifications', label: 'Benachrichtigungen', icon: Bell },
  { id: 'system', label: 'System', icon: Monitor },
] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<AllSettings>({});
  const [activeTab, setActiveTab] = useState('organization');
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
        {activeTab !== 'system' && (
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
        {activeTab === 'system' && <SystemPanel />}
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

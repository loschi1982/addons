/**
 * DiscoveryModal – Auto-Discovery für Sensoren und Zähler aus allen Integrationen.
 *
 * Scannt Home Assistant, MQTT, BACnet und Shelly nach verfügbaren Geräten,
 * kategorisiert sie und ermöglicht die schnelle Anlage als Zähler oder Klimasensor.
 */

import { useState } from 'react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType } from '@/types';

// ── Typen ──

interface DiscoveredDevice {
  integration: string;
  entity_id: string;
  name: string;
  category: 'meter' | 'climate' | 'other';
  subcategory: string;
  energy_type: string | null;
  unit: string;
  current_value: string | number | null;
  device_name?: string;
  already_configured: boolean;
}

interface DiscoveryResponse {
  devices: DiscoveredDevice[];
  integrations_scanned: string[];
  total: number;
}

type CategoryFilter = 'all' | 'meter' | 'climate';

// Quick-Add Formulare
interface MeterQuickForm {
  name: string;
  energy_type: string;
  site_id: string;
  parent_meter_id: string;
}

interface ClimateQuickForm {
  name: string;
  zone: string;
  target_temp_min: string;
  target_temp_max: string;
}

const INTEGRATION_LABELS: Record<string, string> = {
  homeassistant: 'Home Assistant',
  mqtt: 'MQTT',
  bacnet: 'BACnet',
  shelly: 'Shelly',
};

const CATEGORY_ICONS: Record<string, string> = {
  meter: '\u26A1',
  climate: '\uD83C\uDF21\uFE0F',
  other: '\uD83D\uDD18',
};

// ── Komponente ──

export default function DiscoveryModal({
  mode = 'all',
  onClose,
  onCreated,
}: {
  mode?: 'all' | 'meter' | 'climate';
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [scannedIntegrations, setScannedIntegrations] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>(
    mode === 'all' ? 'all' : mode
  );

  // Quick-Add State
  const [addingDevice, setAddingDevice] = useState<DiscoveredDevice | null>(null);
  const [meterForm, setMeterForm] = useState<MeterQuickForm>({
    name: '', energy_type: 'electricity', site_id: '', parent_meter_id: '',
  });
  const [climateForm, setClimateForm] = useState<ClimateQuickForm>({
    name: '', zone: '', target_temp_min: '20', target_temp_max: '24',
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const res = await apiClient.get<DiscoveryResponse>('/api/v1/integrations/discover');
      setDevices(res.data.devices);
      setScannedIntegrations(res.data.integrations_scanned);
      setScanned(true);
    } catch {
      setError('Scan fehlgeschlagen. Prüfen Sie die Integrations-Konfiguration.');
    } finally {
      setScanning(false);
    }
  };

  const filteredDevices = devices.filter((d) => {
    if (categoryFilter === 'all') return true;
    return d.category === categoryFilter;
  });

  // Nach Integration gruppieren
  const grouped: Record<string, DiscoveredDevice[]> = {};
  for (const d of filteredDevices) {
    const key = d.integration;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(d);
  }

  const handleQuickAdd = (device: DiscoveredDevice) => {
    setAddingDevice(device);
    setSaveError(null);
    if (device.category === 'meter') {
      setMeterForm({
        name: device.name,
        energy_type: device.energy_type || 'electricity',
        site_id: '',
        parent_meter_id: '',
      });
    } else {
      setClimateForm({
        name: device.name,
        zone: '',
        target_temp_min: '20',
        target_temp_max: '24',
      });
    }
  };

  const handleSaveMeter = async () => {
    if (!addingDevice) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.post('/api/v1/meters/from-discovery', {
        integration: addingDevice.integration,
        entity_id: addingDevice.entity_id,
        name: meterForm.name,
        energy_type: meterForm.energy_type,
        site_id: meterForm.site_id || undefined,
        parent_meter_id: meterForm.parent_meter_id || undefined,
      });
      // Gerät als konfiguriert markieren
      setDevices((prev) =>
        prev.map((d) =>
          d.entity_id === addingDevice.entity_id
            ? { ...d, already_configured: true }
            : d
        )
      );
      setAddingDevice(null);
      onCreated?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setSaveError(e.response?.data?.detail || 'Fehler beim Anlegen');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveClimate = async () => {
    if (!addingDevice) return;
    setSaving(true);
    setSaveError(null);

    // Temperatur- und Feuchte-Entity erkennen
    const isHumidity = addingDevice.subcategory === 'humidity';
    try {
      await apiClient.post('/api/v1/climate/sensors/from-discovery', {
        integration: addingDevice.integration,
        entity_id_temp: isHumidity ? undefined : addingDevice.entity_id,
        entity_id_humidity: isHumidity ? addingDevice.entity_id : undefined,
        name: climateForm.name,
        zone: climateForm.zone || undefined,
        target_temp_min: climateForm.target_temp_min ? parseFloat(climateForm.target_temp_min) : 20,
        target_temp_max: climateForm.target_temp_max ? parseFloat(climateForm.target_temp_max) : 24,
      });
      setDevices((prev) =>
        prev.map((d) =>
          d.entity_id === addingDevice.entity_id
            ? { ...d, already_configured: true }
            : d
        )
      );
      setAddingDevice(null);
      onCreated?.();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setSaveError(e.response?.data?.detail || 'Fehler beim Anlegen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-bold">Verfügbare Geräte entdecken</h2>
            {scanned && (
              <p className="text-xs text-gray-500 mt-0.5">
                {filteredDevices.length} Geräte gefunden
                {scannedIntegrations.length > 0 && (
                  <> &middot; {scannedIntegrations.map((i) => INTEGRATION_LABELS[i] || i).join(', ')}</>
                )}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="btn-primary text-sm"
            >
              {scanning ? 'Scanne...' : scanned ? 'Erneut scannen' : 'Scannen'}
            </button>
            <button onClick={onClose} className="btn-secondary text-sm">
              Schließen
            </button>
          </div>
        </div>

        {/* Filter */}
        {scanned && (
          <div className="flex gap-2 border-b px-6 py-2 bg-gray-50">
            {([['all', 'Alle'], ['meter', '\u26A1 Zähler'], ['climate', '\uD83C\uDF21\uFE0F Klima']] as [CategoryFilter, string][]).map(
              ([key, label]) => (
                <button
                  key={key}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    categoryFilter === key
                      ? 'bg-primary-600 text-white'
                      : 'bg-white text-gray-600 border border-gray-300 hover:bg-gray-100'
                  }`}
                  onClick={() => setCategoryFilter(key)}
                >
                  {label}
                </button>
              )
            )}
          </div>
        )}

        {/* Inhalt */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700 mb-4">
              {error}
            </div>
          )}

          {!scanned && !scanning && (
            <div className="py-12 text-center text-gray-400">
              <p className="text-lg mb-2">Integrationen nach Geräten durchsuchen</p>
              <p className="text-sm">
                Klicken Sie auf &quot;Scannen&quot;, um alle konfigurierten Integrationen
                nach verfügbaren Sensoren und Zählern zu durchsuchen.
              </p>
            </div>
          )}

          {scanning && (
            <div className="py-12 text-center text-gray-400">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-primary-600 border-t-transparent mb-3" />
              <p>Durchsuche Integrationen...</p>
              <p className="text-xs mt-1">Home Assistant, MQTT, BACnet, Shelly</p>
            </div>
          )}

          {scanned && filteredDevices.length === 0 && (
            <div className="py-12 text-center text-gray-400">
              Keine Geräte in dieser Kategorie gefunden.
            </div>
          )}

          {scanned && Object.entries(grouped).map(([integration, devs]) => (
            <div key={integration} className="mb-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">
                  {INTEGRATION_LABELS[integration] || integration}
                </span>
                <span className="text-xs text-gray-400">({devs.length})</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
              <div className="space-y-1">
                {devs.map((device) => (
                  <DeviceRow
                    key={device.entity_id}
                    device={device}
                    isAdding={addingDevice?.entity_id === device.entity_id}
                    onAdd={() => handleQuickAdd(device)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Quick-Add Panel */}
        {addingDevice && (
          <div className="border-t bg-gray-50 px-6 py-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-semibold">
                  {addingDevice.category === 'meter' ? 'Zähler anlegen' : 'Klimasensor anlegen'}
                </p>
                <p className="text-xs text-gray-500">{addingDevice.entity_id}</p>
              </div>
              <button
                onClick={() => setAddingDevice(null)}
                className="text-gray-400 hover:text-gray-600 text-sm"
              >
                Abbrechen
              </button>
            </div>

            {saveError && (
              <div className="rounded-lg bg-red-50 p-2 text-sm text-red-700 mb-3">
                {saveError}
              </div>
            )}

            {addingDevice.category === 'meter' ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label">Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={meterForm.name}
                    onChange={(e) => setMeterForm({ ...meterForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Energieart</label>
                  <select
                    className="input"
                    value={meterForm.energy_type}
                    onChange={(e) => setMeterForm({ ...meterForm, energy_type: e.target.value })}
                  >
                    {Object.entries(ENERGY_TYPE_LABELS).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleSaveMeter}
                    disabled={saving || !meterForm.name}
                    className="btn-primary w-full text-sm"
                  >
                    {saving ? 'Speichern...' : 'Zähler anlegen'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="label">Name *</label>
                  <input
                    type="text"
                    className="input"
                    value={climateForm.name}
                    onChange={(e) => setClimateForm({ ...climateForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="label">Zone</label>
                  <input
                    type="text"
                    className="input"
                    value={climateForm.zone}
                    onChange={(e) => setClimateForm({ ...climateForm, zone: e.target.value })}
                    placeholder="z.B. EG"
                  />
                </div>
                <div>
                  <label className="label">Sollbereich °C</label>
                  <div className="flex gap-1">
                    <input
                      type="number" step="0.5" className="input w-16"
                      value={climateForm.target_temp_min}
                      onChange={(e) => setClimateForm({ ...climateForm, target_temp_min: e.target.value })}
                    />
                    <span className="self-center text-gray-400">–</span>
                    <input
                      type="number" step="0.5" className="input w-16"
                      value={climateForm.target_temp_max}
                      onChange={(e) => setClimateForm({ ...climateForm, target_temp_max: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleSaveClimate}
                    disabled={saving || !climateForm.name}
                    className="btn-primary w-full text-sm"
                  >
                    {saving ? 'Speichern...' : 'Sensor anlegen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Geräte-Zeile ──

function DeviceRow({
  device,
  isAdding,
  onAdd,
}: {
  device: DiscoveredDevice;
  isAdding: boolean;
  onAdd: () => void;
}) {
  const icon = CATEGORY_ICONS[device.category] || '';
  const value = device.current_value != null ? String(device.current_value) : '';

  return (
    <div
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
        isAdding
          ? 'bg-primary-50 border border-primary-200'
          : device.already_configured
            ? 'bg-gray-50 opacity-60'
            : 'hover:bg-gray-50'
      }`}
    >
      <span className="text-base" title={device.category}>{icon}</span>
      <div className="flex-1 min-w-0">
        <span className="font-medium truncate block">{device.name}</span>
        <span className="text-xs text-gray-400 truncate block">{device.entity_id}</span>
      </div>
      {value && (
        <span className="font-mono text-xs text-gray-600 whitespace-nowrap">
          {value} {device.unit}
        </span>
      )}
      {device.energy_type && (
        <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
          {ENERGY_TYPE_LABELS[device.energy_type as EnergyType] || device.energy_type}
        </span>
      )}
      {device.already_configured ? (
        <span className="text-xs text-gray-400 whitespace-nowrap">Aktiv</span>
      ) : (
        <button
          onClick={onAdd}
          className="text-primary-600 hover:text-primary-800 font-medium text-xs whitespace-nowrap"
        >
          + Anlegen
        </button>
      )}
    </div>
  );
}

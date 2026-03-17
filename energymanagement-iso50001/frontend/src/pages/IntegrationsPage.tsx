import { useEffect, useState } from 'react';
import { apiClient } from '@/utils/api';

// ── Typen ──

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
  meter_id?: string;
  meter_name?: string;
  value?: number;
  details?: Array<Record<string, unknown>>;
}

type Tab = 'ha' | 'shelly' | 'modbus' | 'knx' | 'polling';

// ── Komponente ──

export default function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('ha');

  return (
    <div>
      <div>
        <h1 className="page-title">Integrationen</h1>
        <p className="mt-1 text-sm text-gray-500">
          Externe Datenquellen verbinden und testen
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            ['ha', 'Home Assistant'],
            ['shelly', 'Shelly'],
            ['modbus', 'Modbus'],
            ['knx', 'KNX'],
            ['polling', 'Polling'],
          ] as [Tab, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`pb-2 text-sm font-medium ${
                activeTab === key
                  ? 'border-b-2 border-primary-600 text-primary-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-4">
        {activeTab === 'ha' && <HAPanel />}
        {activeTab === 'shelly' && <ShellyPanel />}
        {activeTab === 'modbus' && <ModbusPanel />}
        {activeTab === 'knx' && <KNXPanel />}
        {activeTab === 'polling' && <PollingPanel />}
      </div>
    </div>
  );
}

// ── Home Assistant ──

function HAPanel() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [entities, setEntities] = useState<HAEntity[]>([]);
  const [loadingEntities, setLoadingEntities] = useState(false);
  const [domainFilter, setDomainFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  const checkConnection = async () => {
    setChecking(true);
    try {
      const res = await apiClient.get<{ connected: boolean }>('/api/v1/integrations/ha/status');
      setConnected(res.data.connected);
    } catch {
      setConnected(false);
    } finally {
      setChecking(false);
    }
  };

  const loadEntities = async () => {
    setLoadingEntities(true);
    try {
      const params = new URLSearchParams();
      if (domainFilter) params.append('domain', domainFilter);
      const res = await apiClient.get<{ entities: HAEntity[]; count: number }>(
        `/api/v1/integrations/ha/entities?${params}`
      );
      setEntities(res.data.entities);
    } catch {
      // Interceptor handled
    } finally {
      setLoadingEntities(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  const filteredEntities = entities.filter((e) => {
    if (!searchFilter) return true;
    const lower = searchFilter.toLowerCase();
    return (
      e.entity_id.toLowerCase().includes(lower) ||
      (e.friendly_name || '').toLowerCase().includes(lower)
    );
  });

  return (
    <div className="space-y-4">
      {/* Verbindungsstatus */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`h-3 w-3 rounded-full ${
                connected === null ? 'bg-gray-300' : connected ? 'bg-green-500' : 'bg-red-500'
              }`}
            />
            <span className="font-medium">
              {connected === null
                ? 'Prüfe Verbindung...'
                : connected
                  ? 'Verbunden mit Home Assistant'
                  : 'Keine Verbindung zu Home Assistant'}
            </span>
          </div>
          <button onClick={checkConnection} className="btn-secondary text-sm" disabled={checking}>
            {checking ? 'Prüfe...' : 'Verbindung testen'}
          </button>
        </div>
      </div>

      {/* Entity-Browser */}
      {connected && (
        <div className="card">
          <h2 className="mb-3 text-base font-semibold">Entity-Browser</h2>
          <div className="flex gap-4 mb-4">
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
              placeholder="Suche nach Entity-ID oder Name..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
            />
            <button onClick={loadEntities} className="btn-primary" disabled={loadingEntities}>
              {loadingEntities ? 'Laden...' : 'Entitäten laden'}
            </button>
          </div>

          {entities.length > 0 && (
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
                    {filteredEntities.map((e) => (
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
                {filteredEntities.length} von {entities.length} Entitäten
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shelly ──

function ShellyPanel() {
  const [host, setHost] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ShellyTestResult | null>(null);

  const handleTest = async () => {
    if (!host) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await apiClient.post<ShellyTestResult>(
        `/api/v1/integrations/shelly/test?host=${encodeURIComponent(host)}`
      );
      setResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">Shelly-Gerät testen</h2>
      <p className="mb-4 text-sm text-gray-500">
        Geben Sie die IP-Adresse eines Shelly-Geräts ein, um die Verbindung zu testen.
        Unterstützt Gen1 und Gen2+ Geräte.
      </p>

      <div className="flex gap-4 mb-4">
        <input
          type="text"
          className="input flex-1 max-w-xs"
          placeholder="z.B. 192.168.1.100"
          value={host}
          onChange={(e) => setHost(e.target.value)}
        />
        <button onClick={handleTest} className="btn-primary" disabled={testing || !host}>
          {testing ? 'Teste...' : 'Verbindung testen'}
        </button>
      </div>

      {result && (
        <div className={`rounded-lg p-4 ${result.connected ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`h-2.5 w-2.5 rounded-full ${result.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`font-medium ${result.connected ? 'text-green-700' : 'text-red-700'}`}>
              {result.connected ? 'Verbindung erfolgreich' : 'Verbindung fehlgeschlagen'}
            </span>
          </div>

          {result.error && <p className="text-sm text-red-600">{result.error}</p>}

          {result.device_info && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-gray-500">Modell:</span> {result.device_info.model}</div>
              <div><span className="text-gray-500">Generation:</span> Gen{result.device_info.gen}</div>
              <div><span className="text-gray-500">Name:</span> {result.device_info.name || '–'}</div>
              <div><span className="text-gray-500">MAC:</span> {result.device_info.mac}</div>
              <div><span className="text-gray-500">Firmware:</span> {result.device_info.firmware}</div>
            </div>
          )}

          {result.current_energy && (
            <div className="mt-3 grid grid-cols-4 gap-3">
              <MiniStat label="Leistung" value={`${result.current_energy.power} W`} />
              <MiniStat label="Energie" value={`${(result.current_energy.energy_wh / 1000).toFixed(2)} kWh`} />
              <MiniStat label="Spannung" value={`${result.current_energy.voltage} V`} />
              <MiniStat label="Strom" value={`${result.current_energy.current} A`} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modbus ──

function ModbusPanel() {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('502');
  const [unitId, setUnitId] = useState('1');
  const [register, setRegister] = useState('0');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = async () => {
    if (!host) return;
    setTesting(true);
    setResult(null);
    try {
      const params = new URLSearchParams({
        host,
        port,
        unit_id: unitId,
        register,
      });
      const res = await apiClient.post<ConnectionTestResult>(
        `/api/v1/integrations/modbus/test?${params}`
      );
      setResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">Modbus-Gerät testen</h2>
      <p className="mb-4 text-sm text-gray-500">
        Verbindung zu einem Modbus TCP-Gerät testen (z.B. Janitza, Siemens, ABB Energiezähler).
      </p>

      <div className="grid grid-cols-4 gap-4 mb-4">
        <div>
          <label className="label">Host / IP *</label>
          <input
            type="text"
            className="input"
            placeholder="192.168.1.50"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Port</label>
          <input
            type="number"
            className="input"
            value={port}
            onChange={(e) => setPort(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Unit-ID</label>
          <input
            type="number"
            className="input"
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Test-Register</label>
          <input
            type="number"
            className="input"
            value={register}
            onChange={(e) => setRegister(e.target.value)}
          />
        </div>
      </div>

      <button onClick={handleTest} className="btn-primary" disabled={testing || !host}>
        {testing ? 'Teste...' : 'Verbindung testen'}
      </button>

      {result && (
        <div className={`mt-4 rounded-lg p-4 ${result.connected ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${result.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`font-medium ${result.connected ? 'text-green-700' : 'text-red-700'}`}>
              {result.connected ? 'Modbus-Gerät erreichbar' : 'Verbindung fehlgeschlagen'}
            </span>
          </div>
          {result.error && <p className="mt-1 text-sm text-red-600">{result.error}</p>}
        </div>
      )}
    </div>
  );
}

// ── KNX ──

function KNXPanel() {
  const [gatewayIp, setGatewayIp] = useState('');
  const [gatewayPort, setGatewayPort] = useState('3671');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);

  const handleTest = async () => {
    if (!gatewayIp) return;
    setTesting(true);
    setResult(null);
    try {
      const params = new URLSearchParams({
        gateway_ip: gatewayIp,
        gateway_port: gatewayPort,
      });
      const res = await apiClient.post<ConnectionTestResult>(
        `/api/v1/integrations/knx/test?${params}`
      );
      setResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setResult({ connected: false, error: error.response?.data?.detail || 'Verbindungsfehler' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">KNX/IP-Gateway testen</h2>
      <p className="mb-4 text-sm text-gray-500">
        Verbindung zu einem KNX/IP-Gateway testen (Tunneling-Modus).
      </p>

      <div className="grid grid-cols-2 gap-4 mb-4 max-w-md">
        <div>
          <label className="label">Gateway-IP *</label>
          <input
            type="text"
            className="input"
            placeholder="192.168.1.10"
            value={gatewayIp}
            onChange={(e) => setGatewayIp(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Port</label>
          <input
            type="number"
            className="input"
            value={gatewayPort}
            onChange={(e) => setGatewayPort(e.target.value)}
          />
        </div>
      </div>

      <button onClick={handleTest} className="btn-primary" disabled={testing || !gatewayIp}>
        {testing ? 'Teste...' : 'Verbindung testen'}
      </button>

      {result && (
        <div className={`mt-4 rounded-lg p-4 ${result.connected ? 'bg-green-50' : 'bg-red-50'}`}>
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${result.connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className={`font-medium ${result.connected ? 'text-green-700' : 'text-red-700'}`}>
              {result.connected ? 'KNX-Gateway erreichbar' : 'Verbindung fehlgeschlagen'}
            </span>
          </div>
          {result.error && <p className="mt-1 text-sm text-red-600">{result.error}</p>}
        </div>
      )}
    </div>
  );
}

// ── Polling ──

function PollingPanel() {
  const [polling, setPolling] = useState(false);
  const [pollResult, setPollResult] = useState<PollResult | null>(null);

  const handlePollAll = async () => {
    setPolling(true);
    setPollResult(null);
    try {
      const res = await apiClient.post<PollResult>('/api/v1/integrations/poll');
      setPollResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setPollResult({ errors: 1, polled: 0, success: 0 });
      console.error(error);
    } finally {
      setPolling(false);
    }
  };

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">Manuelles Polling</h2>
      <p className="mb-4 text-sm text-gray-500">
        Alle Zähler mit automatischer Datenquelle (Shelly, Modbus, KNX, Home Assistant)
        sofort abfragen. Im Normalbetrieb erfolgt dies automatisch per Celery-Beat.
      </p>

      <button onClick={handlePollAll} className="btn-primary" disabled={polling}>
        {polling ? 'Polling läuft...' : 'Alle Zähler jetzt abfragen'}
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
                          <span className="text-green-600">
                            {d.skipped ? 'Unverändert' : 'OK'}
                          </span>
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
  );
}

// ── Hilfs-Komponenten ──

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-white p-2 text-center">
      <div className="text-sm font-semibold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';

// ── Typen ──

interface WeatherStation {
  id: string;
  name: string;
  dwd_station_id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
}

interface WeatherRecord {
  id: string;
  station_id: string;
  date: string;
  temp_avg: number;
  temp_min: number | null;
  temp_max: number | null;
  heating_degree_days: number;
  cooling_degree_days: number;
  sunshine_hours: number | null;
}

interface MonthlyDegreeDay {
  id: string;
  station_id: string;
  year: number;
  month: number;
  heating_degree_days: number;
  cooling_degree_days: number;
  avg_temperature: number;
  heating_days: number;
  long_term_avg_hdd: number | null;
}

interface CorrectionConfig {
  id: string;
  meter_id: string;
  station_id: string;
  method: string;
  indoor_temp: number;
  heating_limit: number;
  cooling_limit: number;
  reference_year: number | null;
  reference_hdd: number | null;
  base_load_percent: number | null;
  is_active: boolean;
}

type Tab = 'stations' | 'data' | 'degree-days' | 'correction';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

// ── Komponente ──

export default function WeatherPage() {
  const [activeTab, setActiveTab] = useState<Tab>('stations');
  const [stations, setStations] = useState<WeatherStation[]>([]);
  const [selectedStation, setSelectedStation] = useState('');
  const [loading, setLoading] = useState(false);

  // Stationen laden
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<WeatherStation[]>('/api/v1/weather/stations');
        setStations(res.data);
        if (res.data.length > 0) setSelectedStation(res.data[0].id);
      } catch {
        // Interceptor
      }
    })();
  }, []);

  return (
    <div>
      <div>
        <h1 className="page-title">Wetterdaten</h1>
        <p className="mt-1 text-sm text-gray-500">
          DWD-Wetterdaten, Gradtagszahlen und Witterungskorrektur
        </p>
      </div>

      {/* Tabs */}
      <div className="mt-4 border-b border-gray-200">
        <nav className="flex gap-6">
          {([
            ['stations', 'Stationen'],
            ['data', 'Wetterdaten'],
            ['degree-days', 'Gradtagszahlen'],
            ['correction', 'Witterungskorrektur'],
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
        {activeTab === 'stations' && <StationsPanel stations={stations} />}
        {activeTab === 'data' && (
          <WeatherDataPanel stations={stations} selectedStation={selectedStation} onSelectStation={setSelectedStation} />
        )}
        {activeTab === 'degree-days' && (
          <DegreeDaysPanel stations={stations} selectedStation={selectedStation} onSelectStation={setSelectedStation} />
        )}
        {activeTab === 'correction' && <CorrectionPanel />}
      </div>
    </div>
  );
}

// ── Stationen ──

function StationsPanel({ stations }: { stations: WeatherStation[] }) {
  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">Wetterstationen</h2>
      {stations.length === 0 ? (
        <p className="text-gray-400">
          Keine Wetterstationen konfiguriert. Stationen werden automatisch per Seed-Daten oder manuell angelegt.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">DWD-ID</th>
                <th className="px-4 py-2 text-right">Breitengrad</th>
                <th className="px-4 py-2 text-right">Längengrad</th>
                <th className="px-4 py-2 text-right">Höhe (m)</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {stations.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2 font-mono text-gray-500">{s.dwd_station_id}</td>
                  <td className="px-4 py-2 text-right font-mono">{s.latitude.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right font-mono">{s.longitude.toFixed(4)}</td>
                  <td className="px-4 py-2 text-right">{s.altitude ?? '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Wetterdaten ──

function WeatherDataPanel({
  stations,
  selectedStation,
  onSelectStation,
}: {
  stations: WeatherStation[];
  selectedStation: string;
  onSelectStation: (id: string) => void;
}) {
  const [records, setRecords] = useState<WeatherRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fetching, setFetching] = useState(false);

  const loadData = useCallback(async () => {
    if (!selectedStation) return;
    setLoading(true);
    try {
      const res = await apiClient.get<WeatherRecord[]>(
        `/api/v1/weather/stations/${selectedStation}/data?start_date=${startDate}&end_date=${endDate}`
      );
      setRecords(res.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [selectedStation, startDate, endDate]);

  const handleFetch = async () => {
    if (!selectedStation) return;
    setFetching(true);
    try {
      await apiClient.post(
        `/api/v1/weather/fetch?station_id=${selectedStation}&start_date=${startDate}&end_date=${endDate}`
      );
      await loadData();
    } catch {
      // Interceptor
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex gap-4 items-end">
          <div>
            <label className="label">Station</label>
            <select
              className="input w-56"
              value={selectedStation}
              onChange={(e) => onSelectStation(e.target.value)}
            >
              <option value="">– Station wählen –</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Von</label>
            <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Bis</label>
            <input type="date" className="input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <button onClick={loadData} className="btn-primary" disabled={loading || !selectedStation}>
            {loading ? 'Laden...' : 'Anzeigen'}
          </button>
          <button onClick={handleFetch} className="btn-secondary" disabled={fetching || !selectedStation}>
            {fetching ? 'Abrufen...' : 'Vom DWD abrufen'}
          </button>
        </div>
      </div>

      {records.length > 0 && (
        <div className="card overflow-hidden p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left">Datum</th>
                  <th className="px-3 py-2 text-right">T_avg</th>
                  <th className="px-3 py-2 text-right">T_min</th>
                  <th className="px-3 py-2 text-right">T_max</th>
                  <th className="px-3 py-2 text-right">HDD</th>
                  <th className="px-3 py-2 text-right">CDD</th>
                  <th className="px-3 py-2 text-right">Sonne (h)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {records.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-3 py-1.5">{new Date(r.date).toLocaleDateString('de-DE')}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.temp_avg.toFixed(1)} °C</td>
                    <td className="px-3 py-1.5 text-right font-mono text-blue-600">
                      {r.temp_min?.toFixed(1) ?? '–'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono text-red-500">
                      {r.temp_max?.toFixed(1) ?? '–'}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.heating_degree_days.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.cooling_degree_days.toFixed(1)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{r.sunshine_hours?.toFixed(1) ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t bg-gray-50 px-3 py-2 text-xs text-gray-500">
            {records.length} Tageswerte
          </div>
        </div>
      )}
    </div>
  );
}

// ── Gradtagszahlen ──

function DegreeDaysPanel({
  stations,
  selectedStation,
  onSelectStation,
}: {
  stations: WeatherStation[];
  selectedStation: string;
  onSelectStation: (id: string) => void;
}) {
  const [data, setData] = useState<{
    total_hdd: number;
    total_cdd: number;
    monthly_data: MonthlyDegreeDay[];
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const loadData = useCallback(async () => {
    if (!selectedStation) return;
    setLoading(true);
    try {
      const res = await apiClient.get(
        `/api/v1/weather/degree-days?station_id=${selectedStation}&start_date=${year}-01-01&end_date=${year}-12-31`
      );
      setData(res.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [selectedStation, year]);

  useEffect(() => {
    if (selectedStation) loadData();
  }, [loadData, selectedStation]);

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex gap-4 items-end">
          <div>
            <label className="label">Station</label>
            <select
              className="input w-56"
              value={selectedStation}
              onChange={(e) => onSelectStation(e.target.value)}
            >
              <option value="">– Station wählen –</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Jahr</label>
            <select className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <button onClick={loadData} className="btn-primary" disabled={loading}>
            {loading ? 'Laden...' : 'Anzeigen'}
          </button>
        </div>
      </div>

      {data && (
        <>
          {/* Zusammenfassung */}
          <div className="grid grid-cols-2 gap-4">
            <div className="card text-center">
              <div className="text-3xl font-bold text-orange-600">{data.total_hdd.toFixed(0)}</div>
              <div className="text-sm text-gray-500 mt-1">Heizgradtage (Gt20/15)</div>
            </div>
            <div className="card text-center">
              <div className="text-3xl font-bold text-blue-600">{data.total_cdd.toFixed(0)}</div>
              <div className="text-sm text-gray-500 mt-1">Kühlgradtage</div>
            </div>
          </div>

          {/* Monatstabelle */}
          {data.monthly_data.length > 0 && (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-sm">
                <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">Monat</th>
                    <th className="px-4 py-2 text-right">HDD</th>
                    <th className="px-4 py-2 text-right">CDD</th>
                    <th className="px-4 py-2 text-right">T_avg (°C)</th>
                    <th className="px-4 py-2 text-right">Heiztage</th>
                    <th className="px-4 py-2 text-right">Langzeit-Mittel HDD</th>
                    <th className="px-4 py-2 text-right">Abweichung</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.monthly_data.map((m) => {
                    const deviation =
                      m.long_term_avg_hdd != null
                        ? ((m.heating_degree_days - m.long_term_avg_hdd) / m.long_term_avg_hdd) * 100
                        : null;
                    return (
                      <tr key={m.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 font-medium">{MONTHS[m.month - 1]} {m.year}</td>
                        <td className="px-4 py-2 text-right font-mono">{m.heating_degree_days.toFixed(1)}</td>
                        <td className="px-4 py-2 text-right font-mono">{m.cooling_degree_days.toFixed(1)}</td>
                        <td className="px-4 py-2 text-right font-mono">{m.avg_temperature.toFixed(1)}</td>
                        <td className="px-4 py-2 text-right">{m.heating_days}</td>
                        <td className="px-4 py-2 text-right font-mono text-gray-500">
                          {m.long_term_avg_hdd?.toFixed(1) ?? '–'}
                        </td>
                        <td className="px-4 py-2 text-right font-mono">
                          {deviation != null ? (
                            <span className={deviation > 0 ? 'text-red-500' : 'text-green-600'}>
                              {deviation > 0 ? '+' : ''}{deviation.toFixed(1)} %
                            </span>
                          ) : '–'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Balkendiagramm (einfach, CSS-basiert) */}
          {data.monthly_data.length > 0 && (
            <div className="card">
              <h3 className="mb-3 text-sm font-semibold">Heizgradtage pro Monat</h3>
              <div className="flex items-end gap-1 h-40">
                {data.monthly_data.map((m) => {
                  const maxHDD = Math.max(...data.monthly_data.map((d) => d.heating_degree_days), 1);
                  const height = (m.heating_degree_days / maxHDD) * 100;
                  return (
                    <div key={m.id} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-[10px] text-gray-500 font-mono">
                        {m.heating_degree_days > 0 ? m.heating_degree_days.toFixed(0) : ''}
                      </div>
                      <div
                        className="w-full rounded-t bg-orange-400"
                        style={{ height: `${height}%`, minHeight: m.heating_degree_days > 0 ? '2px' : '0' }}
                      />
                      <div className="text-[10px] text-gray-500">{MONTHS[m.month - 1]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Witterungskorrektur ──

function CorrectionPanel() {
  const [configs, setConfigs] = useState<CorrectionConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<CorrectionConfig[]>('/api/v1/weather/correction/configs');
        setConfigs(res.data);
      } catch {
        // Interceptor
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="card">
      <h2 className="mb-3 text-base font-semibold">Witterungskorrektur-Konfigurationen</h2>
      <p className="mb-4 text-sm text-gray-500">
        Witterungskorrektur normalisiert den Heizenergieverbrauch auf ein Referenzklima (VDI 3807).
        Ein milder Winter braucht weniger Heizenergie – ohne Korrektur sieht das fälschlich nach Einsparung aus.
      </p>

      {loading ? (
        <p className="text-gray-400">Laden...</p>
      ) : configs.length === 0 ? (
        <p className="text-gray-400">
          Keine Witterungskorrektur konfiguriert. Aktivieren Sie die Witterungskorrektur bei den
          betroffenen Heizungszählern.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Zähler-ID</th>
                <th className="px-4 py-2 text-left">Methode</th>
                <th className="px-4 py-2 text-right">Innentemp.</th>
                <th className="px-4 py-2 text-right">Heizgrenze</th>
                <th className="px-4 py-2 text-right">Grundlast %</th>
                <th className="px-4 py-2 text-right">Referenz-HDD</th>
                <th className="px-4 py-2 text-center">Aktiv</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {configs.map((c) => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs">{c.meter_id.slice(0, 8)}...</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {c.method === 'degree_day' ? 'VDI 3807' : c.method}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">{c.indoor_temp} °C</td>
                  <td className="px-4 py-2 text-right">{c.heating_limit} °C</td>
                  <td className="px-4 py-2 text-right">{c.base_load_percent ?? '–'} %</td>
                  <td className="px-4 py-2 text-right font-mono">{c.reference_hdd ?? 'auto'}</td>
                  <td className="px-4 py-2 text-center">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

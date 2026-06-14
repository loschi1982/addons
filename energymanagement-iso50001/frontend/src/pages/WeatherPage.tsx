import { useEffect, useState, useCallback } from 'react';
import {
  Thermometer,
  Flame,
  RadioTower,
  SlidersHorizontal,
  Calendar,
  Info,
  BarChart3,
  Table as TableIcon,
  Download,
  Check,
  RefreshCw,
  Snowflake,
  TrendingDown,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import InfoTip from '@/components/ui/InfoTip';
import PageHead from '@/components/ui/PageHead';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PeriodNavigator from '@/components/ui/PeriodNavigator';
import { type PeriodValue, initialPeriod } from '@/utils/period';
import MultiLine from '@/components/umwelt/MultiLine';
import MonthBars from '@/components/umwelt/MonthBars';

// ── Typen ──

interface WeatherStation {
  id: string;
  name: string;
  dwd_station_id: string;
  latitude: number;
  longitude: number;
  altitude: number | null;
  distance_km: number | null;
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

interface DegreeDayResult {
  station_name?: string;
  total_hdd: number;
  total_cdd: number;
  monthly_data: MonthlyDegreeDay[];
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

type Tab = 'data' | 'degree-days' | 'stations' | 'correction';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
const nf = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n: number, d = 1) =>
  (n > 0 ? '+' : '') + Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';

const TABS: Array<{ id: Tab; label: string; icon: typeof Thermometer; badge?: number }> = [
  { id: 'data', label: 'Wetterdaten', icon: Thermometer },
  { id: 'degree-days', label: 'Gradtagszahlen', icon: Flame },
  { id: 'stations', label: 'Stationen', icon: RadioTower },
  { id: 'correction', label: 'Witterungskorrektur', icon: SlidersHorizontal },
];

// ── Seite ──

export default function WeatherPage() {
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [stations, setStations] = useState<WeatherStation[]>([]);
  const [selectedStation, setSelectedStation] = useState('');

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
    <div className="umwelt">
      <PageHead eyebrow="Umwelt" title="Wetter" />
      <div className="head-lead">
        Wetter- und Gradtagszahl-Daten der DWD-Stationen (via BrightSky) — Grundlage für die
        Witterungsbereinigung des Wärmeverbrauchs nach VDI 3807.
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 14 }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={'tab' + (activeTab === t.id ? ' active' : '')}
              onClick={() => setActiveTab(t.id)}
            >
              <Icon size={14} />
              <span>{t.label}</span>
              {t.badge != null && <span className="tab-badge">{t.badge}</span>}
            </button>
          );
        })}
      </div>

      <div className="content stack" style={{ paddingTop: 16 }}>
        {activeTab === 'data' && (
          <WeatherDataPanel stations={stations} selectedStation={selectedStation} onSelectStation={setSelectedStation} />
        )}
        {activeTab === 'degree-days' && (
          <DegreeDaysPanel stations={stations} selectedStation={selectedStation} onSelectStation={setSelectedStation} />
        )}
        {activeTab === 'stations' && (
          <StationsPanel stations={stations} selectedStation={selectedStation} onSelectStation={setSelectedStation} />
        )}
        {activeTab === 'correction' && <CorrectionPanel />}
      </div>
    </div>
  );
}

// ── Tab 1: Wetterdaten ──

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
  const [period, setPeriod] = useState<PeriodValue>(() => initialPeriod('month'));
  const [fetching, setFetching] = useState(false);
  const [fetchResult, setFetchResult] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!selectedStation) return;
    setLoading(true);
    try {
      const res = await apiClient.get<WeatherRecord[]>(
        `/api/v1/weather/stations/${selectedStation}/data?start_date=${period.start}&end_date=${period.end}`
      );
      setRecords(res.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [selectedStation, period.start, period.end]);

  useEffect(() => {
    if (selectedStation) loadData();
  }, [loadData, selectedStation]);

  const handleFetch = async () => {
    if (!selectedStation) return;
    setFetching(true);
    setFetchResult(null);
    try {
      await apiClient.post(
        `/api/v1/weather/fetch?station_id=${selectedStation}&start_date=${period.start}&end_date=${period.end}`
      );
      setFetchResult('Abruf erfolgreich — Daten aktualisiert.');
      await loadData();
    } catch {
      setFetchResult('Abruf fehlgeschlagen.');
    } finally {
      setFetching(false);
    }
  };

  // Chart-Reihen
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => r.date.slice(5)); // MM-DD
  const meanS = sorted.map((r) => num(r.temp_avg));
  const minS = sorted.map((r) => num(r.temp_min));
  const maxS = sorted.map((r) => num(r.temp_max));
  const latest = sorted[sorted.length - 1];
  const periodHdd = sorted.reduce((a, r) => a + (num(r.heating_degree_days) || 0), 0);
  const temps = meanS.filter((v): v is number => v != null);
  const tMin = temps.length ? Math.min(...sorted.map((r) => num(r.temp_min) ?? num(r.temp_avg) ?? 0)) : 0;
  const tMax = temps.length ? Math.max(...sorted.map((r) => num(r.temp_max) ?? num(r.temp_avg) ?? 0)) : 0;
  const xEvery = Math.max(1, Math.ceil(labels.length / 14));

  return (
    <div className="stack">
      {/* Steuerung */}
      <div className="toolbar-card">
        <div className="field">
          <label className="field-label">Station</label>
          <select className="uselect" value={selectedStation} onChange={(e) => onSelectStation(e.target.value)}>
            <option value="">– Station wählen –</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Zeitraum</label>
          <PeriodNavigator value={period} onChange={setPeriod} />
        </div>
        <button className="btn-primary" onClick={loadData} disabled={loading || !selectedStation}>
          {loading ? 'Laden…' : 'Anzeigen'}
        </button>
        <button className="btn-ghost" onClick={handleFetch} disabled={fetching || !selectedStation}>
          <Download size={14} />
          {fetching ? 'Abrufen…' : 'Vom DWD abrufen'}
        </button>
      </div>

      {fetchResult && (
        <div className="result-banner">
          <div className="result-icon"><Check size={18} /></div>
          <div style={{ flex: 1 }}><div className="result-headline">{fetchResult}</div></div>
        </div>
      )}

      {/* KPIs */}
      {latest && (
        <div className="kpi-strip">
          <div className="kpi-cell accent" style={{ ['--accent' as string]: 'var(--fw-kaelte)' }}>
            <div className="kpi-label"><span className="ico"><Thermometer size={13} /></span>Letzter Tag</div>
            <div className="kpi-value">{nf(num(latest.temp_avg), 1)}<span className="unit">°C Ø</span></div>
            <div className="kpi-foot">{new Date(latest.date).toLocaleDateString('de-DE')}</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label"><span className="ico"><Snowflake size={13} /></span>Spanne im Zeitraum</div>
            <div className="kpi-value" style={{ fontSize: 22 }}>
              {nf(tMin, 1)}–{nf(tMax, 1)}<span className="unit">°C</span>
            </div>
            <div className="kpi-foot">Min/Max Tagestemperaturen</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label"><span className="ico"><Flame size={13} /></span>Heizgradtage</div>
            <div className="kpi-value">{nf(periodHdd, 0)}<span className="unit">Kd</span></div>
            <div className="kpi-foot">Summe im Zeitraum</div>
          </div>
          <div className="kpi-cell">
            <div className="kpi-label"><span className="ico"><Calendar size={13} /></span>Tageswerte</div>
            <div className="kpi-value">{records.length}</div>
            <div className="kpi-foot">Messtage geladen</div>
          </div>
        </div>
      )}

      {/* Temperaturverlauf */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title"><span className="ico"><Thermometer size={15} /></span>Temperaturverlauf</div>
            <div className="card-sub">Min / Mittel / Max je Tag. Heizbereich unter 15 °C markiert.</div>
          </div>
          <div className="legend-row">
            <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-fernwaerme)' }} />Max</span>
            <span className="legend-mini"><span className="dot" style={{ background: 'var(--ink-2)' }} />Mittel</span>
            <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-kaelte)' }} />Min</span>
          </div>
        </div>
        {loading ? (
          <LoadingSpinner />
        ) : sorted.length > 0 ? (
          <>
            <MultiLine
              series={[
                { key: 'max', label: 'Max', color: 'var(--fw-fernwaerme)', data: maxS, unit: '°C' },
                { key: 'mean', label: 'Mittel', color: 'var(--ink-2)', data: meanS, unit: '°C' },
                { key: 'min', label: 'Min', color: 'var(--fw-kaelte)', data: minS, unit: '°C' },
              ]}
              labels={labels}
              yUnit="°C"
              decimals={1}
              height={300}
              xTickEvery={xEvery}
              bands={[{ from: tMin < 15 ? tMin : 15, to: 15, color: 'var(--fw-fernwaerme)', opacity: 0.06 }]}
            />
            <div className="chart-foot">
              <span className="legend-mini">
                <span
                  className="sw"
                  style={{ width: 14, height: 9, borderRadius: 2, display: 'inline-block', background: 'color-mix(in srgb, var(--fw-fernwaerme) 18%, transparent)' }}
                />
                Heizbereich &lt; 15 °C
              </span>
              <span className="chart-note" style={{ marginLeft: 'auto' }}>BrightSky / DWD</span>
            </div>
          </>
        ) : (
          <div className="empty-state">
            <div className="mark"><Thermometer size={20} /></div>
            <strong>Keine Wetterdaten</strong>
            <p>Für den gewählten Zeitraum liegen keine Messwerte vor. Rufe Daten über „Vom DWD abrufen" ab.</p>
          </div>
        )}
      </div>

      {/* Tageswerte */}
      {sorted.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head" style={{ padding: '16px 16px 0' }}>
            <div className="card-title"><span className="ico"><Calendar size={15} /></span>Tageswerte</div>
            <span className="scope-tag">{records.length} Tage</span>
          </div>
          <div className="dtable-wrap" style={{ border: 'none', maxHeight: 460, overflowY: 'auto' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Datum</th>
                  <th className="num">Min</th>
                  <th className="num">Mittel</th>
                  <th className="num">Max</th>
                  <th className="num">HGT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...sorted].reverse().map((r) => {
                  const mean = num(r.temp_avg);
                  const hgt = num(r.heating_degree_days) || 0;
                  return (
                    <tr key={r.id}>
                      <td className="cell-name mono">{new Date(r.date).toLocaleDateString('de-DE')}</td>
                      <td className="num">{nf(num(r.temp_min), 1)}</td>
                      <td className="num strong">{nf(mean, 1)}</td>
                      <td className="num">{nf(num(r.temp_max), 1)}</td>
                      <td className="num">
                        {hgt > 0 ? <span style={{ color: 'var(--fw-fernwaerme)' }}>{nf(hgt, 1)}</span> : <span className="muted">0</span>}
                      </td>
                      <td>
                        {hgt > 0 ? (
                          <span className="metric-status st-warn"><span className="dot st-warn-bg" />Heiztag</span>
                        ) : (
                          <span className="metric-status st-good"><span className="dot st-good-bg" />frei</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="dtable-foot">Heizgradtage aus DWD-Tagesmitteln · Heizgrenze 15 °C</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Gradtagszahlen ──

function DegreeDaysPanel({
  stations,
  selectedStation,
  onSelectStation,
}: {
  stations: WeatherStation[];
  selectedStation: string;
  onSelectStation: (id: string) => void;
}) {
  const [data, setData] = useState<DegreeDayResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [year, setYear] = useState(new Date().getFullYear());

  const loadData = useCallback(async () => {
    if (!selectedStation) return;
    setLoading(true);
    try {
      const res = await apiClient.get<DegreeDayResult>(
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

  const monthly = data?.monthly_data ?? [];
  const totalHdd = num(data?.total_hdd) || 0;
  const totalCdd = num(data?.total_cdd) || 0;
  const normTotal = monthly.reduce((a, m) => a + (num(m.long_term_avg_hdd) || 0), 0);
  const deviation = normTotal > 0 ? ((totalHdd - normTotal) / normTotal) * 100 : null;

  // Monatsreihen für MonthBars
  const istArr = monthly.map((m) => num(m.heating_degree_days) || 0);
  const normArr = monthly.map((m) => num(m.long_term_avg_hdd) || 0);
  const lbl = monthly.map((m) => MONTHS[m.month - 1]);
  const hasNorm = normArr.some((v) => v > 0);

  return (
    <div className="stack">
      <div className="toolbar-card">
        <div className="field">
          <label className="field-label">Station</label>
          <select className="uselect" value={selectedStation} onChange={(e) => onSelectStation(e.target.value)}>
            <option value="">– Station wählen –</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">Jahr</label>
          <select className="uselect" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="card"><LoadingSpinner /></div>
      ) : !data ? (
        <div className="card text-gray-400">Keine Daten verfügbar.</div>
      ) : (
        <>
          {/* KPIs */}
          <div className="kpi-strip">
            <div className="kpi-cell accent" style={{ ['--accent' as string]: 'var(--fw-fernwaerme)' }}>
              <div className="kpi-label">
                <span className="ico"><Flame size={13} /></span>Heizgradtage
                <InfoTip title="Heizgradtage (HDD)" formula="Σ max(0, 15 − T_avg) pro Tag">
                  Maß für den Heizenergiebedarf. Je höher, desto kälter die Periode.
                </InfoTip>
              </div>
              <div className="kpi-value">{nf(totalHdd, 0)}<span className="unit">Kd</span></div>
              <div className="kpi-foot">{year} · Basis Gt 20/15</div>
            </div>
            <div className="kpi-cell">
              <div className="kpi-label"><span className="ico"><BarChart3 size={13} /></span>Normaljahr</div>
              <div className="kpi-value">{hasNorm ? nf(normTotal, 0) : '–'}<span className="unit">Kd</span></div>
              <div className="kpi-foot">langjähriges Mittel</div>
            </div>
            <div className="kpi-cell">
              <div className="kpi-label"><span className="ico"><TrendingDown size={13} /></span>Abweichung</div>
              <div className="kpi-value" style={{ fontSize: 24 }}>
                {deviation != null ? fmtPct(deviation) : '–'}
              </div>
              <div className="kpi-foot">
                {deviation != null && (
                  <span className={'kpi-delta ' + (deviation < 0 ? 'good' : 'bad')}>
                    {deviation < 0 ? 'milder' : 'kälter'}
                  </span>
                )}
                {deviation != null ? ' als das Mittel' : 'kein Referenzwert'}
              </div>
            </div>
            <div className="kpi-cell">
              <div className="kpi-label"><span className="ico"><Snowflake size={13} /></span>Kühlgradtage</div>
              <div className="kpi-value">{nf(totalCdd, 0)}<span className="unit">Kd</span></div>
              <div className="kpi-foot">{year} · Basis 24 °C</div>
            </div>
          </div>

          {/* MonthBars */}
          {monthly.length > 0 && (
            <div className="card">
              <div className="card-head">
                <div>
                  <div className="card-title">
                    <span className="ico"><BarChart3 size={15} /></span>Heizgradtage je Monat — {year}
                    {hasNorm && <> vs. Normaljahr</>}
                  </div>
                  <div className="card-sub">VDI 3807. Liegt die IST-Kurve unter dem Normaljahr, war der Monat milder.</div>
                </div>
                {hasNorm && (
                  <div className="legend-row">
                    <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-fernwaerme)' }} />IST {year}</span>
                    <span className="legend-mini"><span className="dot" style={{ background: 'var(--ink-4)' }} />Normaljahr</span>
                  </div>
                )}
              </div>
              <MonthBars
                data={istArr}
                prev={hasNorm ? normArr : null}
                months={lbl}
                color="var(--fw-fernwaerme)"
                prevColor="var(--ink-4)"
                unit="Kd"
                decimals={0}
                height={300}
                tipTitle={(m) => m + ' ' + year + ' · HGT'}
              />
              {hasNorm && (
                <div className="chart-foot">
                  <span>YTD <span className="strong">{nf(totalHdd, 0)} Kd</span> vs. {nf(normTotal, 0)} Kd Norm</span>
                  <span className="muted">·</span>
                  <span>
                    <span className="strong">{nf(Math.abs(normTotal - totalHdd), 0)} Kd</span>{' '}
                    {totalHdd < normTotal ? 'weniger' : 'mehr'} Heizbedarf
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Monatsbilanz */}
          {monthly.length > 0 && (
            <div className="card" style={{ padding: 0 }}>
              <div className="card-head" style={{ padding: '16px 16px 0' }}>
                <div className="card-title"><span className="ico"><TableIcon size={15} /></span>Monatsbilanz Gradtagszahlen</div>
              </div>
              <div className="dtable-wrap" style={{ border: 'none' }}>
                <table className="dtable">
                  <thead>
                    <tr>
                      <th>Monat</th>
                      <th className="num">IST {year}</th>
                      <th className="num">Ø Temp.</th>
                      <th className="num">Heiztage</th>
                      <th className="num">Normaljahr</th>
                      <th className="num">Abw. v. Norm</th>
                      <th>Bewertung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthly.map((m) => {
                      const ist = num(m.heating_degree_days) || 0;
                      const norm = num(m.long_term_avg_hdd);
                      const dev = norm != null && norm > 0 ? ((ist - norm) / norm) * 100 : null;
                      return (
                        <tr key={m.id}>
                          <td className="cell-name">{MONTHS[m.month - 1]} {m.year}</td>
                          <td className="num strong">{nf(ist, 0)}</td>
                          <td className="num">{nf(num(m.avg_temperature), 1)} °C</td>
                          <td className="num">{m.heating_days}</td>
                          <td className="num" style={{ color: 'var(--ink-3)' }}>{norm != null ? nf(norm, 0) : '—'}</td>
                          <td className="num">
                            {dev != null ? <span className={dev < 0 ? 'good' : 'bad'}>{fmtPct(dev)}</span> : <span className="muted">—</span>}
                          </td>
                          <td>
                            {dev == null ? (
                              <span className="muted">—</span>
                            ) : dev < 0 ? (
                              <span className="metric-status st-good"><span className="dot st-good-bg" />milder</span>
                            ) : (
                              <span className="metric-status st-alert"><span className="dot st-alert-bg" />kälter</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="dtable-foot">Einheit Kelvin-Tage (Kd) · Basis 20/15 °C nach VDI 3807 · Quelle DWD</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Tab 3: Stationen ──

function StationsPanel({
  stations,
  selectedStation,
  onSelectStation,
}: {
  stations: WeatherStation[];
  selectedStation: string;
  onSelectStation: (id: string) => void;
}) {
  const [period, setPeriod] = useState<PeriodValue>(() => initialPeriod('month'));
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const handleFetch = async () => {
    if (!selectedStation) return;
    setFetching(true);
    setResult(null);
    try {
      await apiClient.post(
        `/api/v1/weather/fetch?station_id=${selectedStation}&start_date=${period.start}&end_date=${period.end}`
      );
      setResult({ ok: true, msg: 'DWD-Abruf erfolgreich abgeschlossen.' });
    } catch {
      setResult({ ok: false, msg: 'DWD-Abruf fehlgeschlagen.' });
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="stack">
      <div className="card" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: '16px 16px 0' }}>
          <div>
            <div className="card-title"><span className="ico"><RadioTower size={15} /></span>Wetterstationen</div>
            <div className="card-sub">DWD-Stationen via BrightSky-Integration (Open Data). Auswahl steuert den Datenabruf.</div>
          </div>
          <span className="scope-tag">{stations.length} Stationen</span>
        </div>
        {stations.length === 0 ? (
          <div className="empty-state">
            <div className="mark"><RadioTower size={20} /></div>
            <strong>Keine Stationen konfiguriert</strong>
            <p>Wetterstationen werden per Seed-Daten oder manuell angelegt.</p>
          </div>
        ) : (
          <div className="dtable-wrap" style={{ border: 'none', maxHeight: 520, overflowY: 'auto' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Station</th>
                  <th className="num">Höhe</th>
                  <th className="num">Entfernung</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s) => (
                  <tr key={s.id} style={s.id === selectedStation ? { background: 'var(--surface-2)' } : undefined}>
                    <td>
                      <div className="cell-name">{s.name}</div>
                      <div className="cell-sub mono">
                        DWD {s.dwd_station_id} · {Number(s.latitude).toFixed(3)} N, {Number(s.longitude).toFixed(3)} O
                      </div>
                    </td>
                    <td className="num">{s.altitude != null ? `${Number(s.altitude).toFixed(0)} m` : '—'}</td>
                    <td className="num">{s.distance_km != null ? `${Number(s.distance_km).toFixed(1)} km` : '—'}</td>
                    <td className="num">
                      <a className="row-action" onClick={() => onSelectStation(s.id)}>
                        {s.id === selectedStation ? 'gewählt' : 'auswählen'}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dtable-foot">Bezug via BrightSky-Integration (DWD Open Data)</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="ico"><RefreshCw size={15} /></span>DWD-Daten abrufen</div>
        </div>
        <div className="toolbar-card" style={{ marginBottom: 14 }}>
          <div className="field grow">
            <label className="field-label">Station</label>
            <select className="uselect" value={selectedStation} onChange={(e) => onSelectStation(e.target.value)}>
              <option value="">– Station wählen –</option>
              {stations.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label">Zeitraum</label>
            <PeriodNavigator value={period} onChange={setPeriod} />
          </div>
          <button className="btn-primary" onClick={handleFetch} disabled={fetching || !selectedStation}>
            <Download size={14} />
            {fetching ? 'Abrufen…' : 'Jetzt abrufen'}
          </button>
        </div>
        {result && (
          <div className={'result-banner' + (result.ok ? '' : ' warn')}>
            <div className="result-icon">{result.ok ? <Check size={18} /> : <Info size={18} />}</div>
            <div style={{ flex: 1 }}>
              <div className="result-headline">{result.msg}</div>
              <div className="result-sub">{period.start} – {period.end}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab 4: Witterungskorrektur ──

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

  const active = configs.filter((c) => c.is_active).length;

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">
              <span className="ico"><SlidersHorizontal size={15} /></span>Witterungsbereinigung (VDI 3807)
              <InfoTip title="Witterungskorrektur" formula="Korr. = Grundlast + (V − Grundlast) × HGT_ref ÷ HGT_ist">
                Normalisiert den Heizenergieverbrauch auf ein Referenzklima, um witterungsbedingte Schwankungen auszugleichen.
              </InfoTip>
            </div>
            <div className="card-sub">
              Rechnet den Wärmeverbrauch auf ein durchschnittliches Wetterjahr um — für faire Vorjahres- und
              Benchmark-Vergleiche. Aktivierung erfolgt je Heizungszähler.
            </div>
          </div>
          <span className="scope-tag">{active} aktiv</span>
        </div>
      </div>

      {loading ? (
        <div className="card"><LoadingSpinner /></div>
      ) : configs.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="mark"><SlidersHorizontal size={20} /></div>
            <strong>Keine Witterungskorrektur konfiguriert</strong>
            <p>
              Aktiviere die Witterungskorrektur bei den betroffenen Heizungszählern. Sobald eine Konfiguration
              angelegt ist, erscheint sie hier mit Methode, Innentemperatur, Heizgrenze und Referenz-HGT.
            </p>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head" style={{ padding: '16px 16px 0' }}>
            <div className="card-title"><span className="ico"><TableIcon size={15} /></span>Konfigurationen je Zähler</div>
          </div>
          <div className="dtable-wrap" style={{ border: 'none' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Zähler</th>
                  <th>Methode</th>
                  <th className="num">Innentemp.</th>
                  <th className="num">Heizgrenze</th>
                  <th className="num">Grundlast</th>
                  <th className="num">Referenz-HGT</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {configs.map((c) => (
                  <tr key={c.id}>
                    <td className="cell-name mono">{c.meter_id.slice(0, 8)}…</td>
                    <td><span className="scope-tag">{c.method === 'degree_day' ? 'VDI 3807' : c.method}</span></td>
                    <td className="num">{c.indoor_temp} °C</td>
                    <td className="num">{c.heating_limit} °C</td>
                    <td className="num">{c.base_load_percent != null ? `${c.base_load_percent} %` : '—'}</td>
                    <td className="num mono">{c.reference_hdd ?? 'auto'}</td>
                    <td>
                      {c.is_active ? (
                        <span className="metric-status st-good"><span className="dot st-good-bg" />aktiv</span>
                      ) : (
                        <span className="metric-status"><span className="dot" style={{ background: 'var(--ink-4)' }} />inaktiv</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dtable-foot">{configs.length} Konfigurationen · {active} aktiv</div>
          </div>
        </div>
      )}
    </div>
  );
}

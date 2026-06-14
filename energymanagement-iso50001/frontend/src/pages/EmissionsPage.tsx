import { useEffect, useState, useCallback } from 'react';
import {
  Leaf,
  SlidersHorizontal,
  Calculator,
  Plus,
  Info,
  BarChart3,
  Layers,
  Table as TableIcon,
  Factory,
  Zap,
  Check,
  Play,
  RefreshCw,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import InfoTip from '@/components/ui/InfoTip';
import { ENERGY_TYPE_LABELS } from '@/types';
import { EM_ENERGY, resolveEnergyKey } from '@/utils/energyPalette';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';
import EnergyChip from '@/components/ui/EnergyChip';
import PeriodNavigator from '@/components/ui/PeriodNavigator';
import { type PeriodValue, initialPeriod } from '@/utils/period';
import SourceChip from '@/components/umwelt/SourceChip';
import MonthBars from '@/components/umwelt/MonthBars';

// ── Typen ──

interface EmissionFactorSource {
  id: string;
  name: string;
  source_type: string;
  description: string | null;
  url: string | null;
  is_default: boolean;
}

interface EmissionFactor {
  id: string;
  source_id: string;
  energy_type: string;
  year: number;
  month: number | null;
  region: string | null;
  co2_g_per_kwh: number;
  scope: string | null;
  source_name: string | null;
}

interface CO2Summary {
  period_start: string;
  period_end: string;
  total_co2_kg: number;
  total_consumption_kwh: number;
  avg_co2_g_per_kwh: number;
  by_energy_type: Array<{ energy_type: string; co2_kg: number; consumption_kwh: number }>;
  by_scope: Array<{ scope: string; co2_kg: number }>;
  trend_vs_previous: number | null;
}

interface CO2Dashboard {
  current_year: CO2Summary | null;
  previous_year: CO2Summary | null;
  monthly_trend: Array<{ month: number; year: number; co2_kg: number }>;
  scope_breakdown: Record<string, number>;
}

interface FactorForm {
  source_id: string;
  energy_type: string;
  year: string;
  co2_g_per_kwh: string;
  scope: string;
}

type Tab = 'dashboard' | 'factors' | 'calculate';

const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const SCOPE_LABELS: Record<string, string> = {
  scope_1: 'Scope 1 (direkt)',
  scope_2: 'Scope 2 (Strom/Wärme)',
  scope_3: 'Scope 3 (Vorketten)',
};
const SCOPE_SHORT: Record<string, { label: string; note: string; color: string }> = {
  scope_1: { label: 'Scope 1 — Direkt', note: 'Verbrennung vor Ort, Kältemittel', color: '#B45309' },
  scope_2: { label: 'Scope 2 — Energie', note: 'Fernwärme, Strom, Kälte', color: '#E89A3C' },
  scope_3: { label: 'Scope 3 — Vorgelagert', note: 'Wasser, Brennstoffvorketten', color: '#9A968B' },
};

const nf = (n: number | null | undefined, d = 0) =>
  n == null ? '—' : Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPct = (n: number, d = 1) =>
  (n > 0 ? '+' : '') + Number(n).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + ' %';

const TABS: Array<{ id: Tab; label: string; icon: typeof Leaf; badge?: number }> = [
  { id: 'dashboard', label: 'CO₂-Bilanz', icon: Leaf },
  { id: 'factors', label: 'Emissionsfaktoren', icon: SlidersHorizontal },
  { id: 'calculate', label: 'Berechnung', icon: Calculator },
];

// ── Seite ──

export default function EmissionsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');

  return (
    <div className="umwelt">
      <PageHead eyebrow="Umwelt" title="Emissionen" />
      <div className="head-lead">
        CO₂e-Bilanz nach GHG-Protocol — gespeist aus Zählerdaten und den hinterlegten
        Emissionsfaktoren (BAFA, UBA, Lieferantenwerte). Aggregiert über alle aktiven Hauptzähler.
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
        {activeTab === 'dashboard' && <DashboardPanel />}
        {activeTab === 'factors' && <FactorsPanel />}
        {activeTab === 'calculate' && <CalculatePanel />}
      </div>
    </div>
  );
}

// ── Tab 1: CO₂-Bilanz ──

function DashboardPanel() {
  const [dashboard, setDashboard] = useState<CO2Dashboard | null>(null);
  const [prevMonthly, setPrevMonthly] = useState<number[] | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [cur, prev] = await Promise.all([
        apiClient.get<CO2Dashboard>(`/api/v1/emissions/dashboard?year=${year}`),
        apiClient
          .get<CO2Dashboard>(`/api/v1/emissions/dashboard?year=${year - 1}`)
          .catch(() => null),
      ]);
      setDashboard(cur.data);
      if (prev?.data) {
        const arr = Array(12).fill(0);
        prev.data.monthly_trend.forEach((m) => {
          if (m.month >= 1 && m.month <= 12) arr[m.month - 1] = m.co2_kg / 1000;
        });
        setPrevMonthly(arr);
      } else {
        setPrevMonthly(null);
      }
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (loading) return <div className="card"><LoadingSpinner /></div>;
  if (!dashboard) return <div className="card text-gray-400">Keine Daten verfügbar.</div>;

  const current = dashboard.current_year;
  const previous = dashboard.previous_year;
  const trend = current?.trend_vs_previous ?? null;

  // Monatsreihen (Tonnen)
  const curMonthly = Array(12).fill(0);
  dashboard.monthly_trend.forEach((m) => {
    if (m.month >= 1 && m.month <= 12) curMonthly[m.month - 1] = m.co2_kg / 1000;
  });
  let lastIdx = -1;
  for (let i = 0; i < 12; i++) {
    if (curMonthly[i] > 0 || (prevMonthly && prevMonthly[i] > 0)) lastIdx = i;
  }
  const span = lastIdx >= 0 ? lastIdx + 1 : 12;
  const curData = curMonthly.slice(0, span);
  const prevData = prevMonthly ? prevMonthly.slice(0, span) : null;
  const monthsLbl = MONTHS.slice(0, span);
  const curYtd = curData.reduce((a, b) => a + b, 0);
  const prevYtd = prevData ? prevData.reduce((a, b) => a + b, 0) : 0;
  const saved = prevYtd - curYtd;

  // Scope
  const scopeEntries = Object.entries(dashboard.scope_breakdown);
  const scopeMax = Math.max(...scopeEntries.map(([, v]) => v), 1);
  const scopeTotal = scopeEntries.reduce((a, [, v]) => a + v, 0);

  // Energieträger
  const carriers = current?.by_energy_type ?? [];
  const carrierMax = Math.max(...carriers.map((c) => c.co2_kg), 1);
  const carrierTotal = carriers.reduce((a, c) => a + c.co2_kg, 0);

  return (
    <div className="stack">
      {/* Jahr-Auswahl */}
      <div className="toolbar-card">
        <div className="field">
          <label className="field-label">Berichtsjahr</label>
          <select className="uselect" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI-Strip */}
      <div className="kpi-strip">
        <div className="kpi-cell accent" style={{ ['--accent' as string]: 'var(--fw-fernwaerme)' }}>
          <div className="kpi-label">
            <span className="ico"><Leaf size={13} /></span>CO₂e gesamt
            <InfoTip title="CO₂e gesamt" formula="Σ (Verbrauch_kWh × Faktor_g/kWh) ÷ 1000">
              Summe aller Zähler im gewählten Jahr. Emissionsfaktor je Energieträger aus BAFA/UBA/Lieferant.
            </InfoTip>
          </div>
          <div className="kpi-value">
            {current ? nf(current.total_co2_kg / 1000, 1) : '0'}<span className="unit">t CO₂e</span>
          </div>
          <div className="kpi-foot">
            {trend != null ? (
              <>
                <span className={'kpi-delta ' + (trend < 0 ? 'good' : 'bad')}>{fmtPct(trend)}</span>
                ggü. Vorjahr
              </>
            ) : (
              <span>kein Vorjahresvergleich</span>
            )}
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label"><span className="ico"><Factory size={13} /></span>Verbrauch gesamt</div>
          <div className="kpi-value">
            {current ? nf(current.total_consumption_kwh / 1000, 0) : '0'}<span className="unit">MWh</span>
          </div>
          <div className="kpi-foot">über alle aktiven Hauptzähler</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label"><span className="ico"><Zap size={13} /></span>Ø Faktor</div>
          <div className="kpi-value">
            {current ? nf(current.avg_co2_g_per_kwh, 0) : '–'}<span className="unit">g/kWh</span>
          </div>
          <div className="kpi-foot">gewichtet über den Energiemix</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label"><span className="ico"><BarChart3 size={13} /></span>Vorjahr</div>
          <div className="kpi-value">
            {previous ? nf(previous.total_co2_kg / 1000, 1) : '–'}<span className="unit">t CO₂e</span>
          </div>
          <div className="kpi-foot">Bilanz {year - 1}</div>
        </div>
      </div>

      <div className="row-2col">
        {/* Monatsverlauf */}
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">
                <span className="ico"><BarChart3 size={15} /></span>CO₂e je Monat — {year}
                {prevData && <> vs. {year - 1}</>}
              </div>
              <div className="card-sub">Aus den hinterlegten Zählerwerten berechnete Monatsbilanz.</div>
            </div>
            {prevData && (
              <div className="legend-row">
                <span className="legend-mini"><span className="dot" style={{ background: 'var(--fw-fernwaerme)' }} />{year}</span>
                <span className="legend-mini"><span className="dot" style={{ background: 'var(--ink-4)' }} />{year - 1}</span>
              </div>
            )}
          </div>
          {curData.some((v) => v > 0) ? (
            <>
              <MonthBars
                data={curData}
                prev={prevData}
                months={monthsLbl}
                color="var(--fw-fernwaerme)"
                unit="t CO₂e"
                decimals={1}
                height={300}
                tipTitle={(m) => m + ' ' + year}
              />
              {prevData && saved !== 0 && (
                <div className="chart-foot">
                  <span>
                    <span className="strong">
                      {saved > 0 ? '−' : '+'}{nf(Math.abs(saved), 1)} t
                    </span>{' '}
                    {saved > 0 ? 'eingespart' : 'mehr'} ggü. Vorjahreszeitraum
                  </span>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="mark"><BarChart3 size={20} /></div>
              <strong>Noch keine Monatsdaten</strong>
              <p>Für {year} liegen keine berechneten CO₂-Werte vor. Starte eine Neuberechnung im Tab „Berechnung".</p>
            </div>
          )}
        </div>

        {/* Scope-Aufschlüsselung */}
        <div className="card">
          <div className="card-head">
            <div className="card-title"><span className="ico"><Layers size={15} /></span>Nach Scope</div>
          </div>
          {scopeEntries.length > 0 ? (
            <>
              <div className="share-list">
                {scopeEntries.map(([scope, co2]) => {
                  const meta = SCOPE_SHORT[scope] || { label: scope, note: '', color: 'var(--ink-4)' };
                  return (
                    <div className="share-row" key={scope} style={{ gridTemplateColumns: '1fr 64px' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="share-name" style={{ marginBottom: 6 }}>
                          <span className="dot" style={{ background: meta.color }} />{meta.label}
                        </div>
                        <div className="share-track" style={{ height: 14 }}>
                          <div className="share-fill" style={{ width: `${(co2 / scopeMax) * 100}%`, background: meta.color }} />
                        </div>
                        {meta.note && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 5 }}>{meta.note}</div>}
                      </div>
                      <div className="share-val" style={{ alignSelf: 'start' }}>
                        {nf(co2 / 1000, 1)}
                        <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 400 }}>t CO₂e</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-foot">
                <span className="strong">{nf(scopeTotal / 1000, 1)} t CO₂e</span>
                <span className="muted">gesamt · {year}</span>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <div className="mark"><Layers size={20} /></div>
              <strong>Keine Scope-Daten</strong>
              <p>Sobald Emissionen berechnet sind, erscheint hier die Aufteilung nach GHG-Scopes.</p>
            </div>
          )}
        </div>
      </div>

      {/* Energieträger-Tabelle */}
      {carriers.length > 0 && (
        <div className="card" style={{ padding: 0 }}>
          <div className="card-head" style={{ padding: '16px 16px 0' }}>
            <div className="card-title"><span className="ico"><TableIcon size={15} /></span>Emissionen nach Energieträger</div>
            <div className="card-controls"><span className="scope-tag">{year}</span></div>
          </div>
          <div className="dtable-wrap" style={{ border: 'none' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Energieträger</th>
                  <th className="num">Verbrauch</th>
                  <th className="num">Ø Faktor</th>
                  <th className="num">Anteil</th>
                  <th className="num">CO₂e</th>
                </tr>
              </thead>
              <tbody>
                {[...carriers]
                  .sort((a, b) => b.co2_kg - a.co2_kg)
                  .map((c) => {
                    const factor = c.consumption_kwh > 0 ? (c.co2_kg * 1000) / c.consumption_kwh : 0;
                    const pct = carrierTotal > 0 ? (c.co2_kg / carrierTotal) * 100 : 0;
                    const key = resolveEnergyKey(c.energy_type);
                    const color = key ? EM_ENERGY[key].color : 'var(--ink-4)';
                    return (
                      <tr key={c.energy_type}>
                        <td><EnergyChip type={c.energy_type} /></td>
                        <td className="num">
                          {nf(c.consumption_kwh / 1000, 0)} <span className="muted">MWh</span>
                        </td>
                        <td className="num">
                          {nf(factor, 0)} <span className="muted">g/kWh</span>
                        </td>
                        <td className="num">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                            <div className="share-track" style={{ width: 60, height: 6 }}>
                              <div className="share-fill" style={{ width: `${(c.co2_kg / carrierMax) * 100}%`, background: color }} />
                            </div>
                            {nf(pct, 1)}%
                          </div>
                        </td>
                        <td className="num strong">
                          {nf(c.co2_kg / 1000, 1)} <span className="muted">t</span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div className="dtable-foot">
              Summe {nf(carrierTotal / 1000, 1)} t CO₂e · {carriers.length} Energieträger
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 2: Emissionsfaktoren ──

function FactorsPanel() {
  const [sources, setSources] = useState<EmissionFactorSource[]>([]);
  const [factors, setFactors] = useState<EmissionFactor[]>([]);
  const [filterType, setFilterType] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FactorForm>({
    source_id: '',
    energy_type: 'electricity',
    year: new Date().getFullYear().toString(),
    co2_g_per_kwh: '',
    scope: 'scope_2',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoFilled, setAutoFilled] = useState(false);

  const tryAutoFill = useCallback(
    (sourceId: string, energyType: string, yr: string) => {
      if (!sourceId || !yr) {
        setAutoFilled(false);
        return;
      }
      const sourceName = sources.find((s) => s.id === sourceId)?.name;
      const match = factors.find(
        (f) => f.source_name === sourceName && f.energy_type === energyType && f.year === parseInt(yr)
      );
      if (match) {
        setForm((prev) => ({
          ...prev,
          co2_g_per_kwh: String(Number(match.co2_g_per_kwh)),
          scope: match.scope || 'scope_2',
        }));
        setAutoFilled(true);
      } else {
        setAutoFilled(false);
      }
    },
    [sources, factors]
  );

  const loadFactors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.append('energy_type', filterType);
      if (filterYear) params.append('year', filterYear);
      const [factorsRes, sourcesRes] = await Promise.all([
        apiClient.get<EmissionFactor[]>(`/api/v1/emissions/factors?${params}`),
        apiClient.get<EmissionFactorSource[]>('/api/v1/emissions/factors/sources'),
      ]);
      setFactors(factorsRes.data);
      setSources(sourcesRes.data);
    } catch {
      // Interceptor
    } finally {
      setLoading(false);
    }
  }, [filterType, filterYear]);

  useEffect(() => {
    loadFactors();
  }, [loadFactors]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiClient.post('/api/v1/emissions/factors', {
        source_id: form.source_id,
        energy_type: form.energy_type,
        year: parseInt(form.year),
        co2_g_per_kwh: parseFloat(form.co2_g_per_kwh.replace(',', '.')),
        scope: form.scope,
      });
      setShowModal(false);
      loadFactors();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {/* Quellen & Methodik */}
      {sources.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title"><span className="ico"><Info size={15} /></span>Quellen & Methodik</div>
          </div>
          <div className="stack" style={{ gap: 0 }}>
            {sources.map((s) => (
              <div className="method-row" key={s.id}>
                <div style={{ flexShrink: 0, marginTop: 1 }}>
                  <SourceChip source={s.source_type} label={s.name} />
                </div>
                <div>
                  <div className="mtitle">
                    {s.name}
                    {s.is_default && <span className="scope-tag" style={{ marginLeft: 8 }}>Standard</span>}
                  </div>
                  {s.description && <div className="mdesc">{s.description}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Faktoren-Tabelle */}
      <div className="card" style={{ padding: 0 }}>
        <div className="card-head" style={{ padding: '16px 16px 0' }}>
          <div className="card-title"><span className="ico"><SlidersHorizontal size={15} /></span>Hinterlegte Emissionsfaktoren</div>
          <div className="card-controls">
            <select className="uselect" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="">Alle Träger</option>
              {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input
              type="number"
              className="uinput mono"
              placeholder="Jahr"
              style={{ width: 92 }}
              value={filterYear}
              onChange={(e) => setFilterYear(e.target.value)}
            />
            <button className="btn-ghost small" onClick={() => setShowModal(true)}>
              <Plus size={14} />Faktor hinzufügen
            </button>
          </div>
        </div>
        {loading ? (
          <div style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : factors.length === 0 ? (
          <div className="empty-state">
            <div className="mark"><SlidersHorizontal size={20} /></div>
            <strong>Keine Emissionsfaktoren gefunden</strong>
            <p>Importieren Sie die BAFA-Standardwerte oder legen Sie über „Faktor hinzufügen" eigene Faktoren an.</p>
          </div>
        ) : (
          <div className="dtable-wrap" style={{ border: 'none' }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Energieträger</th>
                  <th className="num">Wert</th>
                  <th>Scope</th>
                  <th>Quelle</th>
                  <th className="num">Jahr</th>
                </tr>
              </thead>
              <tbody>
                {factors.map((f) => (
                  <tr key={f.id}>
                    <td><EnergyChip type={f.energy_type} /></td>
                    <td className="num strong">
                      {Number(f.co2_g_per_kwh).toFixed(1)} <span className="muted">g/kWh</span>
                    </td>
                    <td><span className="scope-tag">{SCOPE_LABELS[f.scope || ''] || f.scope || '–'}</span></td>
                    <td style={{ color: 'var(--ink-3)' }}>{f.source_name || '–'}</td>
                    <td className="num">{f.year}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="dtable-foot">{factors.length} Faktoren hinterlegt</div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="umodal-overlay" onClick={() => setShowModal(false)}>
          <div className="umwelt-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Neuer Emissionsfaktor</h2>
            <form onSubmit={handleCreate}>
              {formError && <div className="form-err">{formError}</div>}

              <div className="field">
                <label className="field-label">Quelle *</label>
                <select
                  className="uselect"
                  required
                  value={form.source_id}
                  onChange={(e) => {
                    const val = e.target.value;
                    setForm((prev) => ({ ...prev, source_id: val }));
                    tryAutoFill(val, form.energy_type, form.year);
                  }}
                >
                  <option value="">– Quelle wählen –</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="form-grid2">
                <div className="field">
                  <label className="field-label">Energieträger *</label>
                  <select
                    className="uselect"
                    value={form.energy_type}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) => ({ ...prev, energy_type: val }));
                      tryAutoFill(form.source_id, val, form.year);
                    }}
                  >
                    {Object.entries(ENERGY_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field-label">Jahr *</label>
                  <input
                    type="number"
                    className="uinput mono"
                    required
                    value={form.year}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) => ({ ...prev, year: val }));
                      tryAutoFill(form.source_id, form.energy_type, val);
                    }}
                  />
                </div>
              </div>

              <div className="form-grid2">
                <div className="field">
                  <label className="field-label">g CO₂/kWh *</label>
                  <input
                    type="text"
                    className={'uinput mono' + (autoFilled ? ' autofilled' : '')}
                    required
                    placeholder="z. B. 363"
                    value={form.co2_g_per_kwh}
                    onChange={(e) => {
                      setForm({ ...form, co2_g_per_kwh: e.target.value });
                      setAutoFilled(false);
                    }}
                  />
                  {autoFilled && (
                    <span style={{ fontSize: 11, color: 'var(--good)' }}>Automatisch vorausgefüllt aus vorhandenen Daten</span>
                  )}
                </div>
                <div className="field">
                  <label className="field-label">Scope</label>
                  <select
                    className="uselect"
                    value={form.scope}
                    onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  >
                    {Object.entries(SCOPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Speichern…' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab 3: Berechnung ──

function CalculatePanel() {
  const [period, setPeriod] = useState<PeriodValue>(() => initialPeriod('year'));
  const [calculating, setCalculating] = useState(false);
  const [result, setResult] = useState<{ message: string; calculated?: number; errors?: number } | null>(null);

  const handleCalculate = async () => {
    setCalculating(true);
    setResult(null);
    try {
      const res = await apiClient.post(
        `/api/v1/emissions/calculate?start_date=${period.start}&end_date=${period.end}`
      );
      setResult(res.data);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setResult({ message: error.response?.data?.detail || 'Fehler bei der Berechnung' });
    } finally {
      setCalculating(false);
    }
  };

  const hasError = result && result.calculated == null;
  const hasWarn = result && (result.errors ?? 0) > 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title"><span className="ico"><Calculator size={15} /></span>CO₂-Bilanz neu berechnen</div>
          <div className="card-sub">
            Aggregiert alle Zählerwerte des Zeitraums mit den aktuell hinterlegten Emissionsfaktoren.
          </div>
        </div>
      </div>

      <div className="toolbar-card" style={{ marginBottom: 16 }}>
        <div className="field">
          <label className="field-label">Zeitraum</label>
          <PeriodNavigator value={period} onChange={setPeriod} />
        </div>
        <button className="btn-primary" onClick={handleCalculate} disabled={calculating}>
          {calculating ? <RefreshCw size={14} /> : <Play size={14} />}
          {calculating ? 'Berechne…' : 'Neuberechnung starten'}
        </button>
      </div>

      {calculating && (
        <div className="result-banner info">
          <div className="result-icon"><RefreshCw size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="result-headline">Aggregiere Zählerdaten…</div>
            <div className="result-sub">{period.start} – {period.end}</div>
          </div>
        </div>
      )}

      {result && !calculating && (
        <div className={'result-banner' + (hasError ? ' warn' : hasWarn ? ' warn' : '')}>
          <div className="result-icon">{hasError || hasWarn ? <Info size={18} /> : <Check size={18} />}</div>
          <div style={{ flex: 1 }}>
            <div className="result-headline">{hasError ? 'Berechnung fehlgeschlagen' : 'Berechnung abgeschlossen'}</div>
            <div className="result-sub">{result.message}</div>
          </div>
          {result.calculated != null && (
            <div className="result-stats">
              <div className="result-stat">
                <div className="v good">{nf(result.calculated)}</div>
                <div className="l">berechnet</div>
              </div>
              <div className="result-stat">
                <div className={'v' + ((result.errors ?? 0) > 0 ? ' bad' : '')}>{nf(result.errors ?? 0)}</div>
                <div className="l">Fehler</div>
              </div>
            </div>
          )}
        </div>
      )}

      {!result && !calculating && (
        <div className="result-banner info">
          <div className="result-icon"><Info size={18} /></div>
          <div style={{ flex: 1 }}>
            <div className="result-headline">Bereit zur Berechnung</div>
            <div className="result-sub">Wähle einen Zeitraum und starte die Aggregation der Zählerwerte.</div>
          </div>
        </div>
      )}
    </div>
  );
}

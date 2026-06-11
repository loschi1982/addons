/**
 * EconomicsPage – Tab „Wirtschaftlichkeit" von Kosten & Wirtschaft.
 * Amortisationsrechnung für Aktionspläne und Verbraucher-Investitionen.
 * Redesign nach Claude-Design-Handoff (kosten.css, gescopt unter .kosten).
 * Der Cashflow-Verlauf wird client-seitig aus den realen Backend-Kennzahlen
 * (Investition, Netto-Einsparung, Nutzungsdauer, Preissteigerung) mit der
 * dokumentierten Methodik (4 % Kalkulationszins) rekonstruiert.
 */

import { useEffect, useState, useMemo } from 'react';
import { RefreshCw, Info, TrendingUp, Wallet, Coins, Leaf, Clock, List, Plug } from 'lucide-react';
import { apiClient } from '@/utils/api';
import PageTabs, { COST_TABS } from '@/components/layout/PageTabs';
import PageHead from '@/components/ui/PageHead';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

/* ── Typen ── */

interface AmortizationItem {
  type: 'action_plan' | 'consumer';
  id: string;
  title: string;
  objective_title?: string;
  category?: string;
  status: string;
  investment_total: number;
  annual_maintenance_cost: number;
  expected_lifetime_years?: number;
  expected_savings_kwh_pa?: number;
  expected_savings_eur_pa: number;
  expected_savings_co2_kg_pa?: number;
  annual_kwh_estimate?: number;
  price_per_kwh: number;
  price_source: 'invoice' | 'readings' | 'tariff_info' | 'fallback';
  price_increase_rate_pct: number;
  responsible?: string;
  simple_payback_years: number | null;
  dynamic_payback_years: number | null;
  npv: number;
  roi_pct: number;
  annual_savings_net: number;
  break_even_year: number | null;
  profitable: boolean;
}

interface PriceInfo {
  price_per_kwh: number;
  price_source: string;
  price_increase_rate_pct: number;
  source_labels: Record<string, string>;
}

const DISCOUNT_RATE = 0.04;

const STATUS_META: Record<string, { label: string; tone: string }> = {
  planned: { label: 'Geplant', tone: 'neutral' },
  in_progress: { label: 'In Umsetzung', tone: 'warn' },
  completed: { label: 'Abgeschlossen', tone: 'good' },
  cancelled: { label: 'Abgebrochen', tone: 'neutral' },
  active: { label: 'Aktiv', tone: 'good' },
  decommissioned: { label: 'Außer Betrieb', tone: 'neutral' },
};

/* ── Formatierer ── */
const nf = (v: number, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eurShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return nf(v / 1e6, 1) + ' Mio €';
  if (a >= 1000) return nf(Math.round(v / 1000)) + 'k €';
  return nf(Math.round(v)) + ' €';
};
const eurFull = (v: number) => nf(v, 0) + ' €';
const years = (v: number | null) => (v == null ? '—' : nf(v, 1) + ' a');
const kwhShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return nf(v / 1e6, 2) + ' GWh';
  if (a >= 1000) return nf(Math.round(v / 1000)) + ' MWh';
  return nf(Math.round(v)) + ' kWh';
};

/* ── Cashflow-Reihe rekonstruieren ── */
interface CashPoint { year: number; save: number; cum: number; disc: number }
function buildSeries(item: AmortizationItem): CashPoint[] {
  const invest = item.investment_total;
  const annual = item.annual_savings_net;
  const esc = (item.price_increase_rate_pct || 0) / 100;
  const life = Math.max(1, Math.round(item.expected_lifetime_years ?? 20));
  const out: CashPoint[] = [{ year: 0, save: 0, cum: -invest, disc: -invest }];
  let cum = -invest;
  let disc = -invest;
  for (let y = 1; y <= life; y++) {
    const save = annual * Math.pow(1 + esc, y - 1);
    cum += save;
    disc += save / Math.pow(1 + DISCOUNT_RATE, y);
    out.push({ year: y, save, cum, disc });
  }
  return out;
}

/* ── Amortisations-Chart ── */
function AmortChart({ item }: { item: AmortizationItem }) {
  const series = buildSeries(item);
  const life = Math.max(1, Math.round(item.expected_lifetime_years ?? 20));
  const W = 560, H = 248, padL = 62, padR = 18, padT = 16, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;

  const allY = series.flatMap((p) => [p.cum, p.disc]).concat([0]);
  let yMin = Math.min(...allY), yMax = Math.max(...allY);
  const yPad = (yMax - yMin) * 0.08 || 1;
  yMin -= yPad; yMax += yPad;

  const sx = (yr: number) => padL + (yr / life) * iw;
  const sy = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * ih;
  const linePath = (key: 'cum' | 'disc') => series.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.year).toFixed(1)} ${sy(p[key]).toFixed(1)}`).join(' ');
  const cumPath = linePath('cum');
  const areaPath = `${cumPath} L${sx(life).toFixed(1)} ${sy(yMin).toFixed(1)} L${sx(0).toFixed(1)} ${sy(yMin).toFixed(1)} Z`;

  const yTicks: number[] = [];
  const span = yMax - yMin;
  const stepRaw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(stepRaw || 1)));
  const step = Math.ceil(stepRaw / mag) * mag || 1;
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);

  const xStep = life <= 12 ? 2 : life <= 20 ? 4 : 5;
  const xTicks: number[] = [];
  for (let yr = 0; yr <= life; yr += xStep) xTicks.push(yr);
  if (xTicks[xTicks.length - 1] !== life) xTicks.push(life);

  const zeroY = sy(0);
  const pb = item.dynamic_payback_years ?? item.simple_payback_years;
  const pbX = pb != null && pb <= life ? sx(pb) : null;
  const endPoint = series[series.length - 1];

  const fmtAxis = (v: number) => {
    const a = Math.abs(v);
    if (a >= 1e6) return nf(v / 1e6, 1) + 'M';
    if (a >= 1000) return nf(Math.round(v / 1000)) + 'k';
    return String(Math.round(v));
  };

  return (
    <div className="amort-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="amortFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--good)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--good)" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {yTicks.map((v, i) => (
          <g key={'y' + i}>
            <line x1={padL} y1={sy(v)} x2={W - padR} y2={sy(v)} stroke="var(--chart-grid)" strokeWidth="1" />
            <text x={padL - 8} y={sy(v) + 3.5} textAnchor="end" className="amort-axis">{fmtAxis(v)} €</text>
          </g>
        ))}
        <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--ink-3)" strokeWidth="1.25" strokeDasharray="3 3" />
        <text x={W - padR} y={zeroY - 6} textAnchor="end" className="amort-zero">Break-even</text>
        <path d={areaPath} fill="url(#amortFill)" />
        <path d={cumPath} fill="none" stroke="var(--good)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        <path d={linePath('disc')} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round" />
        {pbX != null && (
          <g>
            <line x1={pbX} y1={padT} x2={pbX} y2={H - padB} stroke="var(--fw-fernwaerme)" strokeWidth="1.5" strokeDasharray="2 3" />
            <circle cx={pbX} cy={zeroY} r="4.5" fill="var(--surface)" stroke="var(--fw-fernwaerme)" strokeWidth="2" />
            <g transform={`translate(${Math.min(pbX, W - padR - 78)}, ${padT + 2})`}>
              <rect x="0" y="0" width="74" height="20" rx="5" fill="var(--fw-fernwaerme)" />
              <text x="37" y="13.5" textAnchor="middle" className="amort-pblabel">{years(pb)}</text>
            </g>
          </g>
        )}
        <circle cx={sx(endPoint.year)} cy={sy(endPoint.cum)} r="3.5" fill="var(--good)" />
        <circle cx={sx(0)} cy={sy(-item.investment_total)} r="3.5" fill="var(--alert)" />
        {xTicks.map((yr, i) => (
          <text key={'x' + i} x={sx(yr)} y={H - padB + 18} textAnchor="middle" className="amort-axis">{yr === 0 ? 'Jahr 0' : 'J' + yr}</text>
        ))}
      </svg>
      <div className="amort-legend">
        <span><span className="ll" style={{ background: 'var(--good)' }} />Kumulierter Cashflow (nominal)</span>
        <span><span className="ll dash" />Abgezinst (4 %)</span>
        <span><span className="lm" style={{ borderColor: 'var(--fw-fernwaerme)' }} />Amortisation</span>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  const isPlan = type === 'action_plan';
  return (
    <span className={'k-typebadge ' + (isPlan ? 'plan' : 'vb')}>
      {isPlan ? <List size={11} /> : <Plug size={11} />}
      {isPlan ? 'Aktionsplan' : 'Verbraucher'}
    </span>
  );
}

function KStatus({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status, tone: 'neutral' };
  return <span className={'k-status ' + m.tone}><span className="dot" />{m.label}</span>;
}

function MetricCell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="metric-cell">
      <div className="metric-label">{label}</div>
      <div className={'metric-value' + (tone ? ' ' + tone : '')}>{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function CashflowTable({ item }: { item: AmortizationItem }) {
  const series = buildSeries(item);
  const pb = item.dynamic_payback_years ?? item.simple_payback_years;
  return (
    <div className="cf-table">
      <div className="cf-row cf-head">
        <div>Jahr</div>
        <div className="num">Einsparung</div>
        <div className="num">Kumuliert</div>
        <div className="num">Abgezinst</div>
      </div>
      <div className="cf-scroll">
        {series.map((p) => {
          const isPb = pb != null && p.year === Math.ceil(pb);
          return (
            <div className={'cf-row' + (isPb ? ' pb' : '')} key={p.year}>
              <div className="cf-year">{p.year === 0 ? '0 (Invest.)' : p.year}</div>
              <div className="num">{p.year === 0 ? '—' : eurShort(p.save)}</div>
              <div className={'num ' + (p.cum >= 0 ? 'pos' : 'neg')}>{(p.cum >= 0 ? '+' : '−') + eurShort(Math.abs(p.cum))}</div>
              <div className={'num ' + (p.disc >= 0 ? 'pos' : 'neg')}>{(p.disc >= 0 ? '+' : '−') + eurShort(Math.abs(p.disc))}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MeasureRow({ item, selected, onClick }: { item: AmortizationItem; selected: boolean; onClick: () => void }) {
  const pb = item.simple_payback_years;
  const pbPct = pb == null ? 100 : Math.min(100, (pb / 8) * 100);
  const pbCls = pb != null && pb <= 3 ? 'fast' : pb != null && pb <= 6 ? 'mid' : 'slow';
  const co2t = (item.expected_savings_co2_kg_pa ?? 0) / 1000;
  return (
    <div className={'m-row' + (selected ? ' active' : '')} onClick={onClick}>
      <div className="m-row-main">
        <div className="m-row-title">
          <span className="m-name" title={item.title}>{item.title}</span>
        </div>
        <div className="m-row-sub">
          <TypeBadge type={item.type} />
          {(item.objective_title || item.category) && <span className="m-area">{item.objective_title || item.category}</span>}
        </div>
      </div>
      <div className="m-row-metrics">
        <div className="m-metric"><span className="mm-label">Investition</span><span className="mm-val">{eurShort(item.investment_total)}</span></div>
        <div className="m-metric m-pb">
          <span className="mm-label">Amortisation</span>
          <span className="mm-val">{years(pb)}</span>
          <div className="pb-track"><div className={'pb-fill ' + pbCls} style={{ width: `${100 - pbPct}%` }} /></div>
        </div>
        <div className="m-metric"><span className="mm-label">Kapitalwert</span><span className={'mm-val ' + (item.npv >= 0 ? 'pos' : 'neg')}>{(item.npv >= 0 ? '+' : '−') + eurShort(Math.abs(item.npv))}</span></div>
        <div className="m-metric"><span className="mm-label">CO₂/a</span><span className="mm-val">{nf(co2t, 1)} t</span></div>
      </div>
    </div>
  );
}

function MeasureDetail({ item, priceInfo }: { item: AmortizationItem | null; priceInfo: PriceInfo | null }) {
  if (!item) {
    return (
      <div className="wd-empty">
        <div className="mark"><TrendingUp size={20} /></div>
        <strong>Maßnahme wählen</strong>
        <div>Wähle links eine Maßnahme, um Amortisation,<br />Kapitalwert und Cashflow im Detail zu sehen.</div>
      </div>
    );
  }
  const life = item.expected_lifetime_years ?? 20;
  const co2t = (item.expected_savings_co2_kg_pa ?? 0) / 1000;
  const priceCt = (item.price_per_kwh * 100).toLocaleString('de-DE', { maximumFractionDigits: 2 });
  return (
    <div className="wd-detail">
      <div className="wd-detail-head">
        <div className="wd-dh-top">
          <TypeBadge type={item.type} />
          <KStatus status={item.status} />
          <span className="wd-ref">{item.id.slice(0, 8)}</span>
        </div>
        <h3>{item.title}</h3>
        {(item.objective_title || item.category || item.responsible) && (
          <div className="wd-dh-meta">
            {item.objective_title && <span className="wd-area">{item.objective_title}</span>}
            {item.category && <span className="wd-area">{item.category}</span>}
            {item.responsible && <span className="wd-area">{item.responsible}</span>}
          </div>
        )}
      </div>

      <div className="wd-metrics">
        <MetricCell label="Investition" value={eurFull(item.investment_total)} />
        <MetricCell label="Einf. Amortisation" value={years(item.simple_payback_years)} tone={item.simple_payback_years != null && item.simple_payback_years <= 5 ? 'good' : undefined} />
        <MetricCell label="Dyn. Amortisation" value={years(item.dynamic_payback_years)} tone={item.dynamic_payback_years != null && item.dynamic_payback_years <= 5 ? 'good' : undefined} />
        <MetricCell label="Kapitalwert (NPV)" value={(item.npv >= 0 ? '+' : '−') + eurShort(Math.abs(item.npv))} tone={item.npv >= 0 ? 'good' : 'bad'} sub={`über ${life} Jahre`} />
        <MetricCell label="ROI gesamt" value={Math.round(item.roi_pct) + ' %'} tone={item.roi_pct >= 0 ? 'good' : 'bad'} />
        <MetricCell label="CO₂-Einsparung" value={nf(co2t, 1) + ' t/a'} tone={co2t > 0 ? 'good' : undefined} sub={item.expected_savings_kwh_pa ? kwhShort(item.expected_savings_kwh_pa) + '/a' : undefined} />
      </div>

      <div className="wd-card">
        <div className="wd-card-head">
          <div className="wd-card-title">Kumulierter Cashflow</div>
          <div className="wd-card-sub">
            Netto-Einsparung Jahr 1: <strong>{eurFull(item.annual_savings_net)}</strong> · Energiepreis <strong>{priceCt} ct/kWh</strong>
            {priceInfo && ` (${priceInfo.source_labels[item.price_source] ?? item.price_source})`}
          </div>
        </div>
        <AmortChart item={item} />
      </div>

      <div className="wd-card">
        <div className="wd-card-head">
          <div className="wd-card-title">Cashflow-Verlauf</div>
          <div className="wd-card-sub">Nominal mit {item.price_increase_rate_pct} % Preissteigerung · abgezinst mit 4 %</div>
        </div>
        <CashflowTable item={item} />
      </div>
    </div>
  );
}

/* ── Seite ── */

type Filter = 'alle' | 'action_plan' | 'consumer';
type SortKey = 'amort' | 'npv' | 'co2' | 'invest';

export default function EconomicsPage() {
  const [items, setItems] = useState<AmortizationItem[]>([]);
  const [priceInfo, setPriceInfo] = useState<PriceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('alle');
  const [sortKey, setSortKey] = useState<SortKey>('amort');
  const [selId, setSelId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [amortRes, priceRes] = await Promise.all([
        apiClient.get('/api/v1/economics/amortization'),
        apiClient.get('/api/v1/economics/price'),
      ]);
      setItems((amortRes.data as { items: AmortizationItem[] }).items);
      setPriceInfo(priceRes.data as PriceInfo);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const counts = {
    alle: items.length,
    action_plan: items.filter((i) => i.type === 'action_plan').length,
    consumer: items.filter((i) => i.type === 'consumer').length,
  };

  const filtered = useMemo(() => {
    const list = items.filter((i) => (filter === 'alle' ? true : i.type === filter));
    return [...list].sort((a, b) => {
      if (sortKey === 'amort') return (a.simple_payback_years ?? 1e9) - (b.simple_payback_years ?? 1e9);
      if (sortKey === 'npv') return b.npv - a.npv;
      if (sortKey === 'co2') return (b.expected_savings_co2_kg_pa ?? 0) - (a.expected_savings_co2_kg_pa ?? 0);
      if (sortKey === 'invest') return b.investment_total - a.investment_total;
      return 0;
    });
  }, [items, filter, sortKey]);

  const selected = filtered.find((m) => m.id === selId) || filtered[0] || null;

  // Portfolio-Aggregate
  const pf = useMemo(() => {
    const invest = filtered.reduce((s, i) => s + i.investment_total, 0);
    const saveEur = filtered.reduce((s, i) => s + i.annual_savings_net, 0);
    const saveKwh = filtered.reduce((s, i) => s + (i.expected_savings_kwh_pa ?? 0), 0);
    const co2 = filtered.reduce((s, i) => s + (i.expected_savings_co2_kg_pa ?? 0), 0);
    const npv = filtered.reduce((s, i) => s + i.npv, 0);
    const wPayback = filtered.reduce((acc, i) => {
      if (i.simple_payback_years == null) return acc;
      return { sum: acc.sum + i.simple_payback_years * i.investment_total, w: acc.w + i.investment_total };
    }, { sum: 0, w: 0 });
    return { invest, saveEur, saveKwh, co2, npv, count: filtered.length, payback: wPayback.w > 0 ? wPayback.sum / wPayback.w : null };
  }, [filtered]);

  const SORTS: Array<{ id: SortKey; label: string }> = [
    { id: 'amort', label: 'Amortisation' },
    { id: 'npv', label: 'Kapitalwert' },
    { id: 'co2', label: 'CO₂' },
    { id: 'invest', label: 'Investition' },
  ];
  const FILTERS: Array<{ id: Filter; label: string; Icon: typeof List | null }> = [
    { id: 'alle', label: 'Alle', Icon: null },
    { id: 'action_plan', label: 'Aktionspläne', Icon: List },
    { id: 'consumer', label: 'Verbraucher', Icon: Plug },
  ];

  return (
    <div className="kosten">
      <PageTabs tabs={COST_TABS} />
      <PageHead eyebrow="Kosten & Wirtschaft" title="Wirtschaftlichkeit" />

      <div className="tab-body" style={{ marginTop: 12 }}>
        <div className="tab-title-row">
          <div>
            <p className="tab-sub" style={{ marginTop: 0 }}>Amortisationsrechnung für Aktionspläne und Investitionen in Verbraucher</p>
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Aktualisieren
          </button>
        </div>

        {priceInfo && (
          <div className="assume-banner">
            <Info size={15} color="var(--info)" />
            <div className="assume-items">
              <span><span className="al">Energiepreis-Basis</span> <strong>{(priceInfo.price_per_kwh * 100).toLocaleString('de-DE', { minimumFractionDigits: 2 })} ct/kWh</strong> <span className="adim">({priceInfo.source_labels[priceInfo.price_source] ?? priceInfo.price_source})</span></span>
              <span className="adot">·</span>
              <span><span className="al">Preissteigerung</span> <strong>{priceInfo.price_increase_rate_pct} %/a</strong></span>
              <span className="adot">·</span>
              <span><span className="al">Kalkulationszins</span> <strong>4 %</strong></span>
            </div>
          </div>
        )}

        {error && (
          <div style={{ background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '12px 14px', color: 'var(--alert)', fontSize: 13 }}>{error}</div>
        )}

        {loading ? (
          <div className="card" style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : items.length === 0 ? (
          <div className="empty-pad">
            <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 6 }}>Keine Investitionsdaten vorhanden</strong>
            Hinterlege Anschaffungskosten bei Verbrauchern oder Investitionskosten bei Aktionsplänen
            (ISO 50001 → Ziele → Aktionspläne), um die Amortisationsrechnung zu starten.
          </div>
        ) : (
          <>
            {/* Portfolio-Aggregate */}
            <div className="pf-grid">
              <PortfolioKpi Icon={Wallet} label="Investitionsbedarf gesamt" value={eurShort(pf.invest)} sub={`${pf.count} Maßnahmen in Auswahl`} />
              <PortfolioKpi Icon={Coins} label="Jährliche Einsparung" value={eurShort(pf.saveEur)} unit="/ a" sub={kwhShort(pf.saveKwh) + ' / a'} />
              <PortfolioKpi Icon={Leaf} label="CO₂-Einsparung" value={nf(pf.co2 / 1000, 1)} unit="t / a" tone="good" sub="bilanziell nach Energieträger" />
              <PortfolioKpi Icon={Clock} label="Ø Amortisation" value={years(pf.payback)} sub="gewichtet über Investition" />
              <PortfolioKpi Icon={TrendingUp} label="Kapitalwert gesamt" value={(pf.npv >= 0 ? '+' : '−') + eurShort(Math.abs(pf.npv))} tone={pf.npv >= 0 ? 'good' : 'bad'} sub="Summe NPV über Nutzungsdauer" />
            </div>

            {/* Filter + Sort */}
            <div className="wd-toolbar">
              <div className="chip-row">
                {FILTERS.map((f) => (
                  <button key={f.id} className={'fchip' + (filter === f.id ? ' active' : '')} onClick={() => setFilter(f.id)}>
                    {f.Icon && <f.Icon size={12} />}
                    {f.label}<span className="fcount">{counts[f.id]}</span>
                  </button>
                ))}
              </div>
              <div className="sort-group">
                <span className="sort-label">Sortieren</span>
                <div className="seg">
                  {SORTS.map((s) => (
                    <button key={s.id} className={sortKey === s.id ? 'seg-active' : ''} onClick={() => setSortKey(s.id)}>{s.label}</button>
                  ))}
                </div>
              </div>
            </div>

            {/* Master-Detail */}
            <div className="wd-split">
              <div className="wd-list">
                {filtered.map((m) => (
                  <MeasureRow key={`${m.type}-${m.id}`} item={m} selected={!!selected && m.id === selected.id} onClick={() => setSelId(m.id)} />
                ))}
              </div>
              <div className="wd-detail-wrap">
                <MeasureDetail item={selected} priceInfo={priceInfo} />
              </div>
            </div>
          </>
        )}

        <div className="calc-basis">
          <div className="cb-title">Berechnungsgrundlagen</div>
          <ul>
            <li><strong>Einfache Amortisation:</strong> Investition ÷ jährliche Nettoeinsparung (Jahr 1)</li>
            <li><strong>Dynamische Amortisation:</strong> kumulierte Einsparungen mit jährlicher Preissteigerung</li>
            <li><strong>Kapitalwert (NPV):</strong> abdiskontierte Einsparungen über Nutzungsdauer minus Investition (Zinssatz 4 %)</li>
            <li><strong>ROI:</strong> (Gesamteinsparung − Investition) ÷ Investition × 100</li>
            <li><strong>Energiepreise:</strong> Energieabrechnungen → Messdaten mit Kosten → Tarif-Planwert → Standardwert 30 ct/kWh</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function PortfolioKpi({ Icon, label, value, unit, sub, tone }: { Icon: typeof Wallet; label: string; value: string; unit?: string; sub?: string; tone?: string }) {
  return (
    <div className="pf-kpi">
      <div className="pf-kpi-top">
        <span className="pf-ico"><Icon size={14} /></span>
        <span className="pf-label">{label}</span>
      </div>
      <div className="pf-value-row">
        <span className={'pf-value' + (tone ? ' ' + tone : '')}>{value}</span>
        {unit && <span className="pf-unit">{unit}</span>}
      </div>
      {sub && <div className="pf-sub">{sub}</div>}
    </div>
  );
}

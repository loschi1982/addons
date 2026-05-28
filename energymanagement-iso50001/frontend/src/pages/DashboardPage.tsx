import React, { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import Sparkline from '@/components/charts/Sparkline';
import ShareBar from '@/components/charts/ShareBar';
import StackedMonthly from '@/components/charts/StackedMonthly';
import CO2Trajectory from '@/components/charts/CO2Trajectory';

/* ── Typen ── */

interface KPICard {
  label: string;
  value: number;
  unit: string;
  trend_percent: number | null;
  trend_direction: string | null;
  comparison_value: number | null;
  comparison_label: string | null;
}

interface EnergyBreakdown {
  energy_type: string;
  consumption_kwh: number;
  original_value?: number;
  original_unit?: string;
  share_percent: number;
}

interface TimeSeriesPoint {
  label: string;
  value: number;
}

interface ConsumptionChart {
  meter_id: string;
  meter_name: string;
  energy_type: string;
  unit: string;
  data: TimeSeriesPoint[];
}

interface TopConsumerMeter {
  meter_id: string;
  name: string;
  energy_type: string;
  consumption: number;
  unit: string;
  consumption_kwh: number;
}

interface TopConsumerGroup {
  energy_type: string;
  energy_type_label: string;
  meters: TopConsumerMeter[];
}

interface DashboardData {
  period_start: string;
  period_end: string;
  kpi_cards: KPICard[];
  energy_breakdown: EnergyBreakdown[];
  consumption_chart: ConsumptionChart[];
  top_consumers: TopConsumerGroup[];
  enpi_overview: Record<string, unknown>[];
}

interface Site {
  id: string;
  name: string;
}

/* ── Energie-Konfiguration (Design-Farben) ── */

interface EnergyTypeDef {
  key: string;
  apiTypes: string[];
  kpiLabels: string[];
  color: string;
  displayName: string;
  unit: string;
}

const ENERGY_DEFS: EnergyTypeDef[] = [
  {
    key: 'fernwaerme',
    apiTypes: ['district_heating', 'FERNWAERME', 'fernwaerme'],
    kpiLabels: ['Fernwärme'],
    color: '#E89A3C',
    displayName: 'Fernwärme',
    unit: 'kWh',
  },
  {
    key: 'strom',
    apiTypes: ['electricity', 'STROM', 'strom'],
    kpiLabels: ['Strom'],
    color: '#F2C94C',
    displayName: 'Strom',
    unit: 'kWh',
  },
  {
    key: 'kaelte',
    apiTypes: ['district_cooling', 'KAELTE', 'kaelte'],
    kpiLabels: ['Kälte'],
    color: '#4FC3F7',
    displayName: 'Kälte',
    unit: 'kWh',
  },
  {
    key: 'wasser',
    apiTypes: ['water', 'WASSER', 'wasser'],
    kpiLabels: ['Wasser'],
    color: '#2A6FDB',
    displayName: 'Wasser',
    unit: 'm³',
  },
];

const ENERGY_COLORS: Record<string, string> = Object.fromEntries(
  ENERGY_DEFS.map((d) => [d.key, d.color])
);

const MONTHS_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ── Zeitfenster-Presets ── */

const todayStr = () => new Date().toISOString().slice(0, 10);
const yearStartStr = () => `${new Date().getFullYear()}-01-01`;
const weekAgoStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
};

type ViewModeKey = 'year' | 'week' | 'day';

const VIEW_MODES: Array<{
  key: ViewModeKey;
  label: string;
  apiGranularity: string;
  getRange: () => [string, string];
  chartTitle: string;
}> = [
  { key: 'year',  label: 'Jahr',  apiGranularity: 'monthly', getRange: () => [yearStartStr(), todayStr()], chartTitle: 'Jahresverlauf' },
  { key: 'week',  label: 'Woche', apiGranularity: 'daily',   getRange: () => [weekAgoStr(),  todayStr()], chartTitle: 'Wochenverbrauch' },
  { key: 'day',   label: 'Tag',   apiGranularity: 'hourly',  getRange: () => [todayStr(),    todayStr()], chartTitle: 'Tagesverbrauch' },
];

/* ── Hilfsfunktionen ── */

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' Mio.';
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }).format(n);
}

function fmtDelta(n: number | null): string {
  if (n == null) return '';
  return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
}

function matchEnergyDef(type: string): EnergyTypeDef | undefined {
  const lower = type.toLowerCase();
  return ENERGY_DEFS.find((d) =>
    d.apiTypes.some((t) => t.toLowerCase() === lower) ||
    d.kpiLabels.some((l) => l.toLowerCase() === lower)
  );
}

function findKPI(cards: KPICard[], label: string): KPICard | undefined {
  return cards.find((c) => c.label === label);
}

function formatDisplayLabel(label: string, granularity: string): string {
  // Monatlich: "Jan 2026" → "Jan"
  if (granularity === 'monthly') {
    const enIdx = MONTHS_EN.findIndex((m) => label.startsWith(m));
    if (enIdx >= 0) return MONTHS_DE[enIdx];
    const deIdx = MONTHS_DE.findIndex((m) => label.startsWith(m));
    if (deIdx >= 0) return label.split(' ')[0];
    const isoMatch = label.match(/^\d{4}-(\d{2})/);
    if (isoMatch) return MONTHS_DE[parseInt(isoMatch[1], 10) - 1] ?? label;
    return label;
  }
  // Stündlich: "2026-05-27 14:00:00" → "14:00"
  if (granularity === 'hourly') {
    const timeMatch = label.match(/(\d{2}:\d{2})/);
    if (timeMatch) return timeMatch[1];
    return label.slice(-5);
  }
  // Täglich: "2026-05-21" → "21.05." | "21 Jan 2026" → "21.01."
  const isoDay = label.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDay) return `${isoDay[3]}.${isoDay[2]}.`;
  const dayMonthMatch = label.match(/^(\d{1,2})\s+(\w+)/);
  if (dayMonthMatch) {
    const day = dayMonthMatch[1].padStart(2, '0');
    const enIdx = MONTHS_EN.findIndex((m) => dayMonthMatch[2].startsWith(m));
    const mNum = enIdx >= 0 ? String(enIdx + 1).padStart(2, '0') : '??';
    return `${day}.${mNum}.`;
  }
  return label.length > 6 ? label.slice(0, 6) : label;
}

function buildChartData(
  charts: ConsumptionChart[],
  granularity: string
): { data: Record<string, number[]>; displayLabels: string[]; currentSlotIdx: number } {
  // Alle Labels aus API-Daten sammeln (dedupliziert + sortiert)
  const labelSet = new Set<string>();
  for (const chart of charts) {
    for (const pt of chart.data) labelSet.add(pt.label);
  }
  const parseLabelOrder = (l: string): number => {
    const iso = l.match(/^(\d{4})-(\d{2})/);
    if (iso) return parseInt(iso[1]) * 12 + parseInt(iso[2]) - 1;
    const enIdx = MONTHS_EN.findIndex((m) => l.startsWith(m));
    const yr = l.match(/(\d{4})/);
    return (yr ? parseInt(yr[1]) : 0) * 12 + (enIdx >= 0 ? enIdx : 0);
  };
  const sortedLabels = granularity === 'monthly'
    ? Array.from(labelSet).sort((a, b) => parseLabelOrder(a) - parseLabelOrder(b))
    : Array.from(labelSet).sort();
  const labelIndex = new Map(sortedLabels.map((l, i) => [l, i]));
  const n = sortedLabels.length || 1;

  const result: Record<string, number[]> = {};
  for (const def of ENERGY_DEFS) result[def.key] = new Array(n).fill(0);

  for (const chart of charts) {
    const def = matchEnergyDef(chart.energy_type);
    if (!def) continue;
    for (const pt of chart.data) {
      const idx = labelIndex.get(pt.label);
      if (idx !== undefined) result[def.key][idx] += pt.value || 0;
    }
  }

  const displayLabels = sortedLabels.map((l) => formatDisplayLabel(l, granularity));

  // Aktuellen Slot bestimmen
  const now = new Date();
  let currentSlotIdx = 0;
  if (granularity === 'monthly') {
    const curMonth = now.getMonth(); // 0-based
    currentSlotIdx = sortedLabels.findIndex((l) => {
      const enIdx = MONTHS_EN.findIndex((m) => l.startsWith(m));
      return enIdx === curMonth;
    });
  } else if (granularity === 'daily') {
    const todayIso = now.toISOString().slice(0, 10);
    currentSlotIdx = sortedLabels.findIndex((l) => l.startsWith(todayIso));
  } else if (granularity === 'hourly') {
    const curHour = now.getHours();
    currentSlotIdx = sortedLabels.findIndex((l) => {
      const m = l.match(/(\d{2}):\d{2}/);
      return m ? parseInt(m[1], 10) === curHour : false;
    });
  }
  if (currentSlotIdx < 0) currentSlotIdx = sortedLabels.length - 1;

  return { data: result, displayLabels, currentSlotIdx };
}

function buildSparkline(charts: ConsumptionChart[], defKey: string): number[] {
  const monthly = new Array(12).fill(0);
  for (const chart of charts) {
    const chartDef = matchEnergyDef(chart.energy_type);
    if (!chartDef || chartDef.key !== defKey) continue;
    for (const pt of chart.data) {
      const enIdx = MONTHS_EN.findIndex((m) => pt.label.startsWith(m));
      const mIdx = enIdx >= 0 ? enIdx : (() => {
        const iso = pt.label.match(/^\d{4}-(\d{2})/);
        return iso ? parseInt(iso[1], 10) - 1 : -1;
      })();
      if (mIdx >= 0 && mIdx < 12) monthly[mIdx] += pt.value || 0;
    }
  }
  return monthly.some((v) => v > 0) ? monthly : [];
}

/* ── Sub-Komponenten ── */

function StatusBand({ co2Current, co2Baseline }: { co2Current: number; co2Baseline: number }) {
  const targetPct = 20;
  const targetYear = 2030;
  const baselineYear = 2022;
  const currentYear = new Date().getFullYear();
  const yearsTotal = targetYear - baselineYear;
  const yearsElapsed = currentYear - baselineYear;
  const paceMarkerPos = Math.min((yearsElapsed / yearsTotal) * 100, 100);

  const reductionAchieved = co2Baseline > 0
    ? ((co2Baseline - co2Current) / co2Baseline) * 100
    : 0;
  const fillPct = Math.min(Math.max(reductionAchieved, 0), targetPct) / targetPct * 100;
  const onTrack = reductionAchieved >= (yearsElapsed / yearsTotal) * targetPct;

  return (
    <div className="dv-status-band">
      {/* Links: Status + Headline */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: onTrack ? '#ECFDF5' : '#FEF3C7',
            color: onTrack ? '#10B981' : '#B45309',
            border: `1px solid ${onTrack ? '#A7F3D0' : '#FDE68A'}`,
            fontSize: 11, fontWeight: 600, padding: '4px 10px',
            borderRadius: 99, letterSpacing: '0.02em',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: onTrack ? '#10B981' : '#B45309',
              boxShadow: `0 0 0 3px ${onTrack ? 'rgba(16,185,129,0.18)' : 'rgba(180,83,9,0.18)'}`,
            }}
          />
          {onTrack ? 'Im Zielkorridor' : 'Hinter Ziel'}
        </div>
        <div>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 13.5, color: 'var(--dv-ink)' }}>
            ISO 50001 · CO₂-Reduktionspfad
          </span>
          <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dv-ink-3)', marginTop: 2 }}>
            Ziel: −{targetPct}% bis {targetYear} · Basis {baselineYear}
          </span>
        </div>
      </div>

      {/* Mitte: Fortschrittsbalken */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="dv-progress-track">
          <div className="dv-progress-fill" style={{ width: `${fillPct}%` }} />
          <div className="dv-progress-marker" style={{ left: `${paceMarkerPos}%` }}>
            <div className="dv-marker-label">{currentYear}</div>
            <div className="dv-marker-dot" />
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--dv-ink-2)', marginTop: 4 }}>
          <span>
            Erreicht: <strong style={{ color: 'var(--dv-ink)' }}>{reductionAchieved.toFixed(1)}%</strong>
          </span>
          <span style={{ color: 'var(--dv-ink-4)' }}>·</span>
          <span>
            Ziel {targetYear}: <strong style={{ color: 'var(--dv-ink)' }}>−{targetPct}%</strong>
          </span>
          {co2Baseline > 0 && (
            <>
              <span style={{ color: 'var(--dv-ink-4)' }}>·</span>
              <span>
                Basis: <strong style={{ color: 'var(--dv-ink)' }}>{fmtNum(co2Baseline)} kg</strong>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Rechts: Button */}
      <button
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          border: '1px solid var(--dv-line)',
          background: 'var(--dv-surface)',
          padding: '7px 12px',
          borderRadius: 'var(--dv-r-sm)',
          fontSize: 12.5, fontWeight: 500,
          color: 'var(--dv-ink)',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        ISO 50001 öffnen
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6H9.5M6.5 3L9.5 6L6.5 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}

function DeltaBadge({ pct, inverse = false }: { pct: number | null; inverse?: boolean }) {
  if (pct == null) return null;
  const isPositive = pct < 0; // negative delta = Reduktion = gut
  const good = inverse ? !isPositive : isPositive;
  const color = good ? '#10B981' : '#B91C1C';
  const Arrow = pct > 0
    ? <path d="M6 2L10 6H2L6 2Z" fill={color}/>
    : <path d="M6 10L10 6H2L6 10Z" fill={color}/>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12, fontWeight: 600, fontFamily: 'var(--dv-font-mono)', color }}>
      <svg width="10" height="10" viewBox="0 0 12 12">{Arrow}</svg>
      {fmtDelta(pct)}
    </span>
  );
}

function HeroKPIs({ cards }: { cards: KPICard[] }) {
  const co2  = findKPI(cards, 'CO₂-Emissionen');
  const cost = findKPI(cards, 'Energiekosten');
  const knownAgg = new Set(['CO₂-Emissionen', 'Energiekosten', 'Aktive Zähler', 'Eigenproduktion', 'Autarkiegrad']);
  const energyCards = cards.filter((c) => !knownAgg.has(c.label));
  const totalKWh = energyCards.reduce((s, c) => s + (c.value || 0), 0);
  const avgDelta = energyCards.filter((c) => c.trend_percent != null).length > 0
    ? energyCards.reduce((s, c) => s + (c.trend_percent || 0), 0) / energyCards.filter((c) => c.trend_percent != null).length
    : null;

  const heroes = [
    {
      label: 'Energieverbrauch YTD',
      value: fmtNum(totalKWh),
      unit: 'kWh',
      delta: avgDelta,
      color: '#E89A3C',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 1L10 6H15L11 9.5L12.5 15L8 12L3.5 15L5 9.5L1 6H6L8 1Z" fill="#E89A3C" fillOpacity="0.8"/>
        </svg>
      ),
    },
    {
      label: 'CO₂-Emissionen YTD',
      value: co2 ? fmtNum(co2.value) : '—',
      unit: co2?.unit || 'kg',
      delta: co2?.trend_percent ?? null,
      color: '#10B981',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="#10B981" strokeWidth="1.5"/>
          <path d="M5 8.5C5 7.12 6.12 6 7.5 6S10 7.12 10 8.5" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
    {
      label: 'Energiekosten YTD',
      value: cost ? fmtEur(cost.value) : '—',
      unit: '',
      delta: cost?.trend_percent ?? null,
      color: '#3D3D3D',
      icon: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M8 2V14M5 5h4.5a1.5 1.5 0 010 3H6a1.5 1.5 0 000 3H11" stroke="#3D3D3D" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      ),
    },
  ];

  return (
    <div className="dv-hero-trio">
      {heroes.map((h, i) => (
        <div key={i} className="dv-hero-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--dv-ink-3)', fontWeight: 500 }}>
            {h.icon}
            {h.label}
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em', fontFamily: 'var(--dv-font-mono)', fontFeatureSettings: '"tnum"', color: 'var(--dv-ink)' }}>
              {h.value}
            </span>
            {h.unit && (
              <span style={{ fontSize: 12, color: 'var(--dv-ink-3)', fontFamily: 'var(--dv-font-mono)' }}>
                {h.unit}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <DeltaBadge pct={h.delta} />
            <span style={{ fontSize: 11, color: 'var(--dv-ink-3)' }}>vs. Vorjahr</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EnergyMixCard({ breakdown }: { breakdown: EnergyBreakdown[] }) {
  const totalKWh = breakdown.reduce((s, b) => s + (b.consumption_kwh || 0), 0);

  const segments = ENERGY_DEFS.map((def) => {
    const bd = breakdown.find((b) => matchEnergyDef(b.energy_type)?.key === def.key);
    return {
      key: def.key,
      label: def.displayName,
      value: bd?.consumption_kwh || 0,
      color: def.color,
      share: bd?.share_percent || 0,
    };
  }).filter((s) => s.value > 0);

  return (
    <div className="dv-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 12, color: 'var(--dv-ink-3)', fontWeight: 500 }}>Energiemix</span>
        <span style={{ fontSize: 12, fontFamily: 'var(--dv-font-mono)', color: 'var(--dv-ink-3)' }}>
          Gesamt <strong style={{ color: 'var(--dv-ink)', fontWeight: 600, fontSize: 15 }}>{fmtNum(totalKWh)}</strong> kWh
        </span>
      </div>
      {segments.length > 0 ? (
        <ShareBar segments={segments} height={14} radius={4} />
      ) : (
        <div style={{ height: 14, background: 'var(--dv-line)', borderRadius: 4 }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
        {segments.map((s) => (
          <div key={s.key} style={{ display: 'grid', gridTemplateColumns: '12px 1fr auto', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            <span style={{ color: 'var(--dv-ink)' }}>{s.label}</span>
            <span style={{ color: 'var(--dv-ink-3)', fontFamily: 'var(--dv-font-mono)', fontSize: 11 }}>
              {s.share.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TypeCards({
  cards,
  breakdown,
  charts,
}: {
  cards: KPICard[];
  breakdown: EnergyBreakdown[];
  charts: ConsumptionChart[];
}) {
  return (
    <div className="dv-type-cards">
      {ENERGY_DEFS.map((def) => {
        const kpi = cards.find((c) => def.kpiLabels.includes(c.label));
        const bd  = breakdown.find((b) => matchEnergyDef(b.energy_type)?.key === def.key);
        const sparkData = buildSparkline(charts, def.key);

        return (
          <div key={def.key} className={`dv-type-card dv-type-${def.key}`}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: def.color + '22',
                  display: 'grid', placeItems: 'center',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: 2, background: def.color, display: 'block' }} />
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dv-ink)' }}>{def.displayName}</span>
              {bd && (
                <span
                  style={{
                    marginLeft: 'auto', fontSize: 10.5, color: 'var(--dv-ink-3)',
                    background: 'var(--dv-surface-2)', padding: '2px 6px',
                    borderRadius: 3, fontFamily: 'var(--dv-font-mono)',
                  }}
                >
                  {bd.share_percent.toFixed(1)}%
                </span>
              )}
            </div>

            {/* Hauptwert */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 2 }}>
              <span style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.025em', fontFamily: 'var(--dv-font-mono)', color: 'var(--dv-ink)' }}>
                {kpi != null && kpi.value > 0 ? fmtNum(kpi.value) : '—'}
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dv-ink-3)', fontFamily: 'var(--dv-font-mono)' }}>
                {kpi?.unit ?? def.unit}
              </span>
            </div>

            {/* Delta */}
            {kpi?.trend_percent != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <DeltaBadge pct={kpi.trend_percent} />
                <span style={{ fontSize: 11, color: 'var(--dv-ink-3)' }}>
                  {kpi.comparison_label ?? 'vs. Vorjahr'}
                </span>
              </div>
            )}

            {/* Sparkline */}
            {sparkData.length > 1 && (
              <div style={{ margin: '4px 0' }}>
                <Sparkline data={sparkData} color={def.color} width={120} height={32} />
              </div>
            )}

            {/* Fußzeile */}
            {bd && bd.consumption_kwh > 0 && (
              <div style={{ paddingTop: 8, borderTop: '1px solid var(--dv-line)', marginTop: 'auto' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 10, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Anteil gesamt
                  </span>
                  <div style={{ background: 'var(--dv-surface-2)', borderRadius: 99, height: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', borderRadius: 99,
                        background: def.color,
                        width: `${Math.min(bd.share_percent, 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthlyTrend({
  charts,
  granularity,
}: {
  charts: ConsumptionChart[];
  granularity: string;
}) {
  const { data, displayLabels, currentSlotIdx } = buildChartData(charts, granularity);
  const hasAnyData = Object.values(data).some((arr) => arr.some((v) => v > 0));
  const activeKeys = ENERGY_DEFS.filter((d) => data[d.key]?.some((v) => v > 0)).map((d) => d.key);
  const title = VIEW_MODES.find((m) => m.apiGranularity === granularity)?.chartTitle ?? 'Verbrauch';
  const names = Object.fromEntries(ENERGY_DEFS.map((d) => [d.key, d.displayName]));
  const units = Object.fromEntries(ENERGY_DEFS.map((d) => [d.key, d.unit]));

  return (
    <div className="dv-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: '-0.005em', color: 'var(--dv-ink)' }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--dv-ink-3)', marginTop: 2 }}>
            Alle Energieträger · kWh
          </div>
        </div>
        {activeKeys.length > 0 && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {activeKeys.map((k) => {
              const def = ENERGY_DEFS.find((d) => d.key === k)!;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--dv-ink-2)' }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: def.color, display: 'inline-block' }} />
                  {def.displayName}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {hasAnyData ? (
        <StackedMonthly
          data={data}
          months={displayLabels}
          colors={ENERGY_COLORS}
          names={names}
          units={units}
          height={240}
          currentMonthIdx={currentSlotIdx}
        />
      ) : (
        <div style={{ height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dv-ink-4)', fontSize: 13 }}>
          Keine Daten im gewählten Zeitraum
        </div>
      )}
    </div>
  );
}

function InsightsPanel({ data }: { data: DashboardData }) {
  type InsightKind = 'warn' | 'good' | 'alert' | 'info';

  interface Insight {
    kind: InsightKind;
    title: string;
    body: string;
    tag: string;
  }

  const insights: Insight[] = [];

  const knownAgg = new Set(['CO₂-Emissionen', 'Energiekosten', 'Aktive Zähler', 'Eigenproduktion', 'Autarkiegrad']);
  for (const card of data.kpi_cards.filter((c) => !knownAgg.has(c.label))) {
    if (card.trend_percent != null) {
      if (Number(card.trend_percent) > 5) {
        insights.push({
          kind: 'warn',
          title: `${card.label}-Verbrauch ${Math.abs(Number(card.trend_percent)).toFixed(1)}% über Vorjahr`,
          body: `Aktuell ${fmtNum(card.value)} ${card.unit}. Mögliche Ursachen prüfen.`,
          tag: card.label,
        });
      } else if (Number(card.trend_percent) < -5) {
        insights.push({
          kind: 'good',
          title: `${card.label} um ${Math.abs(Number(card.trend_percent)).toFixed(1)}% reduziert`,
          body: `Verbrauch ${fmtNum(card.value)} ${card.unit} – deutlich unter Vorjahr.`,
          tag: card.label,
        });
      }
    }
  }

  for (const group of data.top_consumers) {
    if (group.meters.length >= 2) {
      const top = group.meters[0];
      const total = group.meters.reduce((s, m) => s + m.consumption, 0);
      const share = total > 0 ? (top.consumption / total) * 100 : 0;
      if (share > 50) {
        insights.push({
          kind: 'alert',
          title: `Einzelverbraucher dominiert ${group.energy_type_label}`,
          body: `"${top.name}" trägt ${share.toFixed(0)}% bei – Optimierungspotenzial prüfen.`,
          tag: group.energy_type_label,
        });
      }
    }
  }

  if (insights.length === 0) {
    insights.push({
      kind: 'info',
      title: 'Keine auffälligen Abweichungen',
      body: 'Alle Energieträger liegen im erwarteten Bereich.',
      tag: 'System',
    });
  }

  const kindConfig: Record<InsightKind, { bg: string; fg: string; dot: string }> = {
    warn:  { bg: '#FEF9EC', fg: '#B45309', dot: '#F59E0B' },
    good:  { bg: '#ECFDF5', fg: '#059669', dot: '#10B981' },
    alert: { bg: '#FEF2F2', fg: '#B91C1C', dot: '#EF4444' },
    info:  { bg: '#EFF6FF', fg: '#1E40AF', dot: '#3B82F6' },
  };

  return (
    <div className="dv-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dv-ink)' }}>Insights</div>
          <div style={{ fontSize: 12, color: 'var(--dv-ink-3)', marginTop: 2 }}>Automatische Auswertung</div>
        </div>
        <span
          style={{
            display: 'inline-block', background: 'var(--dv-surface-2)',
            border: '1px solid var(--dv-line)', padding: '2px 8px',
            borderRadius: 99, fontSize: 11, fontWeight: 600, color: 'var(--dv-ink-2)',
          }}
        >
          {insights.length}
        </span>
      </div>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}>
        {insights.map((ins, i) => {
          const cfg = kindConfig[ins.kind];
          return (
            <li key={i} className="dv-insight-item">
              <div
                style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: cfg.bg,
                  display: 'grid', placeItems: 'center',
                  flexShrink: 0, marginTop: 1,
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: cfg.dot, display: 'block' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--dv-ink)', lineHeight: 1.3, flex: 1 }}>
                    {ins.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10, color: 'var(--dv-ink-3)',
                      background: 'var(--dv-surface-2)', padding: '1px 6px',
                      borderRadius: 3, fontWeight: 500, textTransform: 'uppercase',
                      letterSpacing: '0.04em', whiteSpace: 'nowrap',
                    }}
                  >
                    {ins.tag}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--dv-ink-2)', lineHeight: 1.45, margin: 0 }}>
                  {ins.body}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function TopConsumers({ groups }: { groups: TopConsumerGroup[] }) {
  const relevant = groups.filter((g) => g.meters.length > 0);

  if (relevant.length === 0) {
    return (
      <div className="dv-card">
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dv-ink)', marginBottom: 14 }}>Top-Verbraucher</div>
        <p style={{ color: 'var(--dv-ink-4)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
          Keine Verbrauchsdaten vorhanden
        </p>
      </div>
    );
  }

  return (
    <div className="dv-card">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dv-ink)' }}>Top-Verbraucher</div>
          <div style={{ fontSize: 12, color: 'var(--dv-ink-3)', marginTop: 2 }}>Nach Energieträger gruppiert</div>
        </div>
      </div>

      {relevant.map((group) => {
        const def = ENERGY_DEFS.find((d) =>
          d.apiTypes.some((t) => t.toLowerCase() === group.energy_type.toLowerCase())
        );
        const color = def?.color || '#8A8A8A';
        const topTotal = group.meters.reduce((s, m) => s + m.consumption, 0);

        return (
          <div key={group.energy_type} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                paddingBottom: 8, marginBottom: 6,
                borderBottom: '1px solid var(--dv-line)',
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--dv-ink)' }}>{group.energy_type_label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, fontFamily: 'var(--dv-font-mono)', color: 'var(--dv-ink-3)' }}>
                {fmtNum(topTotal)} {group.meters[0]?.unit || 'kWh'}
              </span>
            </div>

            {group.meters.slice(0, 5).map((meter) => {
              const share = topTotal > 0 ? (meter.consumption / topTotal) : 0;
              return (
                <div key={meter.meter_id} className="dv-tc-row">
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--dv-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {meter.name}
                    </div>
                    <div style={{ fontSize: 10.5, fontFamily: 'var(--dv-font-mono)', color: 'var(--dv-ink-4)' }}>
                      {meter.meter_id.slice(0, 24)}
                    </div>
                  </div>
                  <div style={{ background: 'var(--dv-surface-2)', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%', borderRadius: 99,
                        background: color,
                        width: `${Math.min(share * 100, 100)}%`,
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, justifyContent: 'flex-end' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--dv-font-mono)', color: 'var(--dv-ink)' }}>
                      {fmtNum(meter.consumption)}
                    </span>
                    <span style={{ fontSize: 10.5, color: 'var(--dv-ink-3)', fontFamily: 'var(--dv-font-mono)' }}>
                      {meter.unit}
                    </span>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--dv-ink-3)', fontFamily: 'var(--dv-font-mono)', textAlign: 'right' }}>
                    {(share * 100).toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function CO2Card({ cards }: { cards: KPICard[] }) {
  const co2 = findKPI(cards, 'CO₂-Emissionen');
  const currentYear = new Date().getFullYear();
  const currentVal = co2?.value || 0;
  const baselineKg = 1_870_000;

  const reductionPct = baselineKg > 0
    ? ((baselineKg - currentVal) / baselineKg) * 100
    : 0;

  const cost = findKPI(cards, 'Energiekosten');
  const meters = findKPI(cards, 'Aktive Zähler');

  return (
    <div className="dv-card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--dv-ink)', marginBottom: 4 }}>
        CO₂-Reduktionspfad
      </div>
      <div style={{ fontSize: 12, color: 'var(--dv-ink-3)', marginBottom: 14 }}>
        Basis 2022 · Ziel −20% bis 2030
      </div>

      {currentVal > 0 ? (
        <CO2Trajectory
          baseline={baselineKg}
          current={currentVal}
          target={20}
          baselineYear={2022}
          currentYear={currentYear}
          targetYear={2030}
          height={160}
        />
      ) : (
        <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--dv-ink-4)', fontSize: 13 }}>
          Keine CO₂-Daten verfügbar
        </div>
      )}

      <div
        style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
          marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--dv-line)',
        }}
      >
        {[
          {
            label: 'Reduktion',
            value: reductionPct > 0 ? `−${reductionPct.toFixed(1)}%` : '—',
            good: reductionPct > 0,
          },
          {
            label: 'Kosten',
            value: cost ? fmtEur(cost.value) : '—',
            good: false,
          },
          {
            label: 'Zähler aktiv',
            value: meters ? String(Math.round(meters.value)) : '—',
            good: false,
          },
        ].map((s) => (
          <div key={s.label}>
            <div style={{ fontSize: 10.5, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div
              style={{
                fontSize: 16, fontWeight: 600, fontFamily: 'var(--dv-font-mono)',
                color: s.good ? '#10B981' : 'var(--dv-ink)',
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Hauptseite ── */

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState<ViewModeKey | null>('year');
  const [granularity, setGranularity] = useState('monthly');
  const [periodStart, setPeriodStart] = useState(yearStartStr);
  const [periodEnd, setPeriodEnd] = useState(todayStr);
  const [selectedSite, setSelectedSite] = useState('');
  const [sites, setSites] = useState<Site[]>([]);

  const applyViewMode = useCallback((key: ViewModeKey) => {
    const mode = VIEW_MODES.find((m) => m.key === key)!;
    const [start, end] = mode.getRange();
    setViewMode(key);
    setGranularity(mode.apiGranularity);
    setPeriodStart(start);
    setPeriodEnd(end);
  }, []);

  useEffect(() => {
    apiClient.get('/api/v1/sites', { params: { page_size: 100 } })
      .then((res) => setSites(res.data.items || []))
      .catch(() => {});
  }, []);

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {
        granularity,
        period_start: periodStart,
        period_end: periodEnd,
      };
      if (selectedSite) params.site_id = selectedSite;
      const res = await apiClient.get('/api/v1/dashboard', { params });
      setData(res.data);
      setError('');
    } catch {
      setError('Dashboard-Daten konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [granularity, periodStart, periodEnd, selectedSite]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  const co2KPI = data ? findKPI(data.kpi_cards, 'CO₂-Emissionen') : null;

  // Bricht aus dem p-6 Padding von MainLayout heraus
  const breakoutStyle: React.CSSProperties = {
    margin: '-1.5rem',      // entspricht -p-6 (24px)
    minHeight: 'calc(100% + 3rem)',
  };

  if (loading) {
    return (
      <div className="dash-v2" style={{ ...breakoutStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '3px solid #E8E3D8',
            borderTopColor: '#E89A3C',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="dash-v2" style={{ ...breakoutStyle, padding: 24 }}>
        <div style={{ border: '1px solid #FECACA', background: '#FEF2F2', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ color: '#B91C1C' }}>{error || 'Keine Daten verfügbar'}</p>
          <button
            onClick={fetchDashboard}
            style={{ marginTop: 12, padding: '7px 16px', background: '#0F1115', color: '#FFF', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13 }}
          >
            Erneut laden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-v2" style={breakoutStyle}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '18px 24px 12px', gap: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 28 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--dv-ink-3)', marginBottom: 2 }}>
              Energiemanagement
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em', margin: 0, color: 'var(--dv-ink)' }}>
              Dashboard
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingBottom: 4 }}>
            <span style={{ fontSize: 11, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Zeitraum</span>
            <span style={{ fontFamily: 'var(--dv-font-mono)', fontSize: 12, color: 'var(--dv-ink)', fontWeight: 500 }}>
              {data.period_start} – {data.period_end}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* Standort-Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Standort</span>
            <select
              value={selectedSite}
              onChange={(e) => setSelectedSite(e.target.value)}
              style={{
                border: '1px solid var(--dv-line)', background: 'var(--dv-surface)',
                padding: '5px 10px', borderRadius: 'var(--dv-r-sm)',
                fontSize: 12.5, color: 'var(--dv-ink)', outline: 'none', cursor: 'pointer',
              }}
            >
              <option value="">Alle Standorte</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          {/* Zeitraum Von */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Von</span>
            <input
              type="date" value={periodStart}
              onChange={(e) => { setPeriodStart(e.target.value); setViewMode(null); }}
              style={{
                border: '1px solid var(--dv-line)', background: 'var(--dv-surface)',
                padding: '5px 10px', borderRadius: 'var(--dv-r-sm)',
                fontSize: 12.5, color: 'var(--dv-ink)', outline: 'none',
              }}
            />
          </div>

          {/* Zeitraum Bis */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Bis</span>
            <input
              type="date" value={periodEnd}
              onChange={(e) => { setPeriodEnd(e.target.value); setViewMode(null); }}
              style={{
                border: '1px solid var(--dv-line)', background: 'var(--dv-surface)',
                padding: '5px 10px', borderRadius: 'var(--dv-r-sm)',
                fontSize: 12.5, color: 'var(--dv-ink)', outline: 'none',
              }}
            />
          </div>

          {/* Zeitfenster-Switcher */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--dv-ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ansicht</span>
            <div style={{ display: 'flex', border: '1px solid var(--dv-line)', background: 'var(--dv-surface)', borderRadius: 'var(--dv-r-sm)', overflow: 'hidden' }}>
              {VIEW_MODES.map((mode, i) => (
                <button
                  key={mode.key}
                  onClick={() => applyViewMode(mode.key)}
                  style={{
                    padding: '5px 10px', fontSize: 12, cursor: 'pointer',
                    background: viewMode === mode.key ? 'var(--dv-ink)' : 'transparent',
                    color: viewMode === mode.key ? '#FFF' : 'var(--dv-ink-3)',
                    fontWeight: viewMode === mode.key ? 500 : 400,
                    border: 'none',
                    borderRight: i < VIEW_MODES.length - 1 ? '1px solid var(--dv-line)' : 'none',
                    transition: 'background 120ms',
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '0 24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Status Band */}
        <StatusBand
          co2Current={co2KPI?.value || 0}
          co2Baseline={1_870_000}
        />

        {/* Hero Grid */}
        <div className="dv-hero-grid">
          <HeroKPIs cards={data.kpi_cards} />
          <EnergyMixCard breakdown={data.energy_breakdown} />
        </div>

        {/* Type Cards */}
        <TypeCards
          cards={data.kpi_cards}
          breakdown={data.energy_breakdown}
          charts={data.consumption_chart}
        />

        {/* Row: Trend + Insights */}
        <div className="dv-row-2col">
          <MonthlyTrend charts={data.consumption_chart} granularity={granularity} />
          <InsightsPanel data={data} />
        </div>

        {/* Row: Top-Verbraucher + CO2 */}
        <div className="dv-row-2col">
          <TopConsumers groups={data.top_consumers} />
          <CO2Card cards={data.kpi_cards} />
        </div>
      </div>
    </div>
  );
}

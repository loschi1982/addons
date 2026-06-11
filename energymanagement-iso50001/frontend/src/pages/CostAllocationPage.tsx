/**
 * CostAllocationPage – Tab „Kostenumlage" von Kosten & Wirtschaft.
 * Anteilige Energie-/Kostenverteilung auf Nutzungseinheiten (Zähler-Zuordnung).
 * Redesign nach Claude-Design-Handoff (kosten.css, gescopt unter .kosten).
 */

import { useState, useCallback, useEffect } from 'react';
import { RefreshCw, Wallet, Zap, Building2, Ruler, Info, Calendar } from 'lucide-react';
import { apiClient } from '@/utils/api';
import PageTabs, { COST_TABS } from '@/components/layout/PageTabs';
import PageHead from '@/components/ui/PageHead';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface AllocationUnit {
  usage_unit_id: string;
  usage_unit_name: string;
  code: string | null;
  area_m2: number | null;
  tenant_name: string | null;
  kwh: number;
  cost_net: number;
  cost_gross: number;
  kwh_per_m2: number | null;
  cost_per_m2: number | null;
  meter_count: number;
}

interface AllocationData {
  period_start: string;
  period_end: string;
  units: AllocationUnit[];
  grand_total_kwh: number;
  grand_total_cost_net: number;
  data_available: boolean;
}

const nf = (v: number, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eurShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return nf(v / 1e6, 1) + ' Mio €';
  if (a >= 1000) return nf(Math.round(v / 1000)) + 'k €';
  return nf(Math.round(v)) + ' €';
};
const kwhShort = (v: number) => {
  if (Math.abs(v) >= 1e6) return nf(v / 1e6, 2) + ' GWh';
  if (Math.abs(v) >= 1000) return nf(Math.round(v / 1000)) + ' MWh';
  return nf(Math.round(v)) + ' kWh';
};

export default function CostAllocationPage() {
  const currentYear = new Date().getFullYear();
  const [startDate, setStartDate] = useState(`${currentYear}-01-01`);
  const [endDate, setEndDate] = useState(`${currentYear}-12-31`);
  const [data, setData] = useState<AllocationData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
      const res = await apiClient.get<AllocationData>(`/api/v1/analytics/cost-allocation?${params}`);
      setData(res.data);
    } catch {
      setError('Kostenumlage konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  const units = data?.units ?? [];
  const totalCost = data?.grand_total_cost_net ?? 0;
  const totalKwh = data?.grand_total_kwh ?? 0;
  const totalArea = units.reduce((s, u) => s + (u.area_m2 ?? 0), 0);
  const avgCostPerM2 = totalArea > 0 ? totalCost / totalArea : null;
  const sorted = [...units].sort((a, b) => b.cost_net - a.cost_net);
  const maxShare = Math.max(...sorted.map((u) => (totalCost > 0 ? u.cost_net / totalCost : 0)), 0.01);

  return (
    <div className="kosten">
      <PageTabs tabs={COST_TABS} />
      <PageHead eyebrow="Kosten & Wirtschaft" title="Kostenumlage" />

      <div className="tab-body" style={{ marginTop: 12 }}>
        <p className="tab-sub" style={{ marginTop: 0 }}>
          Anteilige Energie- und Kostenverteilung auf Nutzungseinheiten (basierend auf Zähler-Zuordnungen)
        </p>

        {/* Zeitraum */}
        <div className="period-bar">
          <div className="pf-field">
            <label>Von</label>
            <div className="date-input"><Calendar size={13} color="var(--ink-3)" /><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none' }} /></div>
          </div>
          <div className="pf-field">
            <label>Bis</label>
            <div className="date-input"><Calendar size={13} color="var(--ink-3)" /><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none' }} /></div>
          </div>
          <button className="btn-ghost" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Laden</button>
          {data && (
            <div className="period-note">
              <Info size={13} color="var(--ink-3)" />
              Verteilung aus {units.length} Nutzungseinheiten mit Zähler-Zuordnung &amp; Kostendaten
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '12px 14px', color: 'var(--alert)', fontSize: 13 }}>{error}</div>
        )}

        {loading ? (
          <div className="card" style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : !data || !data.data_available || units.length === 0 ? (
          <div className="empty-pad">
            <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 6 }}>Keine Zuordnungsdaten vorhanden</strong>
            Zähler müssen Nutzungseinheiten zugeordnet sein und Ablesungen mit Kostendaten enthalten.
          </div>
        ) : (
          <>
            {/* Summen */}
            <div className="pf-grid umlage-grid">
              <PortfolioKpi Icon={Wallet} label="Umgelegte Kosten (netto)" value={eurShort(totalCost)} sub={`${data.period_start} – ${data.period_end}`} />
              <PortfolioKpi Icon={Zap} label="Verteilte Energie" value={kwhShort(totalKwh)} sub="über alle Nutzungseinheiten" />
              <PortfolioKpi Icon={Building2} label="Nutzungseinheiten" value={String(units.length)} sub={`${units.reduce((s, u) => s + u.meter_count, 0)} Zähler zugeordnet`} />
              <PortfolioKpi Icon={Ruler} label="Ø Kosten je m²" value={avgCostPerM2 != null ? nf(avgCostPerM2, 2) + ' €' : '—'} sub={totalArea > 0 ? nf(totalArea, 0) + ' m² Gesamtfläche' : 'keine Flächendaten'} />
            </div>

            {/* Tabelle */}
            <div className="umlage-table">
              <div className="ut-row ut-head">
                <div>Nutzungseinheit</div>
                <div>Fläche / Zähler</div>
                <div className="num">Verbrauch</div>
                <div className="num">Anteil</div>
                <div className="num">Kosten netto</div>
              </div>
              {sorted.map((u) => {
                const share = totalCost > 0 ? u.cost_net / totalCost : 0;
                return (
                  <div className="ut-row" key={u.usage_unit_id}>
                    <div className="ut-unit">
                      <div style={{ minWidth: 0 }}>
                        <div className="ut-uname">{u.usage_unit_name}</div>
                        {(u.code || u.tenant_name) && (
                          <div style={{ fontSize: 11, color: 'var(--ink-4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {[u.code, u.tenant_name].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                      {u.area_m2 != null ? `${nf(u.area_m2, 0)} m²` : '—'}
                      {u.kwh_per_m2 != null && <span style={{ color: 'var(--ink-4)' }}> · {nf(u.kwh_per_m2)} kWh/m²</span>}
                      <span style={{ color: 'var(--ink-4)' }}> · {u.meter_count} Z.</span>
                    </div>
                    <div className="num ut-kwh">{nf(u.kwh / 1000, 1)} <span className="u">MWh</span></div>
                    <div className="num">
                      <div className="share-wrap">
                        <div className="share-track"><div className="share-fill" style={{ width: `${(share / maxShare) * 100}%` }} /></div>
                        <span>{(share * 100).toLocaleString('de-DE', { maximumFractionDigits: 1 })} %</span>
                      </div>
                    </div>
                    <div className="num ut-cost">{nf(u.cost_net, 0)} <span className="u">€</span></div>
                  </div>
                );
              })}
              <div className="ut-row ut-total">
                <div>Gesamt</div>
                <div>{totalArea > 0 ? `${nf(totalArea, 0)} m²` : ''}</div>
                <div className="num">{nf(totalKwh / 1000, 1)} <span className="u">MWh</span></div>
                <div className="num">100 %</div>
                <div className="num">{nf(totalCost, 0)} <span className="u">€</span></div>
              </div>
            </div>

            <div className="calc-basis">
              <div className="cb-title">Berechnungsgrundlagen</div>
              <ul>
                <li><strong>Zuordnung:</strong> Verbrauch je Nutzungseinheit aus zugeordneten Zählern (Haupt-/Unterzähler-Hierarchie)</li>
                <li><strong>Kosten:</strong> Netto-Kosten aus den Ablesungen mit hinterlegten Kostendaten im gewählten Zeitraum</li>
                <li><strong>Anteil:</strong> Kosten der Nutzungseinheit ÷ Gesamtkosten des Zeitraums</li>
              </ul>
            </div>
          </>
        )}
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

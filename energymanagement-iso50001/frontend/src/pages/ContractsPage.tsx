/**
 * ContractsPage – Tab „Verträge" von Kosten & Wirtschaft.
 * Energielieferverträge: Laufzeiten, Preisstruktur, Soll-/Ist-Vergleich.
 * Redesign nach Claude-Design-Handoff (kosten.css, gescopt unter .kosten).
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Plus, RefreshCw, AlertTriangle, X, Wallet, Receipt, Clock, Calendar, ArrowRight,
  TrendingUp, TrendingDown, Zap, Flame, Snowflake, Droplet, Fuel, Leaf,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import PageTabs, { COST_TABS } from '@/components/layout/PageTabs';
import PageHead from '@/components/ui/PageHead';
import LoadingSpinner from '@/components/ui/LoadingSpinner';

interface EnergyContract {
  id: string;
  name: string;
  contract_number: string | null;
  supplier: string;
  energy_type: string;
  valid_from: string;
  valid_until: string | null;
  notice_period_days: number | null;
  auto_renewal: boolean;
  contracted_annual_kwh: number | null;
  price_per_kwh: number | null;
  base_fee_monthly: number | null;
  vat_rate: number | null;
  max_demand_kw: number | null;
  renewable_share_percent: number | null;
  notes: string | null;
  meter_ids: string[];
  is_active: boolean;
}

interface Comparison {
  contracted_annual_kwh: number | null;
  contracted_period_kwh: number | null;
  actual_kwh: number;
  actual_cost_net: number;
  deviation_percent: number | null;
  projected_annual_kwh: number | null;
  contracted_price_per_kwh: number | null;
  actual_price_per_kwh: number | null;
  is_expired: boolean;
  expires_soon: boolean;
}

interface EnergyMeta { label: string; color: string; bg: string; text: string; Icon: typeof Zap; unit: string }
const ENERGY_META: Record<string, EnergyMeta> = {
  electricity: { label: 'Strom', color: '#F2C94C', bg: '#FBEFC1', text: '#7A5800', Icon: Zap, unit: 'kWh' },
  natural_gas: { label: 'Erdgas', color: '#9A6B43', bg: '#E9DDCD', text: '#5A3C1F', Icon: Flame, unit: 'kWh' },
  district_heating: { label: 'Fernwärme', color: '#E89A3C', bg: '#FCE7C3', text: '#7B3F0C', Icon: Flame, unit: 'kWh' },
  district_cooling: { label: 'Fernkälte', color: '#4FC3F7', bg: '#D5EFFB', text: '#0B4A6E', Icon: Snowflake, unit: 'kWh' },
  water: { label: 'Wasser', color: '#2A6FDB', bg: '#D6E4F8', text: '#1E3A8A', Icon: Droplet, unit: 'm³' },
  oil: { label: 'Heizöl', color: '#6B6B6B', bg: '#E4E0D6', text: '#44423B', Icon: Fuel, unit: 'l' },
  pellets: { label: 'Holzpellets', color: '#10B981', bg: '#D2F2E1', text: '#0B5B3B', Icon: Leaf, unit: 'kg' },
};
const energyMeta = (k: string): EnergyMeta => ENERGY_META[k] || { label: k, color: '#9A968B', bg: 'var(--surface-2)', text: 'var(--ink-2)', Icon: Zap, unit: 'kWh' };

const ET_LABELS: Record<string, string> = Object.fromEntries(Object.entries(ENERGY_META).map(([k, v]) => [k, v.label]));

const nf = (v: number, d = 0) => v.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const eurShort = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return nf(v / 1e6, 1) + ' Mio €';
  if (a >= 1000) return nf(Math.round(v / 1000)) + 'k €';
  return nf(Math.round(v)) + ' €';
};
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('de-DE') : '—');
const monthsUntil = (d: string | null): number | null => (d ? Math.round((new Date(d).getTime() - Date.now()) / (30 * 86400000)) : null);

const jahreswert = (c: EnergyContract) => (c.contracted_annual_kwh ?? 0) * (c.price_per_kwh ?? 0) + (c.base_fee_monthly ?? 0) * 12;

/* ── Vertragskarte ── */

function ContractCard({ c, cmp, onEdit, onDelete }: { c: EnergyContract; cmp: Comparison | null; onEdit: () => void; onDelete: () => void }) {
  const m = energyMeta(c.energy_type);
  const months = monthsUntil(c.valid_until);
  const notice = (c.notice_period_days ?? 90);
  const expired = months != null && months <= 0;
  const expiresSoon = months != null && months > 0 && months * 30 <= notice + 60;
  const statusTone = expired || expiresSoon ? 'warn' : 'good';
  const statusLabel = expired ? 'abgelaufen' : expiresSoon ? 'läuft aus' : 'aktiv';

  const priceLabel = c.price_per_kwh != null
    ? (m.unit === 'm³' ? `${nf(c.price_per_kwh, 2)} €/m³` : `${nf(c.price_per_kwh * 100, 1)} ct/kWh`)
    : '—';

  // Soll/Ist
  const soll = cmp?.contracted_annual_kwh ?? c.contracted_annual_kwh ?? null;
  const ist = cmp?.projected_annual_kwh ?? null;
  const dev = cmp?.deviation_percent ?? null;
  const over = dev != null && dev > 0;
  const istPct = soll && ist ? Math.min(140, (ist / soll) * 100) : 0;

  return (
    <div className="ct-card">
      <div className="ct-top">
        <div className="ct-energy">
          <span className="ct-eico" style={{ background: m.bg, color: m.text }}><m.Icon size={15} /></span>
          <div>
            <div className="ct-supplier">{c.supplier}</div>
            <div className="ct-nr">{c.name}{c.contract_number ? ` · ${c.contract_number}` : ''}</div>
          </div>
        </div>
        <span className={'k-status ' + statusTone}><span className="dot" />{statusLabel}</span>
      </div>

      <div className="ct-term">
        <div className="ct-term-dates">
          <Calendar size={13} color="var(--ink-3)" />
          <span>{fmtDate(c.valid_from)}</span>
          <span className="ct-arrow"><ArrowRight size={13} /></span>
          <span>{fmtDate(c.valid_until)}</span>
        </div>
        {months != null
          ? <span className={'ct-remain' + (expiresSoon || expired ? ' warn' : '')}>{expired ? 'abgelaufen' : `noch ${months} Monate`}</span>
          : <span className="ct-remain">laufend</span>}
      </div>

      <div className="ct-prices">
        <div className="ct-price"><span className="cp-label">Arbeitspreis</span><span className="cp-val">{priceLabel}</span></div>
        <div className="ct-price"><span className="cp-label">Grundpreis</span><span className="cp-val">{c.base_fee_monthly ? `${nf(c.base_fee_monthly * 12, 0)} €/a` : '—'}</span></div>
        <div className="ct-price"><span className="cp-label">Jahreswert</span><span className="cp-val">{jahreswert(c) > 0 ? eurShort(jahreswert(c)) : '—'}</span></div>
      </div>

      {soll != null && (
        <div className="ct-sollist">
          <div className="ct-si-head">
            <span className="cp-label">Soll-/Ist-Vergleich</span>
            {dev != null ? (
              <span className={'ct-dev ' + (over ? 'neg' : 'pos')}>
                {over ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
                {(dev >= 0 ? '+' : '−') + nf(Math.abs(dev), 1) + ' %'}
              </span>
            ) : (
              <span className="cp-label">kein Ist im Zeitraum</span>
            )}
          </div>
          {ist != null ? (
            <>
              <div className="ct-si-track">
                <div className={'ct-si-fill' + (over ? ' over' : '')} style={{ width: `${Math.min(100, istPct)}%` }} />
                <div className="ct-si-soll" style={{ left: `${Math.min(100, (100 / Math.max(istPct, 100)) * 100)}%` }} title="Vertragsmenge (Soll)" />
              </div>
              <div className="ct-si-vals">
                <span>Ist (Hochr.) <strong>{nf(ist, 0)} {m.unit}</strong></span>
                <span className="dim">Soll {nf(soll, 0)} {m.unit}</span>
              </div>
            </>
          ) : (
            <div className="ct-si-vals"><span className="dim">Soll {nf(soll, 0)} {m.unit} · noch kein Verbrauch erfasst</span></div>
          )}
        </div>
      )}

      <div className="ct-foot">
        <button className="link-btn" onClick={onEdit}>Bearbeiten</button>
        <button className="link-btn" style={{ color: 'var(--alert)' }} onClick={onDelete}>Deaktivieren</button>
      </div>
    </div>
  );
}

/* ── Formular ── */

const EMPTY_FORM = {
  name: '', contract_number: '', supplier: '', energy_type: 'electricity',
  valid_from: '', valid_until: '', notice_period_days: '',
  auto_renewal: false, contracted_annual_kwh: '', price_per_kwh: '',
  base_fee_monthly: '', vat_rate: '19', max_demand_kw: '',
  renewable_share_percent: '', notes: '',
};

function ContractForm({ initial, onSave, onCancel }: { initial?: Partial<typeof EMPTY_FORM>; onSave: (d: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name, supplier: form.supplier, energy_type: form.energy_type,
        valid_from: form.valid_from, auto_renewal: form.auto_renewal,
      };
      if (form.contract_number) payload.contract_number = form.contract_number;
      if (form.valid_until) payload.valid_until = form.valid_until;
      if (form.notice_period_days) payload.notice_period_days = Number(form.notice_period_days);
      if (form.contracted_annual_kwh) payload.contracted_annual_kwh = Number(form.contracted_annual_kwh);
      if (form.price_per_kwh) payload.price_per_kwh = Number(form.price_per_kwh);
      if (form.base_fee_monthly) payload.base_fee_monthly = Number(form.base_fee_monthly);
      if (form.vat_rate) payload.vat_rate = Number(form.vat_rate);
      if (form.max_demand_kw) payload.max_demand_kw = Number(form.max_demand_kw);
      if (form.renewable_share_percent) payload.renewable_share_percent = Number(form.renewable_share_percent);
      if (form.notes) payload.notes = form.notes;
      await onSave(payload);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div><label className="label">Bezeichnung *</label><input className="input w-full" required value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
        <div><label className="label">Vertragsnummer</label><input className="input w-full" value={form.contract_number} onChange={(e) => set('contract_number', e.target.value)} /></div>
        <div><label className="label">Lieferant *</label><input className="input w-full" required value={form.supplier} onChange={(e) => set('supplier', e.target.value)} /></div>
        <div>
          <label className="label">Energieträger *</label>
          <select className="input w-full" value={form.energy_type} onChange={(e) => set('energy_type', e.target.value)}>
            {Object.entries(ET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="label">Gültig ab *</label><input type="date" className="input w-full" required value={form.valid_from} onChange={(e) => set('valid_from', e.target.value)} /></div>
        <div><label className="label">Gültig bis</label><input type="date" className="input w-full" value={form.valid_until} onChange={(e) => set('valid_until', e.target.value)} /></div>
        <div><label className="label">Kündigungsfrist (Tage)</label><input type="number" className="input w-full" min="0" value={form.notice_period_days} onChange={(e) => set('notice_period_days', e.target.value)} /></div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="auto_renewal" checked={form.auto_renewal} onChange={(e) => set('auto_renewal', e.target.checked)} className="h-4 w-4" />
          <label htmlFor="auto_renewal" className="text-sm text-gray-700">Automatische Verlängerung</label>
        </div>
      </div>

      <hr className="border-gray-200" />
      <p className="text-sm font-medium text-gray-700">Preisstruktur</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div><label className="label">Jahresvolumen (kWh)</label><input type="number" className="input w-full" min="0" step="any" value={form.contracted_annual_kwh} onChange={(e) => set('contracted_annual_kwh', e.target.value)} /></div>
        <div><label className="label">Arbeitspreis (€/kWh)</label><input type="number" className="input w-full" min="0" step="any" value={form.price_per_kwh} onChange={(e) => set('price_per_kwh', e.target.value)} /></div>
        <div><label className="label">Grundpreis (€/Monat)</label><input type="number" className="input w-full" min="0" step="any" value={form.base_fee_monthly} onChange={(e) => set('base_fee_monthly', e.target.value)} /></div>
        <div><label className="label">Mehrwertsteuer (%)</label><input type="number" className="input w-full" min="0" max="100" step="any" value={form.vat_rate} onChange={(e) => set('vat_rate', e.target.value)} /></div>
        <div><label className="label">Leistungsgrenze (kW)</label><input type="number" className="input w-full" min="0" step="any" value={form.max_demand_kw} onChange={(e) => set('max_demand_kw', e.target.value)} /></div>
        <div><label className="label">Erneuerbarenanteil (%)</label><input type="number" className="input w-full" min="0" max="100" step="any" value={form.renewable_share_percent} onChange={(e) => set('renewable_share_percent', e.target.value)} /></div>
      </div>
      <div><label className="label">Notizen</label><textarea className="input w-full h-20 resize-none" value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-ghost" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern…' : 'Speichern'}</button>
      </div>
    </form>
  );
}

/* ── Seite ── */

export default function ContractsPage() {
  const currentYear = new Date().getFullYear();
  const [contracts, setContracts] = useState<EnergyContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editContract, setEditContract] = useState<EnergyContract | null>(null);
  const [comparison, setComparison] = useState<Record<string, Comparison>>({});
  const [cmpPeriod, setCmpPeriod] = useState({ start: `${currentYear}-01-01`, end: `${currentYear}-12-31` });

  const loadComparisons = useCallback(async (list: EnergyContract[], period: { start: string; end: string }) => {
    const entries = await Promise.all(
      list.map(async (c) => {
        try {
          const res = await apiClient.get<Comparison>(`/api/v1/contracts/${c.id}/comparison?period_start=${period.start}&period_end=${period.end}`);
          return [c.id, res.data] as const;
        } catch {
          return null;
        }
      })
    );
    const map: Record<string, Comparison> = {};
    for (const e of entries) if (e) map[e[0]] = e[1];
    setComparison(map);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ items: EnergyContract[] }>('/api/v1/contracts?page_size=100');
      setContracts(res.data.items);
      loadComparisons(res.data.items, cmpPeriod);
    } finally {
      setLoading(false);
    }
  }, [cmpPeriod, loadComparisons]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (data: Record<string, unknown>) => {
    if (editContract) {
      await apiClient.put(`/api/v1/contracts/${editContract.id}`, data);
    } else {
      await apiClient.post('/api/v1/contracts', data);
    }
    setShowForm(false);
    setEditContract(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Vertrag wirklich deaktivieren?')) return;
    await apiClient.delete(`/api/v1/contracts/${id}`);
    await load();
  };

  const totalValue = contracts.reduce((s, c) => s + jahreswert(c), 0);
  const active = contracts.filter((c) => { const m = monthsUntil(c.valid_until); return c.valid_until == null || (m != null && m > 0); }).length;
  const expiringList = contracts
    .map((c) => ({ c, m: monthsUntil(c.valid_until) }))
    .filter((x) => x.m != null && x.m > 0)
    .sort((a, b) => (a.m! - b.m!));
  const nextExpiry = expiringList[0];
  const expiringWarn = contracts.filter((c) => {
    const m = monthsUntil(c.valid_until);
    return m != null && m * 30 <= (c.notice_period_days ?? 90) + 60;
  });

  return (
    <div className="kosten">
      <PageTabs tabs={COST_TABS} />
      <PageHead
        eyebrow="Kosten & Wirtschaft"
        title="Energielieferverträge"
        actions={
          <>
            <button className="btn-ghost" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} /></button>
            <button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }} onClick={() => { setEditContract(null); setShowForm(true); }}><Plus size={14} /> Neuer Vertrag</button>
          </>
        }
      />

      <div className="tab-body" style={{ marginTop: 12 }}>
        <p className="tab-sub" style={{ marginTop: 0 }}>Vertragsmanagement: Laufzeiten, Preisstruktur und Soll-/Ist-Vergleich</p>

        {expiringWarn.length > 0 && (
          <div style={{ background: 'color-mix(in srgb, var(--warn) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--warn) 28%, var(--line))', borderRadius: 'var(--r-md)', padding: '11px 14px', fontSize: 12.5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--warn)', fontWeight: 600 }}>
              <AlertTriangle size={14} />{expiringWarn.length} Vertrag{expiringWarn.length > 1 ? 'e' : ''} läuft bald ab oder ist abgelaufen
            </div>
            <div style={{ color: 'var(--ink-3)', marginTop: 4 }}>{expiringWarn.map((c) => `${c.name} (${fmtDate(c.valid_until)})`).join(' · ')}</div>
          </div>
        )}

        {showForm && (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{editContract ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}</h2>
              <button onClick={() => { setShowForm(false); setEditContract(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-3)' }}><X size={18} /></button>
            </div>
            <ContractForm
              initial={editContract ? {
                name: editContract.name, contract_number: editContract.contract_number ?? '', supplier: editContract.supplier,
                energy_type: editContract.energy_type, valid_from: editContract.valid_from, valid_until: editContract.valid_until ?? '',
                notice_period_days: String(editContract.notice_period_days ?? ''), auto_renewal: editContract.auto_renewal,
                contracted_annual_kwh: String(editContract.contracted_annual_kwh ?? ''), price_per_kwh: String(editContract.price_per_kwh ?? ''),
                base_fee_monthly: String(editContract.base_fee_monthly ?? ''), vat_rate: String(editContract.vat_rate ?? '19'),
                max_demand_kw: String(editContract.max_demand_kw ?? ''), notes: editContract.notes ?? '',
              } : undefined}
              onSave={handleSave}
              onCancel={() => { setShowForm(false); setEditContract(null); }}
            />
          </div>
        )}

        {/* KPIs */}
        {contracts.length > 0 && (
          <div className="pf-grid vertrag-grid">
            <PortfolioKpi Icon={Wallet} label="Vertragsvolumen p. a." value={eurShort(totalValue)} sub="Summe Jahreswerte" />
            <PortfolioKpi Icon={Receipt} label="Aktive Verträge" value={String(active)} sub={`von ${contracts.length} gesamt`} />
            <PortfolioKpi Icon={Clock} label="Nächste Verlängerung" value={nextExpiry ? `${nextExpiry.m} Mon.` : '—'} tone={nextExpiry && nextExpiry.m! * 30 <= (nextExpiry.c.notice_period_days ?? 90) + 60 ? 'bad' : undefined} sub={nextExpiry ? `${energyMeta(nextExpiry.c.energy_type).label} · ${fmtDate(nextExpiry.c.valid_until)}` : '—'} />
          </div>
        )}

        {/* Vergleichszeitraum */}
        {contracts.length > 0 && (
          <div className="period-bar">
            <div className="pf-field">
              <label>Vergleich von</label>
              <div className="date-input"><Calendar size={13} color="var(--ink-3)" /><input type="date" value={cmpPeriod.start} onChange={(e) => { const p = { ...cmpPeriod, start: e.target.value }; setCmpPeriod(p); loadComparisons(contracts, p); }} style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none' }} /></div>
            </div>
            <div className="pf-field">
              <label>bis</label>
              <div className="date-input"><Calendar size={13} color="var(--ink-3)" /><input type="date" value={cmpPeriod.end} onChange={(e) => { const p = { ...cmpPeriod, end: e.target.value }; setCmpPeriod(p); loadComparisons(contracts, p); }} style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'var(--ink)', outline: 'none' }} /></div>
            </div>
            <div className="period-note"><Receipt size={13} color="var(--ink-3)" />Soll-/Ist je Vertrag für den gewählten Zeitraum</div>
          </div>
        )}

        {/* Karten */}
        {loading && contracts.length === 0 ? (
          <div className="card" style={{ padding: 24 }}><LoadingSpinner /></div>
        ) : contracts.length === 0 ? (
          <div className="empty-pad">
            <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 6 }}>Keine Verträge</strong>
            Klicke auf „Neuer Vertrag", um einen Energieliefervertrag anzulegen.
          </div>
        ) : (
          <div className="ct-grid">
            {contracts.map((c) => (
              <ContractCard
                key={c.id}
                c={c}
                cmp={comparison[c.id] ?? null}
                onEdit={() => { setEditContract(c); setShowForm(true); }}
                onDelete={() => handleDelete(c.id)}
              />
            ))}
          </div>
        )}

        <div className="calc-basis">
          <div className="cb-title">Hinweise</div>
          <ul>
            <li><strong>Jahreswert:</strong> Vertragsmenge × Arbeitspreis + Grundpreis (ohne Steuern/Umlagen)</li>
            <li><strong>Ist-Hochrechnung:</strong> aus Zählerlesungen des Zeitraums auf 12 Monate hochgerechnet</li>
            <li><strong>Soll-/Ist-Vergleich:</strong> Ist-Abnahme gegenüber vereinbarter Vertragsmenge — Überschreitung ggf. Nachverhandlung</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function PortfolioKpi({ Icon, label, value, sub, tone }: { Icon: typeof Wallet; label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="pf-kpi">
      <div className="pf-kpi-top">
        <span className="pf-ico"><Icon size={14} /></span>
        <span className="pf-label">{label}</span>
      </div>
      <div className="pf-value-row">
        <span className={'pf-value' + (tone ? ' ' + tone : '')}>{value}</span>
      </div>
      {sub && <div className="pf-sub">{sub}</div>}
    </div>
  );
}

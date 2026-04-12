import { useState, useEffect, useCallback } from 'react';
import {
  FileText, Plus, RefreshCw, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, X,
} from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

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
  contract_name: string;
  supplier: string;
  energy_type: string;
  period_start: string;
  period_end: string;
  contracted_annual_kwh: number | null;
  contracted_period_kwh: number | null;
  actual_kwh: number;
  actual_cost_net: number;
  deviation_kwh: number | null;
  deviation_percent: number | null;
  projected_annual_kwh: number | null;
  contracted_price_per_kwh: number | null;
  actual_price_per_kwh: number | null;
  days_in_period: number;
  days_elapsed: number;
  is_expired: boolean;
  expires_soon: boolean;
}

/* ── Hilfsfunktionen ── */

const ET_LABELS: Record<string, string> = {
  electricity: 'Strom',
  natural_gas: 'Erdgas',
  water: 'Wasser',
  district_heating: 'Fernwärme',
  district_cooling: 'Fernkälte',
  oil: 'Heizöl',
  pellets: 'Holzpellets',
};

const ET_COLORS: Record<string, string> = {
  electricity: '#F59E0B',
  natural_gas: '#3B82F6',
  water: '#06B6D4',
  district_heating: '#EF4444',
  district_cooling: '#8B5CF6',
  oil: '#6B7280',
  pellets: '#10B981',
};

function fmt(v: number, digits = 1) {
  return v.toLocaleString('de-DE', { maximumFractionDigits: digits });
}

function fmtEur(v: number) {
  return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
}

function StatusBadge({ contract }: { contract: EnergyContract }) {
  const today = new Date();
  const until = contract.valid_until ? new Date(contract.valid_until) : null;
  const isExpired = until && until < today;
  const noticeMs = (contract.notice_period_days ?? 90) * 86400000;
  const expiresSoon = until && !isExpired && (until.getTime() - today.getTime()) <= noticeMs;

  if (isExpired) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
      <AlertTriangle size={10} /> Abgelaufen
    </span>
  );
  if (expiresSoon) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">
      <AlertTriangle size={10} /> Läuft bald ab
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
      <CheckCircle size={10} /> Aktiv
    </span>
  );
}

/* ── Vertragsformular ── */

const EMPTY_FORM = {
  name: '', contract_number: '', supplier: '', energy_type: 'electricity',
  valid_from: '', valid_until: '', notice_period_days: '',
  auto_renewal: false, contracted_annual_kwh: '', price_per_kwh: '',
  base_fee_monthly: '', vat_rate: '19', max_demand_kw: '',
  renewable_share_percent: '', notes: '',
};

function ContractForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<typeof EMPTY_FORM>;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...EMPTY_FORM, ...initial });
  const [saving, setSaving] = useState(false);

  const set = (k: string, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        supplier: form.supplier,
        energy_type: form.energy_type,
        valid_from: form.valid_from,
        auto_renewal: form.auto_renewal,
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
        <div>
          <label className="label">Bezeichnung *</label>
          <input className="input w-full" required value={form.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Vertragsnummer</label>
          <input className="input w-full" value={form.contract_number} onChange={e => set('contract_number', e.target.value)} />
        </div>
        <div>
          <label className="label">Lieferant *</label>
          <input className="input w-full" required value={form.supplier} onChange={e => set('supplier', e.target.value)} />
        </div>
        <div>
          <label className="label">Energieträger *</label>
          <select className="input w-full" value={form.energy_type} onChange={e => set('energy_type', e.target.value)}>
            {Object.entries(ET_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Gültig ab *</label>
          <input type="date" className="input w-full" required value={form.valid_from} onChange={e => set('valid_from', e.target.value)} />
        </div>
        <div>
          <label className="label">Gültig bis</label>
          <input type="date" className="input w-full" value={form.valid_until} onChange={e => set('valid_until', e.target.value)} />
        </div>
        <div>
          <label className="label">Kündigungsfrist (Tage)</label>
          <input type="number" className="input w-full" min="0" value={form.notice_period_days} onChange={e => set('notice_period_days', e.target.value)} />
        </div>
        <div className="flex items-center gap-2 pt-5">
          <input type="checkbox" id="auto_renewal" checked={form.auto_renewal} onChange={e => set('auto_renewal', e.target.checked)} className="h-4 w-4" />
          <label htmlFor="auto_renewal" className="text-sm text-gray-700">Automatische Verlängerung</label>
        </div>
      </div>

      <hr className="border-gray-200" />
      <p className="text-sm font-medium text-gray-700">Preisstruktur</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="label">Jahresvolumen (kWh)</label>
          <input type="number" className="input w-full" min="0" step="any" value={form.contracted_annual_kwh} onChange={e => set('contracted_annual_kwh', e.target.value)} />
        </div>
        <div>
          <label className="label">Arbeitspreis (€/kWh)</label>
          <input type="number" className="input w-full" min="0" step="any" value={form.price_per_kwh} onChange={e => set('price_per_kwh', e.target.value)} />
        </div>
        <div>
          <label className="label">Grundpreis (€/Monat)</label>
          <input type="number" className="input w-full" min="0" step="any" value={form.base_fee_monthly} onChange={e => set('base_fee_monthly', e.target.value)} />
        </div>
        <div>
          <label className="label">Mehrwertsteuer (%)</label>
          <input type="number" className="input w-full" min="0" max="100" step="any" value={form.vat_rate} onChange={e => set('vat_rate', e.target.value)} />
        </div>
        <div>
          <label className="label">Leistungsgrenze (kW)</label>
          <input type="number" className="input w-full" min="0" step="any" value={form.max_demand_kw} onChange={e => set('max_demand_kw', e.target.value)} />
        </div>
        <div>
          <label className="label">Erneuerbarenanteil (%)</label>
          <input type="number" className="input w-full" min="0" max="100" step="any" value={form.renewable_share_percent} onChange={e => set('renewable_share_percent', e.target.value)} />
        </div>
      </div>

      <div>
        <label className="label">Notizen</label>
        <textarea className="input w-full h-20 resize-none" value={form.notes} onChange={e => set('notes', e.target.value)} />
      </div>

      <div className="flex gap-2 justify-end">
        <button type="button" className="btn-secondary" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Speichern...' : 'Speichern'}
        </button>
      </div>
    </form>
  );
}

/* ── Soll/Ist Vergleichskarte ── */

function ComparisonCard({ cmp }: { cmp: Comparison }) {
  const dev = cmp.deviation_percent;
  const DevIcon = dev === null ? Minus : dev > 5 ? TrendingUp : dev < -5 ? TrendingDown : Minus;
  const devColor = dev === null ? 'text-gray-400' : dev > 5 ? 'text-red-600' : dev < -5 ? 'text-green-600' : 'text-gray-600';

  const progress = cmp.contracted_period_kwh && cmp.contracted_period_kwh > 0
    ? Math.min(100, (cmp.actual_kwh / cmp.contracted_period_kwh) * 100)
    : null;

  return (
    <div className="space-y-3">
      {(cmp.is_expired || cmp.expires_soon) && (
        <div className={`flex items-center gap-2 text-sm p-3 rounded-lg ${cmp.is_expired ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
          <AlertTriangle size={14} />
          {cmp.is_expired
            ? 'Dieser Vertrag ist abgelaufen.'
            : 'Kündigungsfrist läuft bald ab – Vertrag prüfen!'}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card p-3">
          <p className="text-xs text-gray-500">Soll (anteilig)</p>
          <p className="text-lg font-bold text-gray-800">
            {cmp.contracted_period_kwh != null ? `${fmt(cmp.contracted_period_kwh)} kWh` : '–'}
          </p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-gray-500">Ist (tatsächlich)</p>
          <p className="text-lg font-bold text-[#1B5E7B]">{fmt(cmp.actual_kwh)} kWh</p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-gray-500">Abweichung</p>
          <p className={`text-lg font-bold flex items-center gap-1 ${devColor}`}>
            <DevIcon size={14} />
            {dev != null ? `${dev > 0 ? '+' : ''}${fmt(dev, 1)} %` : '–'}
          </p>
        </div>
        <div className="card p-3">
          <p className="text-xs text-gray-500">Hochrechnung Jahr</p>
          <p className="text-lg font-bold text-gray-800">
            {cmp.projected_annual_kwh != null ? `${fmt(cmp.projected_annual_kwh)} kWh` : '–'}
          </p>
        </div>
      </div>

      {progress !== null && (
        <div>
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Verbrauch vs. Vertrag ({fmt(progress, 0)} %)</span>
            <span>{fmt(cmp.actual_kwh)} / {fmt(cmp.contracted_period_kwh!)} kWh</span>
          </div>
          <div className="h-2 bg-gray-100 rounded">
            <div
              className="h-2 rounded transition-all"
              style={{
                width: `${progress}%`,
                backgroundColor: progress > 100 ? '#DC2626' : '#1B5E7B',
              }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-500">Kosten (netto)</p>
          <p className="font-semibold">{fmtEur(cmp.actual_cost_net)}</p>
        </div>
        {cmp.contracted_price_per_kwh != null && (
          <div>
            <p className="text-gray-500">Vertragspreis</p>
            <p className="font-semibold">{cmp.contracted_price_per_kwh.toFixed(4)} €/kWh</p>
          </div>
        )}
        {cmp.actual_price_per_kwh != null && (
          <div>
            <p className="text-gray-500">Effektiver Preis</p>
            <p className="font-semibold">{cmp.actual_price_per_kwh.toFixed(4)} €/kWh</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Hauptkomponente ── */

export default function ContractsPage() {
  const currentYear = new Date().getFullYear();
  const [contracts, setContracts] = useState<EnergyContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editContract, setEditContract] = useState<EnergyContract | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Record<string, Comparison>>({});
  const [cmpPeriod, setCmpPeriod] = useState({
    start: `${currentYear}-01-01`,
    end: `${currentYear}-12-31`,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ items: EnergyContract[] }>('/api/v1/contracts?page_size=100');
      setContracts(res.data.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadComparison = useCallback(async (contractId: string) => {
    if (comparison[contractId]) return;
    try {
      const res = await apiClient.get<Comparison>(
        `/api/v1/contracts/${contractId}/comparison?period_start=${cmpPeriod.start}&period_end=${cmpPeriod.end}`
      );
      setComparison(prev => ({ ...prev, [contractId]: res.data }));
    } catch {
      // kein Verbrauch → ignorieren
    }
  }, [comparison, cmpPeriod]);

  const handleExpand = (id: string) => {
    if (expanded === id) {
      setExpanded(null);
    } else {
      setExpanded(id);
      loadComparison(id);
    }
  };

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

  const today = new Date();
  const expiring = contracts.filter(c => {
    if (!c.valid_until) return false;
    const until = new Date(c.valid_until);
    const notice = (c.notice_period_days ?? 90) * 86400000;
    return until.getTime() - today.getTime() <= notice;
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Energielieferverträge</h1>
          <p className="text-sm text-gray-500 mt-1">
            Vertragsmanagement: Laufzeiten, Preisstruktur und Soll-/Ist-Vergleich
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary flex items-center gap-2" onClick={load} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button className="btn-primary flex items-center gap-2" onClick={() => { setEditContract(null); setShowForm(true); }}>
            <Plus size={16} /> Neuer Vertrag
          </button>
        </div>
      </div>

      {/* Ablauf-Warnung */}
      {expiring.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-center gap-2 text-amber-800 font-medium mb-1">
            <AlertTriangle size={16} />
            {expiring.length} Vertrag{expiring.length > 1 ? 'e' : ''} läuft bald ab oder ist abgelaufen
          </div>
          <div className="text-sm text-amber-700 space-y-0.5">
            {expiring.map(c => (
              <div key={c.id}>
                {c.name} ({c.valid_until ?? 'unbefristet'})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Vertragsformular */}
      {showForm && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              {editContract ? 'Vertrag bearbeiten' : 'Neuer Vertrag'}
            </h2>
            <button onClick={() => { setShowForm(false); setEditContract(null); }}>
              <X size={18} className="text-gray-400 hover:text-gray-700" />
            </button>
          </div>
          <ContractForm
            initial={editContract ? {
              name: editContract.name,
              contract_number: editContract.contract_number ?? '',
              supplier: editContract.supplier,
              energy_type: editContract.energy_type,
              valid_from: editContract.valid_from,
              valid_until: editContract.valid_until ?? '',
              notice_period_days: String(editContract.notice_period_days ?? ''),
              auto_renewal: editContract.auto_renewal,
              contracted_annual_kwh: String(editContract.contracted_annual_kwh ?? ''),
              price_per_kwh: String(editContract.price_per_kwh ?? ''),
              base_fee_monthly: String(editContract.base_fee_monthly ?? ''),
              vat_rate: String(editContract.vat_rate ?? '19'),
              max_demand_kw: String(editContract.max_demand_kw ?? ''),
              notes: editContract.notes ?? '',
            } : undefined}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditContract(null); }}
          />
        </div>
      )}

      {/* Vergleichszeitraum */}
      {contracts.length > 0 && (
        <div className="card p-3 flex flex-wrap gap-3 items-center text-sm">
          <span className="text-gray-600 font-medium">Vergleichszeitraum:</span>
          <input
            type="date"
            className="input py-1 w-36"
            value={cmpPeriod.start}
            onChange={e => { setCmpPeriod(p => ({ ...p, start: e.target.value })); setComparison({}); }}
          />
          <span className="text-gray-400">–</span>
          <input
            type="date"
            className="input py-1 w-36"
            value={cmpPeriod.end}
            onChange={e => { setCmpPeriod(p => ({ ...p, end: e.target.value })); setComparison({}); }}
          />
        </div>
      )}

      {/* Vertragsliste */}
      {contracts.length === 0 && !loading && (
        <div className="card p-12 text-center text-gray-400">
          <FileText size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg font-medium">Keine Verträge</p>
          <p className="text-sm mt-1">Klicke auf „Neuer Vertrag" um einen Energieliefervertrag anzulegen.</p>
        </div>
      )}

      <div className="space-y-2">
        {contracts.map(c => (
          <div key={c.id} className="card overflow-hidden">
            {/* Kopfzeile */}
            <div
              className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
              onClick={() => handleExpand(c.id)}
            >
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: ET_COLORS[c.energy_type] ?? '#9CA3AF' }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-900">{c.name}</span>
                  {c.contract_number && (
                    <span className="text-xs text-gray-400">#{c.contract_number}</span>
                  )}
                  <StatusBadge contract={c} />
                </div>
                <div className="text-sm text-gray-500 mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5">
                  <span>{ET_LABELS[c.energy_type] ?? c.energy_type}</span>
                  <span>{c.supplier}</span>
                  {c.valid_from && <span>ab {c.valid_from}</span>}
                  {c.valid_until && <span>bis {c.valid_until}</span>}
                  {c.price_per_kwh != null && (
                    <span>{c.price_per_kwh.toFixed(4)} €/kWh</span>
                  )}
                  {c.contracted_annual_kwh != null && (
                    <span>{fmt(c.contracted_annual_kwh)} kWh/Jahr</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  className="text-xs text-gray-500 hover:text-[#1B5E7B] px-2 py-1 rounded hover:bg-gray-100"
                  onClick={e => { e.stopPropagation(); setEditContract(c); setShowForm(true); }}
                >
                  Bearbeiten
                </button>
                <button
                  className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50"
                  onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                >
                  Deaktivieren
                </button>
                {expanded === c.id ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
              </div>
            </div>

            {/* Soll-/Ist-Vergleich */}
            {expanded === c.id && (
              <div className="border-t border-gray-100 p-4 bg-gray-50">
                <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <TrendingUp size={14} />
                  Soll-/Ist-Vergleich {cmpPeriod.start} – {cmpPeriod.end}
                </h3>
                {comparison[c.id] ? (
                  <ComparisonCard cmp={comparison[c.id]} />
                ) : (
                  <p className="text-sm text-gray-400">Vergleich wird geladen…</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

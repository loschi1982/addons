import { useEffect, useState } from 'react';
import {
  Euro, Clock, AlertCircle,
  Loader2, RefreshCw, Info,
} from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface AmortizationItem {
  type: 'action_plan' | 'consumer';
  id: string;
  title: string;
  objective_title?: string;
  category?: string;
  status: string;
  investment_total: number;
  purchase_cost?: number;
  installation_cost?: number;
  annual_maintenance_cost: number;
  expected_lifetime_years?: number;
  expected_savings_kwh_pa?: number;
  expected_savings_eur_pa: number;
  expected_savings_co2_kg_pa?: number;
  actual_savings_kwh?: number | null;
  annual_kwh_estimate?: number;
  price_per_kwh: number;
  price_source: 'invoice' | 'readings' | 'tariff_info' | 'fallback';
  price_increase_rate_pct: number;
  target_date?: string;
  completion_date?: string;
  responsible?: string;
  commissioned_at?: string;
  // Amortisationsergebnisse
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

/* ── Hilfsfunktionen ── */

const PRICE_SOURCE_COLORS: Record<string, string> = {
  invoice: 'bg-green-100 text-green-700',
  readings: 'bg-blue-100 text-blue-700',
  tariff_info: 'bg-amber-100 text-amber-700',
  fallback: 'bg-red-100 text-red-700',
};

const PRICE_SOURCE_LABELS: Record<string, string> = {
  invoice: 'Aus Abrechnungen',
  readings: 'Aus Messdaten',
  tariff_info: 'Aus Tarifplan',
  fallback: 'Standardwert',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  planned: { label: 'Geplant', cls: 'bg-gray-100 text-gray-600' },
  in_progress: { label: 'In Umsetzung', cls: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Abgeschlossen', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Abgebrochen', cls: 'bg-red-100 text-red-600' },
  active: { label: 'Aktiv', cls: 'bg-green-100 text-green-700' },
  decommissioned: { label: 'Außer Betrieb', cls: 'bg-gray-100 text-gray-500' },
};

function fmt(val: number, decimals = 1): string {
  return val.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtEur(val: number): string {
  return `${val.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/* ── AmortizationCard ── */

function AmortizationCard({ item }: { item: AmortizationItem }) {
  const [expanded, setExpanded] = useState(false);
  const s = STATUS_LABELS[item.status] ?? { label: item.status, cls: 'bg-gray-100 text-gray-600' };

  const paybackColor =
    item.simple_payback_years == null ? 'text-gray-400' :
    item.simple_payback_years <= 3 ? 'text-green-600' :
    item.simple_payback_years <= 7 ? 'text-amber-600' :
    'text-red-600';

  return (
    <div className={`rounded-lg border ${item.profitable ? 'border-gray-200' : 'border-red-200 bg-red-50'} p-4`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>{s.label}</span>
            <span className="text-xs text-gray-400">
              {item.type === 'action_plan' ? '📋 Aktionsplan' : '⚡ Verbraucher'}
            </span>
            {item.objective_title && (
              <span className="text-xs text-gray-400 truncate">→ {item.objective_title}</span>
            )}
          </div>
          <h3 className="mt-1 text-sm font-semibold text-gray-900 leading-snug">{item.title}</h3>
          {item.responsible && (
            <p className="text-xs text-gray-400 mt-0.5">{item.responsible}</p>
          )}
        </div>

        {/* Amortisationszeit (groß) */}
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold ${paybackColor}`}>
            {item.simple_payback_years != null ? `${fmt(item.simple_payback_years)} a` : '–'}
          </div>
          <div className="text-xs text-gray-400">Amortisation</div>
        </div>
      </div>

      {/* KPI-Zeile */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-md bg-gray-50 p-2 text-center">
          <p className="text-xs text-gray-500">Investition</p>
          <p className="text-sm font-semibold text-gray-800">{fmtEur(item.investment_total)}</p>
        </div>
        <div className="rounded-md bg-gray-50 p-2 text-center">
          <p className="text-xs text-gray-500">Einsparung/Jahr</p>
          <p className="text-sm font-semibold text-green-700">{fmtEur(item.annual_savings_net)}</p>
        </div>
        <div className="rounded-md bg-gray-50 p-2 text-center">
          <p className="text-xs text-gray-500">NPV ({item.expected_lifetime_years ?? 20} J.)</p>
          <p className={`text-sm font-semibold ${item.npv >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {fmtEur(item.npv)}
          </p>
        </div>
        <div className="rounded-md bg-gray-50 p-2 text-center">
          <p className="text-xs text-gray-500">ROI</p>
          <p className={`text-sm font-semibold ${item.roi_pct >= 0 ? 'text-green-700' : 'text-red-600'}`}>
            {fmt(item.roi_pct)} %
          </p>
        </div>
      </div>

      {/* Break-Even + Preis-Info */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
        {item.break_even_year && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Break-even: <strong className="text-gray-700">{item.break_even_year}</strong>
            {item.dynamic_payback_years != null && (
              <span className="text-gray-400"> (dyn. {fmt(item.dynamic_payback_years)} a)</span>
            )}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 font-medium ${PRICE_SOURCE_COLORS[item.price_source]}`}>
          {PRICE_SOURCE_LABELS[item.price_source]}: {(item.price_per_kwh * 100).toFixed(1)} ct/kWh
          {item.price_increase_rate_pct > 0 && ` (+${item.price_increase_rate_pct}%/a)`}
        </span>
      </div>

      {/* Details ausklappen */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-2 text-xs text-primary-600 hover:underline"
      >
        {expanded ? '▲ Weniger' : '▼ Details'}
      </button>

      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 border-t pt-3">
          {item.purchase_cost != null && (
            <><span className="text-gray-400">Kaufpreis</span><span>{fmtEur(item.purchase_cost)}</span></>
          )}
          {item.installation_cost != null && item.installation_cost > 0 && (
            <><span className="text-gray-400">Installation</span><span>{fmtEur(item.installation_cost)}</span></>
          )}
          {item.annual_maintenance_cost > 0 && (
            <><span className="text-gray-400">Wartung/Jahr</span><span>{fmtEur(item.annual_maintenance_cost)}</span></>
          )}
          {item.expected_savings_kwh_pa != null && item.expected_savings_kwh_pa > 0 && (
            <><span className="text-gray-400">Einsparung kWh/a</span><span>{fmt(item.expected_savings_kwh_pa, 0)} kWh</span></>
          )}
          {item.expected_savings_co2_kg_pa != null && item.expected_savings_co2_kg_pa > 0 && (
            <><span className="text-gray-400">CO₂-Einsparung/a</span><span>{fmt(item.expected_savings_co2_kg_pa, 0)} kg</span></>
          )}
          {item.actual_savings_kwh != null && item.actual_savings_kwh > 0 && (
            <><span className="text-gray-400">Ist-Einsparung</span>
              <span className="text-green-700 font-medium">{fmt(item.actual_savings_kwh, 0)} kWh ✓</span>
            </>
          )}
          {item.annual_kwh_estimate != null && item.annual_kwh_estimate > 0 && (
            <><span className="text-gray-400">Verbrauchsschätzung</span><span>{fmt(item.annual_kwh_estimate, 0)} kWh/a</span></>
          )}
          {item.target_date && (
            <><span className="text-gray-400">Zieltermin</span><span>{item.target_date}</span></>
          )}
          {item.commissioned_at && (
            <><span className="text-gray-400">In Betrieb</span><span>{item.commissioned_at}</span></>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Hauptseite ── */

export default function EconomicsPage() {
  const [items, setItems] = useState<AmortizationItem[]>([]);
  const [priceInfo, setPriceInfo] = useState<PriceInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'action_plan' | 'consumer'>('all');

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

  const filtered = items.filter(i => filter === 'all' || i.type === filter);

  // Summen
  const totalInvestment = filtered.reduce((s, i) => s + i.investment_total, 0);
  const totalSavingsPA = filtered.reduce((s, i) => s + i.annual_savings_net, 0);
  const profitableCount = filtered.filter(i => i.profitable).length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Euro className="h-6 w-6 text-primary-600" />
            Wirtschaftlichkeit
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Amortisationsrechnung für Aktionspläne und Investitionen in Verbraucher
          </p>
        </div>
        <button onClick={load} className="btn-secondary flex items-center gap-2" disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Aktualisieren
        </button>
      </div>

      {/* Preis-Info-Banner */}
      {priceInfo && (
        <div className={`rounded-lg border p-3 flex items-start gap-3 ${PRICE_SOURCE_COLORS[priceInfo.price_source]} border-current/20`}>
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          <div className="text-sm">
            <strong>Energiepreis-Basis:</strong>{' '}
            {(priceInfo.price_per_kwh * 100).toFixed(2)} ct/kWh
            {' '}({priceInfo.source_labels[priceInfo.price_source]})
            {priceInfo.price_increase_rate_pct > 0 && (
              <span className="ml-2 opacity-75">
                · Preissteigerung: {priceInfo.price_increase_rate_pct} %/a
              </span>
            )}
            {priceInfo.price_source === 'fallback' && (
              <span className="ml-2 font-medium">
                — Tarif in Zähler-Einstellungen hinterlegen für genauere Berechnung
              </span>
            )}
          </div>
        </div>
      )}

      {/* KPI-Karten */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="card text-center">
            <p className="text-2xl font-bold text-gray-800">{filtered.length}</p>
            <p className="text-xs text-gray-500">Investitionen</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-gray-800">{fmtEur(totalInvestment)}</p>
            <p className="text-xs text-gray-500">Gesamtinvestition</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-green-700">{fmtEur(totalSavingsPA)}</p>
            <p className="text-xs text-gray-500">Netto-Einsparung/Jahr</p>
          </div>
          <div className="card text-center">
            <p className="text-2xl font-bold text-primary-600">{profitableCount} / {filtered.length}</p>
            <p className="text-xs text-gray-500">Wirtschaftlich</p>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'action_plan', 'consumer'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f === 'all' ? 'Alle' : f === 'action_plan' ? '📋 Aktionspläne' : '⚡ Verbraucher'}
          </button>
        ))}
      </div>

      {/* Inhalt */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 className="h-8 w-8 animate-spin mr-3" />
          Lade Wirtschaftlichkeitsdaten…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-12 text-center">
          <Euro className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-gray-500 font-medium mb-2">Keine Investitionsdaten vorhanden</h3>
          <p className="text-sm text-gray-400 max-w-md mx-auto">
            Hinterlege Anschaffungskosten bei Verbrauchern oder Investitionskosten bei
            Aktionsplänen (ISO 50001 → Ziele → Aktionspläne), um die Amortisationsrechnung zu starten.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => (
            <AmortizationCard key={`${item.type}-${item.id}`} item={item} />
          ))}
        </div>
      )}

      {/* Hinweis-Box */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-500 space-y-1">
        <p className="font-medium text-gray-600">Berechnungsgrundlagen</p>
        <p>· <strong>Einfache Amortisation:</strong> Investition ÷ jährliche Nettoeinsparung</p>
        <p>· <strong>Dynamische Amortisation:</strong> Kumulierte Einsparungen mit jährlicher Preissteigerung</p>
        <p>· <strong>NPV (Kapitalwert):</strong> Abdiskontierte Einsparungen über Nutzungsdauer minus Investition (Zinssatz 4 %)</p>
        <p>· <strong>ROI:</strong> (Gesamteinsparung - Investition) ÷ Investition × 100</p>
        <p>· Energiepreise stammen aus: Energieabrechnungen → Messdaten mit Kosten → Tarif-Planwert → Standardwert 30 ct/kWh</p>
      </div>
    </div>
  );
}

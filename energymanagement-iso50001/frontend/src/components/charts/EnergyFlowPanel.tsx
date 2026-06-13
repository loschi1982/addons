/**
 * EnergyFlowPanel – Energieflussdiagramm JE ENERGIEART.
 *
 * Holt /api/v1/analytics/sankey-by-energy und rendert pro Energieträger ein
 * eigenes Sankey (volle Zählerhierarchie bis zu den Verbrauchern) mit Verbrauch
 * in nativer Einheit und verbrauchsanteilig verteilten Bruttokosten.
 * Wird in Analyse (Energiefluss-Tab) und im Standort-Detail verwendet.
 */
import { useEffect, useState } from 'react';
import { apiClient } from '@/utils/api';
import SankeyDiagram from './SankeyDiagram';

interface FlowNode {
  id: string; label: string; type: string; depth?: number;
  consumption_native?: number; unit?: string; cost_eur?: number;
}
interface FlowLink {
  source: number; target: number; value: number;
  value_native?: number; cost_eur?: number; direction?: 'consumption' | 'feed_in';
}
interface EnergyFlow {
  key: string; label: string; unit: string;
  total_consumption_native: number; total_cost_eur: number;
  nodes: FlowNode[]; links: FlowLink[];
}

interface Props {
  siteId?: string;
  startDate: string;
  endDate: string;
}

function fmtNative(v: number, unit: string): string {
  const u = unit || 'kWh';
  if (u === 'kWh') {
    if (v >= 1_000_000) return `${(v / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} GWh`;
    if (v >= 1000) return `${(v / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MWh`;
    return `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh`;
  }
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} ${u}`;
}

function fmtCost(v: number): string {
  return `${v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €`;
}

export default function EnergyFlowPanel({ siteId, startDate, endDate }: Props) {
  const [flows, setFlows] = useState<EnergyFlow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const params: Record<string, string> = { start_date: startDate, end_date: endDate };
        if (siteId) params.site_id = siteId;
        const res = await apiClient.get('/api/v1/analytics/sankey-by-energy', { params });
        if (!cancelled) setFlows(res.data?.energy_types ?? []);
      } catch {
        if (!cancelled) setFlows([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [siteId, startDate, endDate]);

  if (loading) {
    return (
      <div className="flex h-60 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  if (flows.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-gray-400">
        Keine Energiefluss-Daten für den gewählten Zeitraum
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {flows.map((f) => (
        <div key={f.key} className="card">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold text-gray-800">{f.label}</h3>
            <div className="text-sm text-gray-500">
              Verbrauch: <span className="font-medium text-gray-700">{fmtNative(f.total_consumption_native, f.unit)}</span>
              {f.total_cost_eur ? (
                <> · Kosten: <span className="font-medium text-gray-700">{fmtCost(f.total_cost_eur)}</span> (brutto)</>
              ) : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            <SankeyDiagram
              nodes={f.nodes}
              links={f.links}
              width={920}
              height={Math.max(360, Math.min(720, f.nodes.length * 26))}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

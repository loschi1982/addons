/**
 * BenchmarkingPage – Externe Referenz-Kennwerte (VDI 3807, BAFA, GEFMA 124 …)
 * mit Live-Vergleichswerkzeug und gefilterter Referenztabelle.
 * Redesign nach Claude-Design-Handoff (benchmarking.css, gescopt unter .bm).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, Target, Info } from 'lucide-react';
import { apiClient } from '@/utils/api';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import PageHead from '@/components/ui/PageHead';

interface BenchmarkRef {
  id: string;
  building_type: string;
  energy_type: string;
  source: string;
  unit: string;
  value_good: number;
  value_medium: number;
  value_poor: number;
  description: string;
  is_active: boolean;
}

interface CompareReference {
  id: string;
  source: string;
  value_good: number;
  value_medium: number;
  value_poor: number;
  description: string;
}

interface CompareResult {
  building_type: string;
  building_type_label: string;
  energy_type: string;
  energy_type_label: string;
  actual_value: number;
  unit: string;
  rating: string; // good | medium | poor
  deviation_from_medium_pct: number;
  references: CompareReference[];
  no_reference: boolean;
}

const BUILDING_TYPE_LABELS: Record<string, string> = {
  office: 'Büro',
  school: 'Schule',
  hospital: 'Krankenhaus',
  residential: 'Wohngebäude',
  retail: 'Einzelhandel',
  warehouse: 'Lager/Logistik',
  production: 'Produktion',
  hotel: 'Hotel',
  sports_hall: 'Sporthalle',
  data_center: 'Rechenzentrum',
  public_building: 'Öffentliches Gebäude',
};

interface EnergyMeta {
  label: string;
  color: string;
  bg: string;
  text: string;
}
const ENERGY_META: Record<string, EnergyMeta> = {
  electricity: { label: 'Strom', color: '#F2C94C', bg: '#FBEFC1', text: '#7A5800' },
  district_heating: { label: 'Fernwärme', color: '#E89A3C', bg: '#FCE7C3', text: '#7B3F0C' },
  natural_gas: { label: 'Erdgas', color: '#9A6B43', bg: '#E9DDCD', text: '#5A3C1F' },
  cooling: { label: 'Kälte', color: '#4FC3F7', bg: '#D5EFFB', text: '#0B4A6E' },
  water: { label: 'Wasser', color: '#2A6FDB', bg: '#D6E4F8', text: '#1E3A8A' },
  total: { label: 'Gesamt', color: '#6B6B6B', bg: '#E4E0D6', text: '#44423B' },
};
const energyMeta = (k: string): EnergyMeta => ENERGY_META[k] || { label: k, color: '#9A968B', bg: 'var(--surface-2)', text: 'var(--ink-2)' };

interface SourceMeta {
  label: string;
  full: string;
  bg: string;
  text: string;
  border: string;
}
const SOURCE_META: Record<string, SourceMeta> = {
  VDI_3807: { label: 'VDI 3807', full: 'VDI 3807 · Energieverbrauchskennwerte', bg: '#D6E4F8', text: '#1E3A8A', border: '#B9CEF0' },
  BAFA: { label: 'BAFA', full: 'BAFA · Bundesförderung Energieeffizienz', bg: '#D2F2E1', text: '#0B5B3B', border: '#AEE5CC' },
  GEFMA_124: { label: 'GEFMA 124', full: 'GEFMA 124 · Energiecontrolling', bg: '#E0DAF6', text: '#3A2E7A', border: '#CDC3EE' },
  EnEV: { label: 'EnEV', full: 'Energieeinsparverordnung', bg: '#F8E3D6', text: '#7A3B12', border: '#F0CDB9' },
  custom: { label: 'Eigene', full: 'Eigener Referenzwert', bg: '#E7E2D6', text: '#5A564C', border: '#D6CFBE' },
};
const sourceMeta = (s: string): SourceMeta => SOURCE_META[s] || { label: s.replace(/_/g, ' '), full: s, bg: 'var(--surface-2)', text: 'var(--ink-2)', border: 'var(--line)' };

const RATING_TONE: Record<string, string> = { good: 'good', medium: 'warn', poor: 'alert' };
const RATING_LABEL: Record<string, string> = { good: 'Sehr gut', medium: 'Mittel', poor: 'Ineffizient' };

function EChip({ energy }: { energy: string }) {
  const m = energyMeta(energy);
  return (
    <span className="bm-echip" style={{ background: m.bg, color: m.text }}>
      <span className="dot" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

function QBadge({ source }: { source: string }) {
  const m = sourceMeta(source);
  return (
    <span className="q-badge" style={{ background: m.bg, color: m.text, borderColor: m.border }} title={m.full}>
      {m.label}
    </span>
  );
}

function DistBar({ row }: { row: BenchmarkRef }) {
  const total = row.value_poor || 1;
  return (
    <div className="dist" title={`Gut ≤ ${row.value_good} · Mittel ≤ ${row.value_medium} · Schlecht ≤ ${row.value_poor}`}>
      <span className="s-gut" style={{ width: `${(row.value_good / total) * 100}%` }} />
      <span className="s-mittel" style={{ width: `${((row.value_medium - row.value_good) / total) * 100}%` }} />
      <span className="s-schlecht" style={{ width: `${((row.value_poor - row.value_medium) / total) * 100}%` }} />
    </div>
  );
}

export default function BenchmarkingPage() {
  const [allRefs, setAllRefs] = useState<BenchmarkRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filter
  const [query, setQuery] = useState('');
  const [buildingType, setBuildingType] = useState('alle');
  const [energyType, setEnergyType] = useState('alle');
  const [source, setSource] = useState('alle');

  // Vergleich
  const [compareBuilding, setCompareBuilding] = useState('office');
  const [compareEnergy, setCompareEnergy] = useState('electricity');
  const [compareValue, setCompareValue] = useState('');
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);

  const loadRefs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<BenchmarkRef[]>('/api/v1/benchmarks');
      // Backend liefert Duplikate → nach fachlichem Schlüssel deduplizieren
      const seen = new Set<string>();
      const deduped: BenchmarkRef[] = [];
      for (const r of res.data) {
        const key = `${r.building_type}|${r.energy_type}|${r.source}|${r.value_good}|${r.value_medium}|${r.value_poor}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(r);
        }
      }
      setAllRefs(deduped);
    } catch {
      setError('Referenzwerte konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  // Statistik (aus dedupliziertem Datensatz)
  const stats = useMemo(() => {
    const bySource: Record<string, number> = {};
    allRefs.forEach((r) => { bySource[r.source] = (bySource[r.source] || 0) + 1; });
    return { total: allRefs.length, bySource };
  }, [allRefs]);

  const buildingTypes = useMemo(() => Array.from(new Set(allRefs.map((r) => r.building_type))), [allRefs]);
  const energyCounts = useMemo(() => {
    const c: Record<string, number> = {};
    allRefs.forEach((r) => { c[r.energy_type] = (c[r.energy_type] || 0) + 1; });
    return c;
  }, [allRefs]);
  const sourceKeys = useMemo(() => Object.keys(stats.bySource).sort((a, b) => stats.bySource[b] - stats.bySource[a]), [stats]);

  // Gefilterte Tabellenzeilen
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRefs
      .filter((r) => {
        if (buildingType !== 'alle' && r.building_type !== buildingType) return false;
        if (energyType !== 'alle' && r.energy_type !== energyType) return false;
        if (source !== 'alle' && r.source !== source) return false;
        if (q) {
          const hay = `${BUILDING_TYPE_LABELS[r.building_type] || r.building_type} ${energyMeta(r.energy_type).label}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (BUILDING_TYPE_LABELS[a.building_type] || a.building_type).localeCompare(BUILDING_TYPE_LABELS[b.building_type] || b.building_type));
  }, [allRefs, query, buildingType, energyType, source]);

  // Energiearten, die es für den gewählten Vergleichs-Gebäudetyp gibt
  const compareEnergies = useMemo(() => {
    const list = Array.from(new Set(allRefs.filter((r) => r.building_type === compareBuilding).map((r) => r.energy_type)));
    return list.length ? list : ['electricity'];
  }, [allRefs, compareBuilding]);

  useEffect(() => {
    if (!compareEnergies.includes(compareEnergy)) setCompareEnergy(compareEnergies[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareBuilding, compareEnergies]);

  // Live-Vergleich (debounced) gegen das Backend
  useEffect(() => {
    if (!compareValue || isNaN(Number(compareValue))) {
      setCompareResult(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          building_type: compareBuilding,
          energy_type: compareEnergy,
          actual_value: compareValue,
        });
        const res = await apiClient.get<CompareResult>(`/api/v1/benchmarks/compare?${params}`);
        setCompareResult(res.data);
      } catch {
        setCompareResult(null);
      }
    }, 350);
    return () => clearTimeout(handle);
  }, [compareBuilding, compareEnergy, compareValue]);

  const buildingLabel = (k: string) => BUILDING_TYPE_LABELS[k] || k;

  return (
    <div className="bm">
      <PageHead eyebrow="ISO 50001" title="Benchmarking" />
      <div className="head-lead">
        <span className="pip"><span className="dot" /> <strong>{stats.total}</strong>&nbsp;Referenzwerte</span>
        {sourceKeys.slice(0, 4).map((s) => (
          <span key={s} className={'pip' + (s === 'VDI_3807' ? ' vdi' : s === 'BAFA' ? ' bafa' : '')}>
            <span className="dot" /> <strong>{stats.bySource[s]}</strong>&nbsp;{sourceMeta(s).label}
          </span>
        ))}
      </div>

      {error && (
        <div style={{ margin: '14px 0', background: 'color-mix(in srgb, var(--alert) 8%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 30%, var(--line))', borderRadius: 'var(--r-md)', padding: '12px 14px', color: 'var(--alert)', fontSize: 13 }}>
          {error}
        </div>
      )}

      <div className="stack" style={{ marginTop: 16 }}>
        {/* Vergleichswerkzeug */}
        <div className="card bm-compare">
          <div className="bm-compare-form">
            <div>
              <div className="card-title">Eigenen Wert vergleichen</div>
              <div className="card-sub">Spezifischen Kennwert gegen die Referenz einordnen</div>
            </div>
            <div className="bm-inputs">
              <div className="bm-field">
                <label className="bm-label">Gebäudetyp</label>
                <select className="bm-select" value={compareBuilding} onChange={(e) => setCompareBuilding(e.target.value)}>
                  {(buildingTypes.length ? buildingTypes : ['office']).map((t) => (
                    <option key={t} value={t}>{buildingLabel(t)}</option>
                  ))}
                </select>
              </div>
              <div className="bm-field">
                <label className="bm-label">Energieträger</label>
                <select className="bm-select" value={compareEnergy} onChange={(e) => setCompareEnergy(e.target.value)}>
                  {compareEnergies.map((en) => (
                    <option key={en} value={en}>{energyMeta(en).label}</option>
                  ))}
                </select>
              </div>
              <div className="bm-field">
                <label className="bm-label">Eigener Wert</label>
                <div className="bm-input-row">
                  <input
                    className="bm-input"
                    inputMode="decimal"
                    placeholder="z. B. 120"
                    value={compareValue}
                    onChange={(e) => setCompareValue(e.target.value.replace(/[^0-9.,]/g, '').replace(',', '.'))}
                  />
                  <span className="bm-unit-tag">kWh/m²·a</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bm-result">
            <CompareResultView
              result={compareResult}
              hasValue={!!compareValue && !isNaN(Number(compareValue))}
              fallbackTyp={buildingLabel(compareBuilding)}
              fallbackEnergy={compareEnergy}
            />
          </div>
        </div>

        {/* Filterleiste */}
        <div className="toolbar2">
          <div className="search-input2">
            <Search size={13} color="var(--ink-4)" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Gebäudetyp oder Träger suchen…" />
          </div>
          <div className="group">
            Gebäudetyp
            <select className="tb-select" value={buildingType} onChange={(e) => setBuildingType(e.target.value)}>
              <option value="alle">Alle</option>
              {buildingTypes.map((t) => (
                <option key={t} value={t}>{buildingLabel(t)}</option>
              ))}
            </select>
          </div>
          <div className="group">
            Energieträger
            <div className="pill-row">
              <span className={'pill' + (energyType === 'alle' ? ' active' : '')} onClick={() => setEnergyType('alle')}>Alle</span>
              {Object.keys(energyCounts).map((k) => (
                <span key={k} className={'pill' + (energyType === k ? ' active' : '')} onClick={() => setEnergyType(k)}>
                  <span className="dot" style={{ background: energyMeta(k).color }} />
                  {energyMeta(k).label}
                  <span className="count">{energyCounts[k]}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="group">
            Quelle
            <div className="pill-row">
              <span className={'pill' + (source === 'alle' ? ' active' : '')} onClick={() => setSource('alle')}>Alle</span>
              {sourceKeys.map((k) => (
                <span key={k} className={'pill' + (source === k ? ' active' : '')} onClick={() => setSource(k)}>
                  {sourceMeta(k).label}
                  <span className="count">{stats.bySource[k]}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Referenztabelle */}
        <div className="table-wrap">
          <div className="bm-row head">
            <div>Gebäudetyp</div>
            <div>Energieträger</div>
            <div className="q-col">Quelle</div>
            <div className="num-h">Gut<span className="sub">kWh/m²·a</span></div>
            <div className="num-h">Mittel<span className="sub">kWh/m²·a</span></div>
            <div className="num-h">Schlecht<span className="sub">kWh/m²·a</span></div>
            <div className="dist-col">Verteilung</div>
          </div>
          {loading ? (
            <div style={{ padding: 24 }}><LoadingSpinner /></div>
          ) : rows.length === 0 ? (
            <div className="bm-empty">Keine Referenzwerte für diese Filter-Auswahl.</div>
          ) : (
            rows.map((row) => (
              <div className="bm-row" key={row.id}>
                <div className="bm-typ">{buildingLabel(row.building_type)}</div>
                <div><EChip energy={row.energy_type} /></div>
                <div className="q-col"><QBadge source={row.source} /></div>
                <div className="bm-num gut">{row.value_good.toFixed(0)}</div>
                <div className="bm-num mittel">{row.value_medium.toFixed(0)}</div>
                <div className="bm-num schlecht">{row.value_poor.toFixed(0)}</div>
                <div className="dist-col"><DistBar row={row} /></div>
              </div>
            ))
          )}
        </div>

        {/* Fuß */}
        <div className="bm-foot">
          <span><strong style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-mono)' }}>{rows.length}</strong> von {stats.total} Referenzwerten</span>
          <span className="sep">·</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--good)' }} /> Gut</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--warn)' }} /> Mittel</span>
          <span className="legend"><span className="sw" style={{ background: 'var(--alert)' }} /> Schlecht</span>
          <span className="sep">·</span>
          <span>Richtwerte nach VDI 3807 / BAFA-Konvention — vor produktivem Einsatz verifizieren</span>
        </div>
      </div>
    </div>
  );
}

// ── Vergleichs-Ergebnis (Skala + Marker) ──

function CompareResultView({
  result,
  hasValue,
  fallbackTyp,
  fallbackEnergy,
}: {
  result: CompareResult | null;
  hasValue: boolean;
  fallbackTyp: string;
  fallbackEnergy: string;
}) {
  const ref = result?.references?.[0];
  const tone = result ? RATING_TONE[result.rating] || 'neutral' : 'neutral';

  return (
    <>
      <div className="bm-result-head">
        <div className="bm-result-ctx">
          <span className="typ">{result?.building_type_label || fallbackTyp}</span>
          <EChip energy={result?.energy_type || fallbackEnergy} />
          {ref && <QBadge source={ref.source} />}
        </div>
        <span className={'bm-rating ' + tone}>
          <span className="dot" />
          {result && !result.no_reference ? RATING_LABEL[result.rating] || result.rating : '—'}
        </span>
      </div>

      {result && !result.no_reference && ref ? (
        <>
          <Scale gut={ref.value_good} mittel={ref.value_medium} schlecht={ref.value_poor} value={result.actual_value} />
          <div className="bm-note">
            <Target size={14} color={tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--alert)'} />
            <span>
              {ref.description}{' '}
              <span className="src-ref">
                · {result.deviation_from_medium_pct > 0 ? '+' : ''}
                {result.deviation_from_medium_pct.toFixed(0)}% ggü. Median · Skala Gut {ref.value_good} / Mittel {ref.value_medium} / Schlecht {ref.value_poor} · {sourceMeta(ref.source).label}
              </span>
            </span>
          </div>
        </>
      ) : (
        <div className="bm-result-empty">
          <Info size={14} color="var(--ink-4)" />
          {hasValue && result?.no_reference
            ? 'Für diese Kombination liegt kein Referenzwert vor.'
            : 'Wert eingeben, um die Einordnung zu sehen.'}
        </div>
      )}
    </>
  );
}

function Scale({ gut, mittel, schlecht, value }: { gut: number; mittel: number; schlecht: number; value: number }) {
  const max = schlecht * 1.25 || 1;
  const pos = (x: number) => Math.max(0, Math.min(100, (x / max) * 100));
  return (
    <div className="scale-wrap">
      <div className="scale">
        <span className="scale-cap lo">sparsam</span>
        <span className="scale-cap hi">ineffizient</span>
        <span className="scale-tick" style={{ left: `${pos(gut)}%` }} data-label={gut} />
        <span className="scale-tick" style={{ left: `${pos(mittel)}%` }} data-label={mittel} />
        <span className="scale-tick" style={{ left: `${pos(schlecht)}%` }} data-label={schlecht} />
        <span className="scale-marker" style={{ left: `${pos(value)}%` }}>
          <span className="bubble">{value}</span>
          <span className="pin" />
        </span>
      </div>
    </div>
  );
}

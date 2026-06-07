import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Search, Table2, LayoutGrid, Plus, Pencil, Power, RefreshCw,
  Fan, Lightbulb, Factory, Wind, Snowflake, Gauge, Cog, Server, Box,
  X, Sparkles, Shield, MapPin, History, type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';
import { useSiteHierarchy } from '@/hooks/useSiteHierarchy';
import PageHead from '@/components/ui/PageHead';
import { EM_ENERGY, type EnergyKey } from '@/utils/energyPalette';

// ── Typen ──

interface Consumer {
  id: string;
  name: string;
  category: string;
  rated_power_kw: number | null;
  operating_hours_per_year: number | null;
  estimated_annual_kwh: number | null;
  expected_lifetime_years: number | null;
  priority: string;
  usage_unit_id: string | null;
  usage_unit_name?: string | null;
  building_name?: string | null;
  site_name?: string | null;
  description: string | null;
  meter_ids: string[];
  manufacturer: string | null;
  model: string | null;
  serial_number: string | null;
  commissioned_at: string | null;
  decommissioned_at: string | null;
  replaced_by_id: string | null;
  replaced_by_name: string | null;
  created_at: string;
}

interface MeterOption { id: string; name: string; energy_type: string; }

interface ConsumerForm {
  name: string;
  category: string;
  rated_power_kw: string;
  operating_hours_per_year: string;
  priority: string;
  description: string;
  meter_ids: string[];
  manufacturer: string;
  model: string;
  serial_number: string;
  commissioned_at: string;
  decommissioned_at: string;
  replaced_by_id: string;
}

const emptyForm: ConsumerForm = {
  name: '', category: 'hvac', rated_power_kw: '', operating_hours_per_year: '',
  priority: 'normal', description: '', meter_ids: [], manufacturer: '', model: '',
  serial_number: '', commissioned_at: '', decommissioned_at: '', replaced_by_id: '',
};

// Kategorie-Meta: Label, Energieart (für Chip/Akzent), erwartete Nutzungsdauer (Jahre), Icon.
interface CatMeta { label: string; energy: EnergyKey; life: number; icon: LucideIcon; }
const CAT_META: Record<string, CatMeta> = {
  hvac:           { label: 'Heizung/Lüftung/Klima', energy: 'fernwaerme', life: 20, icon: Fan },
  lighting:       { label: 'Beleuchtung',            energy: 'strom',      life: 12, icon: Lightbulb },
  production:     { label: 'Produktion',             energy: 'strom',      life: 20, icon: Factory },
  compressed_air: { label: 'Druckluft',              energy: 'strom',      life: 15, icon: Wind },
  cooling:        { label: 'Kälte',                  energy: 'kaelte',     life: 18, icon: Snowflake },
  pumps:          { label: 'Pumpen',                 energy: 'strom',      life: 15, icon: Gauge },
  drives:         { label: 'Antriebe',               energy: 'strom',      life: 25, icon: Cog },
  it:             { label: 'IT / Rechenzentrum',     energy: 'strom',      life: 6,  icon: Server },
  other:          { label: 'Sonstige',               energy: 'strom',      life: 15, icon: Box },
};
const catMeta = (k: string): CatMeta => CAT_META[k] ?? CAT_META.other;
const CATEGORY_ORDER = Object.keys(CAT_META);

const PRIORITIES: Record<string, string> = { high: 'Hoch', normal: 'Normal', low: 'Niedrig' };

// ── Helper ──

const estAnnualKwh = (c: Consumer): number => {
  if (c.estimated_annual_kwh != null) return c.estimated_annual_kwh;
  return Math.round((c.rated_power_kw ?? 0) * (c.operating_hours_per_year ?? 0));
};
const isActive = (c: Consumer): boolean => !c.decommissioned_at;
const isSEU = (c: Consumer): boolean => isActive(c) && (c.priority === 'high' || estAnnualKwh(c) >= 300_000);

function lifePct(c: Consumer): number {
  if (!c.commissioned_at) return 0;
  const start = new Date(c.commissioned_at).getTime();
  const end = c.decommissioned_at ? new Date(c.decommissioned_at).getTime() : Date.now();
  const years = (end - start) / (365.25 * 24 * 3600 * 1000);
  const life = c.expected_lifetime_years ?? catMeta(c.category).life;
  return years / life;
}
type Life = 'ok' | 'soon' | 'eol' | 'off';
function lifeStatus(c: Consumer): Life {
  if (!isActive(c)) return 'off';
  const p = lifePct(c);
  if (p >= 1) return 'eol';
  if (p >= 0.8) return 'soon';
  return 'ok';
}

const fmt = (n: number) => Math.round(n).toLocaleString('de-DE');
function fmtEnergy(kwh: number): { val: string; unit: string } {
  if (kwh >= 1_000_000) return { val: (kwh / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 2 }), unit: 'Mio. kWh' };
  if (kwh >= 10_000) return { val: (kwh / 1_000).toLocaleString('de-DE', { maximumFractionDigits: 0 }), unit: 'MWh' };
  return { val: kwh.toLocaleString('de-DE'), unit: 'kWh' };
}
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('de-DE') : '—');

// ── Komponente ──

type ViewMode = 'table' | 'cards';

// Lädt alle Seiten eines Status (Backend cappt page_size auf 100).
async function fetchAllConsumers(status: string): Promise<Consumer[]> {
  const all: Consumer[] = [];
  let page = 1;
  let total = 0;
  do {
    const res = await apiClient.get<PaginatedResponse<Consumer>>(
      `/api/v1/consumers?status=${status}&page=${page}&page_size=100`,
    );
    all.push(...res.data.items);
    total = res.data.total;
    page++;
  } while (all.length < total && page < 50);
  return all;
}

export default function ConsumersPage() {
  // Anzeige-Liste (server-seitig nach Status gefiltert) + aktive Liste für KPIs.
  const [list, setList] = useState<Consumer[]>([]);
  const [activeList, setActiveList] = useState<Consumer[]>([]);
  const [allTotal, setAllTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [view, setView] = useState<ViewMode>(() => {
    try { return localStorage.getItem('em_consumers_view') === 'cards' ? 'cards' : 'table'; } catch { return 'table'; }
  });
  useEffect(() => { try { localStorage.setItem('em_consumers_view', view); } catch { /* ignore */ } }, [view]);

  const [query, setQuery] = useState('');
  const [catFilter, setCatFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'all' | 'decommissioned'>('active');

  // Modals
  const [modal, setModal] = useState<{ editing: Consumer | null } | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<Consumer | null>(null);
  const [decommissionTarget, setDecommissionTarget] = useState<Consumer | null>(null);

  // Anzeige-Liste server-seitig nach Status laden; aktive Liste + Gesamtzahl
  // separat für den KPI-Strip (das DTO erlaubt keine zuverlässige Aktiv-
  // Erkennung über status=all).
  const loadConsumers = useCallback(async () => {
    setLoading(true);
    try {
      const active = await fetchAllConsumers('active');
      setActiveList(active);

      const allHead = await apiClient.get<PaginatedResponse<Consumer>>('/api/v1/consumers?status=all&page=1&page_size=1');
      setAllTotal(allHead.data.total);

      const display = statusFilter === 'active'
        ? active
        : await fetchAllConsumers(statusFilter);
      setList(display);
    } catch {
      /* interceptor */
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { loadConsumers(); }, [loadConsumers]);

  // Client-seitig nur Suche + Kategorie filtern (Status kommt vom Server).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter((c) => {
      if (catFilter && c.category !== catFilter) return false;
      if (q) {
        const hay = `${c.name} ${c.manufacturer ?? ''} ${c.model ?? ''} ${catMeta(c.category).label}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const aa = isActive(a), ba = isActive(b);
      if (aa !== ba) return aa ? -1 : 1;
      return estAnnualKwh(b) - estAnnualKwh(a);
    });
  }, [list, query, catFilter]);

  const maxEst = useMemo(() => Math.max(1, ...filtered.map(estAnnualKwh)), [filtered]);

  // KPI-Aggregate: Gesamtzahl vom Server, aktive Kennzahlen aus activeList.
  const kpi = useMemo(() => {
    const totalEst = activeList.reduce((a, c) => a + estAnnualKwh(c), 0);
    return {
      total: allTotal,
      active: activeList.length,
      inactive: Math.max(0, allTotal - activeList.length),
      totalEst: fmtEnergy(totalEst),
      seu: activeList.filter(isSEU).length,
      eol: activeList.filter((c) => lifeStatus(c) !== 'ok').length,
    };
  }, [activeList, allTotal]);

  const handleDecommission = async (c: Consumer, date: string) => {
    try {
      await apiClient.put(`/api/v1/consumers/${c.id}`, { decommissioned_at: date });
      setDecommissionTarget(null);
      loadConsumers();
    } catch { /* interceptor */ }
  };

  const StatusBadge = ({ c }: { c: Consumer }) => {
    if (!isActive(c)) return <span className="v-status v-status--off"><span className="dot" />Außer Betrieb</span>;
    const ls = lifeStatus(c);
    if (ls === 'eol') return <span className="v-status v-status--eol"><span className="dot" />Lebensende</span>;
    if (ls === 'soon') return <span className="v-status v-status--soon"><span className="dot" />Ersatz prüfen</span>;
    return <span className="v-status v-status--on"><span className="dot" />In Betrieb</span>;
  };

  const EnergyChip = ({ category, compact }: { category: string; compact?: boolean }) => {
    const tone = EM_ENERGY[catMeta(category).energy];
    return (
      <span className="v-echip" style={{ background: tone.bg, color: tone.text }}>
        <span className="dot" style={{ background: tone.color }} />
        {!compact && tone.label}
      </span>
    );
  };

  return (
    <div className="consumers">
      <PageHead
        eyebrow="Stammdaten"
        title="Verbraucher"
        actions={
          <button onClick={() => setModal({ editing: null })} className="btn-primary">
            <Plus className="h-4 w-4" /> Neuer Verbraucher
          </button>
        }
      />
      <p style={{ marginTop: -4, fontSize: 12, color: 'var(--ink-3)' }}>
        Großverbraucher und energetisch relevante Anlagen nach ISO&nbsp;50001
      </p>

      <div className="vb-content" style={{ marginTop: 14 }}>
        {/* KPI-Strip */}
        <div className="stats-strip">
          <div className="stats-cell">
            <div className="stats-label">Verbraucher gesamt</div>
            <div className="stats-value">{kpi.total}</div>
            <div className="stats-sub">{kpi.active} aktiv · {kpi.inactive} außer Betrieb</div>
          </div>
          <div className="stats-cell accent">
            <div className="stats-label">Geschätzter Jahresverbrauch</div>
            <div className="stats-value">{kpi.totalEst.val}<span className="u">{kpi.totalEst.unit}</span></div>
            <div className="stats-sub">Nennleistung × Betriebsstunden, aktive Anlagen</div>
          </div>
          <div className="stats-cell">
            <div className="stats-label">Wesentliche Einsätze (SEU)</div>
            <div className="stats-value">{kpi.seu}</div>
            <div className="stats-sub">nach ISO 50001 priorisiert</div>
          </div>
          <div className="stats-cell">
            <div className="stats-label">Lebenszyklus-Hinweise</div>
            <div className="stats-value" style={{ color: kpi.eol > 0 ? 'var(--warn)' : 'var(--ink)' }}>{kpi.eol}</div>
            <div className="stats-sub">Ersatz prüfen / Lebensende erreicht</div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="vb-toolbar">
          <div className="search-input">
            <Search size={14} style={{ color: 'var(--ink-4)' }} />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Suche nach Name, Beschreibung, Hersteller, Modell…" />
          </div>
          <select className="vb-select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">Alle Kategorien</option>
            {CATEGORY_ORDER.map((k) => <option key={k} value={k}>{CAT_META[k].label}</option>)}
          </select>
          <select className="vb-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
            <option value="active">Nur aktive</option>
            <option value="all">Alle Status</option>
            <option value="decommissioned">Außer Betrieb</option>
          </select>
          <div className="view-toggle">
            <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><Table2 size={13} /> Tabelle</button>
            <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}><LayoutGrid size={13} /> Karten</button>
          </div>
        </div>

        {loading ? (
          <div className="vb-empty"><div className="ico"><RefreshCw size={22} className="animate-spin" /></div><strong>Lade Verbraucher…</strong></div>
        ) : filtered.length === 0 ? (
          <div className="vb-empty">
            <div className="ico"><Box size={22} /></div>
            <strong>Keine Verbraucher gefunden</strong>
            <p>{allTotal === 0 ? 'Legen Sie den ersten Verbraucher an.' : 'Passen Sie Suche oder Filter an, um Einträge zu sehen.'}</p>
            <button className="btn-primary" style={{ margin: '0 auto' }} onClick={() => setModal({ editing: null })}>
              <Plus size={14} /> Neuer Verbraucher
            </button>
          </div>
        ) : view === 'table' ? (
          <div className="vb-table">
            <div className="vb-tr head">
              <div className="vb-stripe" />
              <div>Verbraucher</div>
              <div>Energieart</div>
              <div>Leistung</div>
              <div>Jahresverbrauch (geschätzt)</div>
              <div>Position</div>
              <div>Status</div>
              <div style={{ textAlign: 'right', paddingRight: 18 }}>Aktionen</div>
            </div>
            {filtered.map((c) => {
              const cm = catMeta(c.category);
              const tone = EM_ENERGY[cm.energy];
              const est = fmtEnergy(estAnnualKwh(c));
              const pct = Math.max(3, (estAnnualKwh(c) / maxEst) * 100);
              const active = isActive(c);
              const Icon = cm.icon;
              return (
                <div key={c.id} className={`vb-tr row${active ? '' : ' inactive'}`} onClick={() => setModal({ editing: c })}>
                  <div className="vb-stripe" style={{ background: tone.color }} />
                  <div className="vb-name-cell">
                    <div className="vb-name">
                      <span className="txt">{c.name}</span>
                      {isSEU(c) && <span className="v-seu">SEU</span>}
                    </div>
                    <div className="vb-name-sub">
                      <span className="cat-ico"><Icon size={12} /></span>
                      {cm.label}
                      {c.meter_ids?.length > 0 && (
                        <span className="vb-meter-tag"><Gauge size={11} /> {c.meter_ids.length} Zähler</span>
                      )}
                    </div>
                  </div>
                  <div><EnergyChip category={c.category} /></div>
                  <div className="vb-power">
                    <div><span className="kw">{c.rated_power_kw != null ? fmt(c.rated_power_kw) : '—'}</span> kW</div>
                    <div className="h">{c.operating_hours_per_year ? fmt(c.operating_hours_per_year) + ' h/a' : '—'}</div>
                  </div>
                  <div className="vb-cons">
                    <div className="vb-cons-val">{est.val}<span className="u">{est.unit}</span></div>
                    <div className="vb-cons-bar"><div className="vb-cons-fill" style={{ width: `${pct}%`, background: tone.color }} /></div>
                  </div>
                  <div className="vb-pos">
                    <div className="b">{c.building_name || c.site_name || '— keine Zuordnung —'}</div>
                    {c.usage_unit_name && <div className="u">{c.usage_unit_name}</div>}
                  </div>
                  <div className="vb-status-cell"><StatusBadge c={c} /></div>
                  <div className="vb-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="vb-iconbtn" title="Bearbeiten" onClick={() => setModal({ editing: c })}><Pencil size={14} /></button>
                    {active && (
                      <>
                        <button className="vb-iconbtn" title="Durch Nachfolger ersetzen" onClick={() => setReplaceTarget(c)}><RefreshCw size={14} /></button>
                        <button className="vb-iconbtn warn" title="Außer Betrieb nehmen" onClick={() => setDecommissionTarget(c)}><Power size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="vb-grid">
            {filtered.map((c) => {
              const cm = catMeta(c.category);
              const tone = EM_ENERGY[cm.energy];
              const est = fmtEnergy(estAnnualKwh(c));
              const active = isActive(c);
              const Icon = cm.icon;
              const ls = lifeStatus(c);
              const pct = Math.min(100, Math.max(0, lifePct(c) * 100));
              return (
                <div key={c.id} className={`vb-card${active ? '' : ' inactive'}`}
                  style={{ ['--card-accent' as string]: tone.color }} onClick={() => setModal({ editing: c })}>
                  <div className="vb-card-head">
                    <div style={{ minWidth: 0 }}>
                      <div className="vb-card-title">{c.name}</div>
                      <div className="vb-card-cat"><span className="cat-ico"><Icon size={12} /></span>{cm.label}</div>
                    </div>
                    <EnergyChip category={c.category} compact />
                  </div>
                  <div className="vb-card-cons">
                    <span className="n">{est.val}</span><span className="u">{est.unit}</span>
                    <span className="lbl">geschätzter Jahresverbrauch</span>
                  </div>
                  <div className="vb-card-meta">
                    <div><div className="l">Nennleistung</div><div className="v">{c.rated_power_kw != null ? fmt(c.rated_power_kw) : '—'} kW</div></div>
                    <div><div className="l">Betriebsstunden</div><div className="v">{c.operating_hours_per_year ? fmt(c.operating_hours_per_year) + ' h/a' : '—'}</div></div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="l">Position</div>
                      <div className="v" style={{ fontFamily: 'var(--font-sans)' }}>
                        {c.building_name || c.site_name || '—'}{c.usage_unit_name ? ' · ' + c.usage_unit_name : ''}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="l">Zähler</div>
                      <div className="v" style={{ fontFamily: 'var(--font-sans)' }}>
                        {c.meter_ids?.length > 0
                          ? <span className="vb-meter-tag"><Gauge size={12} /> {c.meter_ids.length} zugeordnet</span>
                          : <span style={{ color: 'var(--ink-4)' }}>keine Zuordnung</span>}
                      </div>
                    </div>
                  </div>
                  {c.commissioned_at && (
                    <div className="v-life">
                      <div className="v-life-track"><div className={`v-life-fill v-life-fill--${active ? ls : 'off'}`} style={{ width: `${active ? pct : 100}%` }} /></div>
                      <div className="v-life-meta">
                        <span>Inbetriebnahme {fmtDate(c.commissioned_at)}</span>
                        <span>{active ? `${Math.round(pct)}% der Nutzungsdauer` : 'außer Betrieb'}</span>
                      </div>
                    </div>
                  )}
                  <div className="vb-card-foot">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <StatusBadge c={c} />
                      {isSEU(c) && <span className="v-seu">SEU</span>}
                    </div>
                    <div className="vb-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="vb-iconbtn" title="Bearbeiten" onClick={() => setModal({ editing: c })}><Pencil size={14} /></button>
                      {active && (
                        <>
                          <button className="vb-iconbtn" title="Durch Nachfolger ersetzen" onClick={() => setReplaceTarget(c)}><RefreshCw size={14} /></button>
                          <button className="vb-iconbtn warn" title="Außer Betrieb nehmen" onClick={() => setDecommissionTarget(c)}><Power size={14} /></button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {modal && (
        <ConsumerModal
          editing={modal.editing}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadConsumers(); }}
        />
      )}
      {replaceTarget && (
        <ConsumerModal
          editing={null}
          replaceTarget={replaceTarget}
          onClose={() => setReplaceTarget(null)}
          onSaved={() => { setReplaceTarget(null); loadConsumers(); }}
        />
      )}
      {decommissionTarget && (
        <DecommissionModal
          target={decommissionTarget}
          onClose={() => setDecommissionTarget(null)}
          onConfirm={(date) => handleDecommission(decommissionTarget, date)}
        />
      )}
    </div>
  );
}

// ── Confirm-Dialog: Außer Betrieb nehmen (Lebensende dokumentieren) ──

function DecommissionModal({ target, onClose, onConfirm }: {
  target: Consumer;
  onClose: () => void;
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const tone = EM_ENERGY[catMeta(target.category).energy];
  return (
    <div className="v-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v-modal sm">
        <div className="v-m-head">
          <div>
            <div className="v-m-title">Außer Betrieb nehmen</div>
            <div className="v-m-sub">Lebensende dokumentieren</div>
          </div>
          <button className="v-m-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="v-confirm-body">
          <div className="target">
            <span className="v-stripe-sm" style={{ background: tone.color, alignSelf: 'stretch', minHeight: 30 }} />
            <div>
              <div className="nm">{target.name}</div>
              <div className="sub">{catMeta(target.category).label}</div>
            </div>
          </div>
          <p style={{ margin: '0 0 6px' }}>Die Anlage wird als <strong>außer Betrieb</strong> markiert und aus den aktiven Verbrauchern entfernt. Sie bleibt für Historie und Nachweis erhalten.</p>
          <div className="v-field" style={{ marginTop: 12, marginBottom: 6 }}>
            <label>Außerbetriebnahme</label>
            <input type="date" className="v-inp mono" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="iso-note"><Shield size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} /> Nach ISO 50001 wird die Stilllegung im Lebenszyklus protokolliert.</div>
        </div>
        <div className="v-m-foot">
          <div className="btns">
            <button className="v-btn-soft" onClick={onClose}>Abbrechen</button>
            <button className="btn-primary" onClick={() => onConfirm(date)}><Power size={13} /> Außer Betrieb nehmen</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create/Edit/Replace-Modal ──

function ConsumerModal({ editing, replaceTarget, onClose, onSaved }: {
  editing: Consumer | null;
  replaceTarget?: Consumer;
  onClose: () => void;
  onSaved: () => void;
}) {
  const replaceMode = !!replaceTarget;
  const seed = editing ?? replaceTarget ?? null;

  const [f, setF] = useState<ConsumerForm>(() => {
    if (!seed) return emptyForm;
    return {
      name: replaceMode ? `${seed.name} (Nachfolger)` : seed.name,
      category: seed.category,
      rated_power_kw: seed.rated_power_kw?.toString() ?? '',
      operating_hours_per_year: seed.operating_hours_per_year?.toString() ?? '',
      priority: seed.priority || 'normal',
      description: replaceMode ? '' : (seed.description ?? ''),
      meter_ids: replaceMode ? [...(seed.meter_ids ?? [])] : (seed.meter_ids ?? []),
      manufacturer: replaceMode ? '' : (seed.manufacturer ?? ''),
      model: replaceMode ? '' : (seed.model ?? ''),
      serial_number: replaceMode ? '' : (seed.serial_number ?? ''),
      commissioned_at: replaceMode ? new Date().toISOString().slice(0, 10) : (seed.commissioned_at ?? ''),
      decommissioned_at: replaceMode ? '' : (seed.decommissioned_at ?? ''),
      replaced_by_id: replaceMode ? '' : (seed.replaced_by_id ?? ''),
    };
  });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meters, setMeters] = useState<MeterOption[]>([]);
  const [allConsumers, setAllConsumers] = useState<{ id: string; name: string }[]>([]);

  const hierarchy = useSiteHierarchy(seed?.usage_unit_id || undefined);
  const set = (k: keyof ConsumerForm, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    apiClient.get('/api/v1/meters?page_size=200')
      .then((res) => setMeters((res.data.items || []).map((m: Record<string, unknown>) => ({
        id: m.id as string, name: m.name as string, energy_type: m.energy_type as string,
      }))))
      .catch(() => { /* ignore */ });
  }, []);

  useEffect(() => {
    if (!editing) return;
    apiClient.get<PaginatedResponse<Consumer>>('/api/v1/consumers?page_size=200&status=active')
      .then((res) => setAllConsumers((res.data.items || []).filter((c) => c.id !== editing.id).map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => { /* ignore */ });
  }, [editing]);

  const addMeter = (id: string) => { if (id) setF((p) => p.meter_ids.includes(id) ? p : { ...p, meter_ids: [...p.meter_ids, id] }); };
  const removeMeter = (id: string) => setF((p) => ({ ...p, meter_ids: p.meter_ids.filter((x) => x !== id) }));

  const assignedMeters = f.meter_ids.map((id) => meters.find((m) => m.id === id)).filter(Boolean) as MeterOption[];
  const availableMeters = meters.filter((m) => !f.meter_ids.includes(m.id));

  const estKwh = (parseFloat(f.rated_power_kw.replace(',', '.')) || 0) * (parseFloat(f.operating_hours_per_year.replace(',', '.')) || 0);
  const estView = fmtEnergy(Math.round(estKwh));
  const wouldBeSEU = f.priority === 'high' || estKwh >= 300_000;
  const nameOk = f.name.trim().length > 0;
  const title = replaceMode ? `Verbraucher ersetzen: ${replaceTarget!.name}` : editing ? 'Verbraucher bearbeiten' : 'Neuer Verbraucher';

  const submit = async () => {
    setTouched(true);
    if (!nameOk) return;
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = {
      name: f.name.trim(),
      category: f.category,
      priority: f.priority,
      usage_unit_id: hierarchy.selectedUnitId || null,
      meter_ids: f.meter_ids,
    };
    if (f.rated_power_kw) payload.rated_power_kw = parseFloat(f.rated_power_kw.replace(',', '.'));
    if (f.operating_hours_per_year) payload.operating_hours_per_year = parseInt(f.operating_hours_per_year.replace(',', '.'), 10);
    if (f.description) payload.description = f.description.trim();
    if (f.manufacturer) payload.manufacturer = f.manufacturer.trim();
    if (f.model) payload.model = f.model.trim();
    if (f.serial_number) payload.serial_number = f.serial_number.trim();
    if (f.commissioned_at) payload.commissioned_at = f.commissioned_at;
    if (f.decommissioned_at) payload.decommissioned_at = f.decommissioned_at;
    if (f.replaced_by_id) payload.replaced_by_id = f.replaced_by_id;
    try {
      if (replaceMode) {
        await apiClient.post(`/api/v1/consumers/${replaceTarget!.id}/replace`, payload);
      } else if (editing) {
        await apiClient.put(`/api/v1/consumers/${editing.id}`, payload);
      } else {
        await apiClient.post('/api/v1/consumers', payload);
      }
      onSaved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="v-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v-modal">
        <div className="v-m-head">
          <div>
            <div className="v-m-title">{title}</div>
            <div className="v-m-sub">Großverbraucher und energetisch relevante Anlagen nach ISO&nbsp;50001</div>
          </div>
          <button className="v-m-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="v-m-body">
          {error && (
            <div className="v-calc-note" style={{ background: 'color-mix(in srgb, var(--alert) 10%, var(--surface))', borderColor: 'color-mix(in srgb, var(--alert) 38%, transparent)', color: 'var(--alert)' }}>
              {error}
            </div>
          )}
          {replaceMode && (
            <div className="v-calc-note">
              Der bisherige Verbraucher <span className="n">{replaceTarget!.name}</span> wird außer Betrieb genommen und durch den neuen ersetzt.
            </div>
          )}

          <div className="v-field">
            <label>Name <span className="req">*</span></label>
            <input className={`v-inp${touched && !nameOk ? ' invalid' : ''}`} value={f.name}
              onChange={(e) => set('name', e.target.value)} placeholder="z.B. RLT002 — Lüftung Großer Saal" autoFocus />
          </div>

          <div className="v-field-row c3" style={{ marginBottom: 14 }}>
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Kategorie <span className="req">*</span></label>
              <select className="v-sel" value={f.category} onChange={(e) => set('category', e.target.value)}>
                {CATEGORY_ORDER.map((k) => <option key={k} value={k}>{CAT_META[k].label}</option>)}
              </select>
            </div>
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Priorität</label>
              <select className="v-sel" value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                {Object.entries(PRIORITIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Energieart</label>
              <input className="v-inp" value={EM_ENERGY[catMeta(f.category).energy].label} disabled
                title="Wird aus der Kategorie abgeleitet" />
            </div>
          </div>

          <div className="v-field-row c2" style={{ marginBottom: 14 }}>
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Nennleistung</label>
              <div className="v-inp-suffix">
                <input className="v-inp mono" value={f.rated_power_kw} onChange={(e) => set('rated_power_kw', e.target.value)} placeholder="z.B. 165" inputMode="decimal" />
                <span className="suf">kW</span>
              </div>
            </div>
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Betriebsstunden / Jahr</label>
              <div className="v-inp-suffix">
                <input className="v-inp mono" value={f.operating_hours_per_year} onChange={(e) => set('operating_hours_per_year', e.target.value)} placeholder="z.B. 3600" inputMode="numeric" />
                <span className="suf">h/a</span>
              </div>
            </div>
          </div>

          <div className="v-calc-note">
            <Sparkles size={14} style={{ color: 'var(--fw-fernwaerme)' }} />
            Geschätzter Jahresverbrauch: <span className="n">{estView.val} {estView.unit}</span>
            {wouldBeSEU && <span className="v-seu seu-flag">SEU-Kandidat</span>}
          </div>

          <div className="v-field">
            <label>Beschreibung</label>
            <textarea className="v-ta" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Optionale Beschreibung der Anlage…" />
          </div>

          <div className="v-fieldset">
            <div className="v-fieldset-legend"><Box size={13} /> Gerätedaten <span className="opt">(optional)</span></div>
            <div className="v-field-row c3">
              <div className="v-field" style={{ marginBottom: 0 }}><label>Hersteller</label><input className="v-inp" value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} placeholder="z.B. Wolf GmbH" /></div>
              <div className="v-field" style={{ marginBottom: 0 }}><label>Modell / Typ</label><input className="v-inp" value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="z.B. KG Top 84" /></div>
              <div className="v-field" style={{ marginBottom: 0 }}><label>Seriennummer</label><input className="v-inp mono" value={f.serial_number} onChange={(e) => set('serial_number', e.target.value)} placeholder="z.B. SN-12345" /></div>
            </div>
          </div>

          <div className="v-fieldset">
            <div className="v-fieldset-legend"><History size={13} /> Lebenszyklus</div>
            <div className="v-field-row c2">
              <div className="v-field" style={{ marginBottom: 0 }}><label>Inbetriebnahme</label><input type="date" className="v-inp mono" value={f.commissioned_at} onChange={(e) => set('commissioned_at', e.target.value)} /></div>
              {!replaceMode && (
                <div className="v-field" style={{ marginBottom: 0 }}><label>Außerbetriebnahme</label><input type="date" className="v-inp mono" value={f.decommissioned_at} onChange={(e) => set('decommissioned_at', e.target.value)} /></div>
              )}
            </div>
            {editing && f.decommissioned_at && allConsumers.length > 0 && (
              <div className="v-field" style={{ marginBottom: 0, marginTop: 12 }}>
                <label>Ersetzt durch</label>
                <select className="v-sel" value={f.replaced_by_id} onChange={(e) => set('replaced_by_id', e.target.value)}>
                  <option value="">– Kein Nachfolger –</option>
                  {allConsumers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="v-fieldset">
            <div className="v-fieldset-legend"><MapPin size={13} /> Standort-Zuordnung <span className="opt">(optional)</span></div>
            <div className="v-field-row c3">
              <div className="v-field" style={{ marginBottom: 0 }}>
                <label>Standort</label>
                <select className="v-sel" value={hierarchy.selectedSiteId} onChange={(e) => hierarchy.setSelectedSiteId(e.target.value)}>
                  <option value="">– Kein Standort –</option>
                  {hierarchy.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="v-field" style={{ marginBottom: 0 }}>
                <label>Gebäude</label>
                <select className="v-sel" value={hierarchy.selectedBuildingId} onChange={(e) => hierarchy.setSelectedBuildingId(e.target.value)} disabled={!hierarchy.selectedSiteId}>
                  <option value="">– Kein Gebäude –</option>
                  {hierarchy.buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="v-field" style={{ marginBottom: 0 }}>
                <label>Nutzungseinheit</label>
                <select className="v-sel" value={hierarchy.selectedUnitId} onChange={(e) => hierarchy.setSelectedUnitId(e.target.value)} disabled={!hierarchy.selectedBuildingId}>
                  <option value="">– Keine Einheit –</option>
                  {hierarchy.units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="v-fieldset" style={{ marginBottom: 0 }}>
            <div className="v-fieldset-legend"><Gauge size={13} /> Zählerzuordnung <span className="opt">(optional)</span></div>
            {assignedMeters.length > 0 && (
              <div className="v-meter-chips" style={{ marginBottom: availableMeters.length ? 10 : 0 }}>
                {assignedMeters.map((m) => {
                  const tone = EM_ENERGY[(['fernwaerme', 'strom', 'kaelte', 'wasser'] as EnergyKey[]).find((k) => m.energy_type.toLowerCase().includes(k.slice(0, 4))) ?? 'strom'];
                  return (
                    <span className="v-meter-chip" key={m.id}>
                      <span className="mc-stripe" style={{ background: tone.color }} />
                      <span className="mc-code">{m.name}</span>
                      <button type="button" className="mc-x" onClick={() => removeMeter(m.id)} title="Zuordnung entfernen"><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="v-field" style={{ marginBottom: 0 }}>
              <label>Zähler hinzufügen</label>
              <select className="v-sel" value="" onChange={(e) => { addMeter(e.target.value); e.target.value = ''; }} disabled={availableMeters.length === 0}>
                <option value="">{availableMeters.length === 0 ? (f.meter_ids.length ? 'Alle Zähler zugeordnet' : 'Keine Zähler verfügbar') : '– Zähler auswählen –'}</option>
                {availableMeters.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="v-m-foot">
          <span className="hint"><Shield size={13} /> Pflichtfelder mit <span style={{ color: 'var(--alert)' }}>*</span></span>
          <div className="btns">
            <button className="v-btn-soft" onClick={onClose}>Abbrechen</button>
            <button className="btn-primary" onClick={submit} disabled={!nameOk || saving}>
              {saving ? 'Speichern…' : replaceMode ? 'Ersetzen' : editing ? 'Speichern' : 'Anlegen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

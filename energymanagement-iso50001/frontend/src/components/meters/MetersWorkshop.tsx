/**
 * MetersWorkshop – 3-Spalten-Werkstatt-Modus für die MetersPage nach
 * Claude-Design-Handoff.
 *
 *   ┌────────────────┬────────────────────────┬──────────────────┐
 *   │   Eingang      │   Physikalische        │     Detail       │
 *   │  (Inbox)       │   Struktur (Tree)      │    (Selektion)   │
 *   │                │                        │                  │
 *   │  Cards         │  Standort →            │  Stammdaten      │
 *   │  draggable     │   Gebäude →            │  Position-Pfad   │
 *   │                │    NE (Drop-Ziel) →    │  Aktionen        │
 *   │                │     Zähler-Kette       │                  │
 *   └────────────────┴────────────────────────┴──────────────────┘
 *
 * Der Eingang enthält Zähler ohne `usage_unit_id` (= noch nicht in die
 * Hierarchie eingeordnet). Drag&Drop auf eine NE setzt `usage_unit_id`
 * (+ `building_id` + `site_id`) via PUT /meters/{id}. Drag auf einen
 * vorhandenen Hauptzähler hängt den gezogenen Zähler als Sub-Meter
 * (`parent_meter_id`) über PATCH /meters/{id}/parent.
 *
 * Energie-Typ-Match: das Drop wird nur akzeptiert, wenn die Energieart
 * des gezogenen Zählers zum Kontext passt (auf eine Chain: gleiche
 * Energieart; auf eine NE: jede).
 */

import { useEffect, useMemo, useState, useCallback } from 'react';
import { ChevronRight, Pin, Building2, DoorOpen, GripVertical, Search, Info } from 'lucide-react';
import { apiClient } from '@/utils/api';
import EnergyChip from '@/components/ui/EnergyChip';
import Pill from '@/components/ui/Pill';
import { resolveEnergyKey, EM_ENERGY, type EnergyKey } from '@/utils/energyPalette';

// ── Typen ──────────────────────────────────────────────────────────────

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
  data_source: string;
  site_id: string | null;
  site_name: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  parent_meter_id: string | null;
  is_active: boolean;
  is_virtual: boolean;
  created_at: string;
}

interface Site { id: string; name: string; short_code?: string | null; }
interface Building { id: string; name: string; site_id: string; building_type?: string | null; }
interface UsageUnit { id: string; name: string; building_id: string; usage_type?: string | null; }

// Building-Detail-Response des Backends — `usage_units` ist optional inline.
interface BuildingDetailResponse {
  id: string;
  name: string;
  building_type?: string | null;
  usage_units?: UsageUnit[];
}

type SelectedKind =
  | { kind: 'inbox'; meter: Meter }
  | { kind: 'placed'; meter: Meter }
  | { kind: 'chain'; chainMeter: Meter; chainSubs: Meter[]; unit: UsageUnit }
  | null;

interface Props {
  /** Alle Meters (von MetersPage geliefert, damit kein Doppel-Fetch). */
  meters: Meter[];
  /** Reload-Trigger nach erfolgreichem Drop. */
  onReload: () => void;
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────

function relAge(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} Std.`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day} Tg.`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} Mon.`;
  return `${Math.floor(day / 365)} J.`;
}

function shortSource(s: string): string {
  return ({ manual: 'MAN', spie: 'SPIE', modbus: 'MODB', mqtt: 'MQTT', knx: 'KNX', bacnet: 'BACN', shelly: 'SHEL', homeassistant: 'HA', virtual: 'VIRT' }[s] || s.slice(0, 4).toUpperCase());
}

// ── Komponente ─────────────────────────────────────────────────────────

export default function MetersWorkshop({ meters, onReload }: Props) {
  // Hierarchie aus separaten Endpunkten zusammen-fetchen.
  const [sites, setSites] = useState<Site[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [units, setUnits] = useState<UsageUnit[]>([]);
  const [loadingHier, setLoadingHier] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pick = <T,>(d: { items: T[] } | T[]): T[] => (Array.isArray(d) ? d : d.items ?? []);

        // 1) Sites
        const siRes = await apiClient.get<{ items: Site[] } | Site[]>('/api/v1/sites?page=1&page_size=100');
        if (cancelled) return;
        const siteList = pick(siRes.data);
        setSites(siteList);

        // 2) Buildings pro Site (parallel)
        const buildingResults = await Promise.all(
          siteList.map((s) =>
            apiClient
              .get<{ items: Building[] } | Building[]>(`/api/v1/sites/${s.id}/buildings`)
              .then((r) => pick(r.data).map((b) => ({ ...b, site_id: s.id })))
              .catch(() => [] as Building[]),
          ),
        );
        if (cancelled) return;
        const allBuildings = buildingResults.flat();
        setBuildings(allBuildings);

        // 3) Units pro Building über das Building-Detail laden.
        //    Der separate /units-Endpoint liefert auf manchen Backends leer
        //    zurück; usage_units kommen nur über das Building-Detail inline.
        const unitResults = await Promise.all(
          allBuildings.map((b) =>
            apiClient
              .get<BuildingDetailResponse>(`/api/v1/sites/${b.site_id}/buildings/${b.id}`)
              .then((r) => (r.data.usage_units ?? []).map((u) => ({ ...u, building_id: b.id })))
              .catch(() => [] as UsageUnit[]),
          ),
        );
        if (cancelled) return;
        setUnits(unitResults.flat());
      } catch {
        /* interceptor */
      } finally {
        if (!cancelled) setLoadingHier(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Alle parent_meter_ids einsammeln — Meters, an denen Sub-Zähler hängen,
  // sind Hauptzähler einer Chain und gehören NICHT in den Eingang, auch
  // wenn sie noch keiner NE zugeordnet sind (sie hängen dann direkt am
  // Standort oder Gebäude).
  const meterIdsWithSubs = useMemo(() => {
    const s = new Set<string>();
    for (const m of meters) {
      if (m.parent_meter_id) s.add(m.parent_meter_id);
    }
    return s;
  }, [meters]);

  // Inbox = Meters ohne usage_unit_id, ohne parent_meter_id, nicht virtual,
  // ohne Sub-Zähler. Virtuelle Zähler sind Berechnungen, Sub-Zähler erben
  // die Position vom Hauptzähler, Hauptzähler mit Subs sind bereits Teil
  // der Struktur (direkt am Standort/Gebäude, falls ohne NE).
  const inboxMeters = useMemo(
    () => meters.filter((m) =>
      !m.usage_unit_id
      && !m.parent_meter_id
      && !m.is_virtual
      && !meterIdsWithSubs.has(m.id)
    ),
    [meters, meterIdsWithSubs],
  );

  // Filter + Suche
  const [query, setQuery] = useState('');
  const [energyFilter, setEnergyFilter] = useState<Set<EnergyKey>>(new Set());

  const filteredInbox = useMemo(() => {
    return inboxMeters.filter((m) => {
      const key = resolveEnergyKey(m.energy_type);
      if (energyFilter.size > 0 && (!key || !energyFilter.has(key))) return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        const hay = `${m.name} ${m.meter_number ?? ''} ${m.data_source}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [inboxMeters, energyFilter, query]);

  const toggleEnergy = (k: EnergyKey) => {
    setEnergyFilter((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  // Tree-Open-Status
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) =>
    setOpenSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  // Selection + Drag-State. Drop-Ziele existieren auf drei Ebenen:
  // Standort (nur site_id), Gebäude (site+building), NE (alle drei).
  const [selected, setSelected] = useState<SelectedKind>(null);
  const [dragMeter, setDragMeter] = useState<Meter | null>(null);
  const [dragOverSiteId, setDragOverSiteId] = useState<string | null>(null);
  const [dragOverBuildingId, setDragOverBuildingId] = useState<string | null>(null);
  const [dragOverNeId, setDragOverNeId] = useState<string | null>(null);
  const [dragOverChainMeterId, setDragOverChainMeterId] = useState<string | null>(null);

  const clearDragOver = useCallback(() => {
    setDragOverSiteId(null);
    setDragOverBuildingId(null);
    setDragOverNeId(null);
    setDragOverChainMeterId(null);
  }, []);

  const handleDropOnSite = useCallback(async (m: Meter, siteId: string) => {
    try {
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        site_id: siteId,
        building_id: null,
        usage_unit_id: null,
        parent_meter_id: null,
      });
      onReload();
    } catch {
      /* interceptor */
    }
  }, [onReload]);

  const handleDropOnBuilding = useCallback(async (m: Meter, buildingId: string, siteId: string) => {
    try {
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        site_id: siteId,
        building_id: buildingId,
        usage_unit_id: null,
        parent_meter_id: null,
      });
      onReload();
    } catch {
      /* interceptor */
    }
  }, [onReload]);

  const handleDropOnUnit = useCallback(async (m: Meter, unitId: string, buildingId: string, siteId: string) => {
    try {
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        site_id: siteId,
        building_id: buildingId,
        usage_unit_id: unitId,
        parent_meter_id: null,
      });
      onReload();
    } catch {
      /* interceptor */
    }
  }, [onReload]);

  const handleDropOnMain = useCallback(async (m: Meter, mainMeter: Meter) => {
    try {
      // Parent setzen — Backend übernimmt site_id/building_id/usage_unit_id
      // vom Parent ggf. nicht, daher gleich mit-setzen, falls bekannt.
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        parent_meter_id: mainMeter.id,
        site_id: mainMeter.site_id,
        building_id: mainMeter.building_id,
        usage_unit_id: mainMeter.usage_unit_id,
      });
      onReload();
    } catch {
      /* interceptor */
    }
  }, [onReload]);

  // Action: Position eines bereits zugeordneten Zählers entfernen →
  // landet wieder im Eingang. Bei einem HZ mit Sub-Zählern hängt Backend
  // die Subs in der Regel ab; wir informieren den User explizit.
  const handleUnplace = useCallback(async (m: Meter) => {
    const hasSubs = meters.some((x) => x.parent_meter_id === m.id);
    const msg = hasSubs
      ? `Zähler hat ${meters.filter((x) => x.parent_meter_id === m.id).length} Sub-Zähler. Trotzdem zurück in den Eingang?`
      : 'Zähler zurück in den Eingang verschieben?';
    if (!window.confirm(msg)) return;
    try {
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        site_id: null,
        building_id: null,
        usage_unit_id: null,
        parent_meter_id: null,
      });
      setSelected(null);
      onReload();
    } catch {
      /* interceptor */
    }
  }, [meters, onReload]);

  // Action: Sub-Zähler vom Hauptzähler lösen — er bleibt in der NE,
  // wird aber zum eigenständigen Hauptzähler.
  const handleDetachFromMain = useCallback(async (m: Meter) => {
    if (!window.confirm('Vom Hauptzähler lösen? Wird zum eigenständigen Zähler in der Nutzungseinheit.')) return;
    try {
      await apiClient.put(`/api/v1/meters/${m.id}`, {
        parent_meter_id: null,
      });
      onReload();
    } catch {
      /* interceptor */
    }
  }, [onReload]);

  // Drag-Ghost: DOM-Element mit Code + Energy-Dot, das beim Drag dem Cursor
  // folgt statt dem Browser-Default-Image (das ist meist halbtransparent
  // und unleserlich, vor allem mit langen Mono-Codes).
  const buildDragGhost = useCallback((m: Meter): HTMLElement => {
    const key = resolveEnergyKey(m.energy_type);
    const color = key ? EM_ENERGY[key].color : '#9A968B';
    const el = document.createElement('div');
    el.className = 'drag-ghost';
    el.innerHTML = `<span class="ghost-dot" style="background:${color}"></span><span class="ghost-code">${(m.meter_number || m.name || '').replace(/[<>&]/g, '')}</span>`;
    document.body.appendChild(el);
    // Element nach dem Render-Frame entfernen (das Browser-Snapshot ist da)
    setTimeout(() => { el.remove(); }, 0);
    return el;
  }, []);

  // ── Chain-Renderer (wiederverwendbar an NE-, Gebäude- und Standort-Level) ──
  const renderChain = (main: Meter, contextUnit?: UsageUnit) => {
    const subs = meters.filter((m) => m.parent_meter_id === main.id);
    const key = resolveEnergyKey(main.energy_type);
    const tone = key ? EM_ENERGY[key] : null;
    const matches = !!dragMeter && resolveEnergyKey(dragMeter.energy_type) === key;
    const isChainDragOver = dragOverChainMeterId === main.id && matches;
    return (
      <div
        key={main.id}
        className={`chain${isChainDragOver ? ' drop-target' : ''}`}
        onDragOver={(e) => {
          if (matches) {
            e.preventDefault();
            e.stopPropagation();
            setDragOverChainMeterId(main.id);
          }
        }}
        onDragLeave={(e) => {
          e.stopPropagation();
          if (dragOverChainMeterId === main.id) setDragOverChainMeterId(null);
        }}
        onDrop={(e) => {
          if (matches && dragMeter) {
            e.preventDefault();
            e.stopPropagation();
            handleDropOnMain(dragMeter, main);
            setDragOverChainMeterId(null);
          }
        }}
      >
        <div
          className="chain-head"
          onClick={() => setSelected({
            kind: 'chain',
            chainMeter: main,
            chainSubs: subs,
            unit: contextUnit ?? ({ id: '', name: '—', building_id: '' } as UsageUnit),
          })}
        >
          <span className="e-mark" style={{ background: tone?.bg, color: tone?.text }}>
            <span style={{ fontSize: 9 }}>●</span>
          </span>
          <span className="label">{main.meter_number || main.name}</span>
          <span className="summary">{subs.length + 1} Z</span>
        </div>
        <div className="chain-body">
          <div
            className={`chain-meter${selected?.kind === 'placed' && selected.meter.id === main.id ? ' selected' : ''}`}
            draggable
            onDragStart={(e) => {
              e.stopPropagation();
              setDragMeter(main);
              e.dataTransfer.effectAllowed = 'move';
              const ghost = buildDragGhost(main);
              e.dataTransfer.setDragImage(ghost, 12, 16);
            }}
            onDragEnd={(e) => {
              e.stopPropagation();
              setDragMeter(null);
              clearDragOver();
            }}
            onClick={() => setSelected({ kind: 'placed', meter: main })}
            style={{ cursor: 'grab' }}
          >
            <span className="role-tag">HZ</span>
            <span className="name">{main.meter_number || main.name}</span>
            <span className="src-tag">{shortSource(main.data_source)}</span>
            <span className="e-dot" style={{ background: tone?.color }} />
          </div>
          {subs.map((sub) => {
            const sKey = resolveEnergyKey(sub.energy_type);
            const sTone = sKey ? EM_ENERGY[sKey] : null;
            return (
              <div
                key={sub.id}
                className={`chain-meter${selected?.kind === 'placed' && selected.meter.id === sub.id ? ' selected' : ''}`}
                draggable
                onDragStart={(e) => {
                  e.stopPropagation();
                  setDragMeter(sub);
                  e.dataTransfer.effectAllowed = 'move';
                  const ghost = buildDragGhost(sub);
                  e.dataTransfer.setDragImage(ghost, 12, 16);
                }}
                onDragEnd={(e) => {
                  e.stopPropagation();
                  setDragMeter(null);
                  setDragOverNeId(null);
                  setDragOverChainMeterId(null);
                }}
                onClick={() => setSelected({ kind: 'placed', meter: sub })}
                style={{ cursor: 'grab' }}
              >
                <span className="grip"><GripVertical size={11} /></span>
                <span className="name">{sub.meter_number || sub.name}</span>
                <span className="src-tag">{shortSource(sub.data_source)}</span>
                <span className="e-dot" style={{ background: sTone?.color }} />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── Render ───────────────────────────────────────────────────────────

  if (loadingHier) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
        Hierarchie wird geladen…
      </div>
    );
  }

  return (
    <div className="workshop">
      {/* ── Spalte 1: Eingang ───────────────────────────── */}
      <div className="col">
        <div className="col-head">
          <span className="col-head-title">Eingang</span>
          <span className="col-head-count">{filteredInbox.length}</span>
        </div>
        <div className="col-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Suche + Energie-Filter */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 4px 10px' }}>
            <div className="search-input2" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              border: '1px solid var(--line)',
              background: 'var(--surface)',
              borderRadius: 'var(--r-sm)',
              padding: '4px 8px',
            }}>
              <Search size={12} style={{ color: 'var(--ink-4)' }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Code, Nummer, Quelle …"
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  width: '100%', fontSize: 12, color: 'var(--ink)', fontFamily: 'inherit',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {(['fernwaerme', 'strom', 'kaelte', 'wasser'] as EnergyKey[]).map((k) => (
                <Pill
                  key={k}
                  active={energyFilter.has(k)}
                  dotColor={EM_ENERGY[k].color}
                  onClick={() => toggleEnergy(k)}
                  className="!text-[11px]"
                >
                  {EM_ENERGY[k].label}
                </Pill>
              ))}
            </div>
          </div>

          {filteredInbox.length === 0 ? (
            <div style={{ padding: '20px 12px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 12 }}>
              {inboxMeters.length === 0 ? (
                <>
                  <strong style={{ display: 'block', color: 'var(--ink)', marginBottom: 4 }}>
                    Eingang leer
                  </strong>
                  Alle Zähler sind eingeordnet.
                </>
              ) : (
                <>Keine Treffer für Filter/Suche.</>
              )}
            </div>
          ) : (
            filteredInbox.map((m) => {
              const key = resolveEnergyKey(m.energy_type);
              const color = key ? EM_ENERGY[key].color : 'var(--ink-3)';
              const isSel = selected?.kind === 'inbox' && selected.meter.id === m.id;
              return (
                <div
                  key={m.id}
                  className={`inbox-row${isSel ? ' selected' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragMeter(m);
                    e.dataTransfer.effectAllowed = 'move';
                    const ghost = buildDragGhost(m);
                    e.dataTransfer.setDragImage(ghost, 12, 16);
                  }}
                  onDragEnd={() => {
                    setDragMeter(null);
                    clearDragOver();
                  }}
                  onClick={() => setSelected({ kind: 'inbox', meter: m })}
                >
                  <div className="inbox-stripe" style={{ background: color }} />
                  <div className="inbox-body">
                    <div className="inbox-row-top">
                      <div className="inbox-code" title={m.name}>
                        {m.meter_number || m.name}
                      </div>
                      <span className="inbox-source">{shortSource(m.data_source)}</span>
                    </div>
                    <div className="inbox-row-meta">
                      <EnergyChip type={m.energy_type} size="sm" />
                      {m.meter_number && (
                        <span className="num">№ {m.meter_number}</span>
                      )}
                      <span className="age">vor {relAge(m.created_at)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Spalte 2: Physikalische Struktur ────────────── */}
      <div className="col">
        <div className="col-head">
          <span className="col-head-title">Physikalische Struktur</span>
          <span className="col-head-count">
            {sites.length} Standorte · {meters.length - inboxMeters.length} zugeordnet
          </span>
        </div>
        <div className="col-body">
          <div className="tree2">
            {sites.map((s) => {
              const sBuildings = buildings.filter((b) => b.site_id === s.id);
              const sMeters = meters.filter((m) => m.site_id === s.id);
              const isOpen = openSet.has(s.id);
              return (
                <div key={s.id} className={`t-standort ${isOpen ? 'open' : 'collapsed'}`}>
                  <div
                    className={`t-standort-head${dragOverSiteId === s.id && dragMeter ? ' drop-active' : ''}`}
                    onClick={() => toggleOpen(s.id)}
                    onDragOver={(e) => {
                      if (dragMeter) {
                        e.preventDefault();
                        setDragOverSiteId(s.id);
                        setDragOverBuildingId(null);
                        setDragOverNeId(null);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverSiteId === s.id) setDragOverSiteId(null);
                    }}
                    onDrop={(e) => {
                      if (dragMeter) {
                        e.preventDefault();
                        handleDropOnSite(dragMeter, s.id);
                        clearDragOver();
                      }
                    }}
                  >
                    <span className="t-chev">
                      <ChevronRight size={11} />
                    </span>
                    <Pin size={13} />
                    <span>{s.name}</span>
                    {s.short_code && <span className="t-shortcode">{s.short_code}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                      {sMeters.length} Z
                    </span>
                  </div>
                  {isOpen && (
                    <div className="t-gebaeude-list">
                      {/* Direkte Hauptzähler am Standort (ohne Gebäude, ohne NE) */}
                      {(() => {
                        const direct = sMeters.filter((m) =>
                          !m.building_id
                          && !m.usage_unit_id
                          && !m.parent_meter_id
                          && !m.is_virtual
                          && meterIdsWithSubs.has(m.id)
                        );
                        if (direct.length === 0) return null;
                        return (
                          <div className="t-gebaeude" style={{ background: 'var(--surface-2)' }}>
                            <div className="t-gebaeude-head" style={{ cursor: 'default' }}>
                              <Info size={12} style={{ color: 'var(--ink-3)' }} />
                              <span style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>
                                Direkt am Standort (ohne Gebäude)
                              </span>
                              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                                {direct.length}
                              </span>
                            </div>
                            <div style={{ padding: '6px 10px 8px 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {direct.map((main) => renderChain(main))}
                            </div>
                          </div>
                        );
                      })()}
                      {sBuildings.map((g) => {
                        const gUnits = units.filter((u) => u.building_id === g.id);
                        const gMeters = sMeters.filter((m) => m.building_id === g.id);
                        const gOpen = openSet.has(g.id);
                        return (
                          <div key={g.id} className={`t-gebaeude ${gOpen ? 'open' : ''}`}>
                            <div
                              className={`t-gebaeude-head${dragOverBuildingId === g.id && dragMeter ? ' drop-active' : ''}`}
                              onClick={() => toggleOpen(g.id)}
                              onDragOver={(e) => {
                                if (dragMeter) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setDragOverBuildingId(g.id);
                                  setDragOverSiteId(null);
                                  setDragOverNeId(null);
                                }
                              }}
                              onDragLeave={(e) => {
                                e.stopPropagation();
                                if (dragOverBuildingId === g.id) setDragOverBuildingId(null);
                              }}
                              onDrop={(e) => {
                                if (dragMeter) {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDropOnBuilding(dragMeter, g.id, s.id);
                                  clearDragOver();
                                }
                              }}
                            >
                              <span className="t-chev"><ChevronRight size={11} /></span>
                              <Building2 size={13} />
                              <span>{g.name}</span>
                              {g.building_type && (
                                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>· {g.building_type}</span>
                              )}
                              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                                {gMeters.length}
                              </span>
                            </div>
                            {gOpen && (
                              <div className="t-ne-list">
                                {/* Direkte Hauptzähler am Gebäude (ohne NE) */}
                                {(() => {
                                  const direct = gMeters.filter((m) =>
                                    !m.usage_unit_id
                                    && !m.parent_meter_id
                                    && !m.is_virtual
                                    && meterIdsWithSubs.has(m.id)
                                  );
                                  if (direct.length === 0) return null;
                                  return (
                                    <div className="t-ne" style={{ background: 'var(--surface-2)' }}>
                                      <div className="t-ne-head" style={{ cursor: 'default' }}>
                                        <Info size={12} style={{ color: 'var(--ink-3)' }} />
                                        <span className="name" style={{ color: 'var(--ink-3)', fontStyle: 'italic' }}>
                                          Direkt am Gebäude (ohne NE)
                                        </span>
                                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                                          {direct.length}
                                        </span>
                                      </div>
                                      <div className="t-ne-chains">
                                        {direct.map((main) => renderChain(main))}
                                      </div>
                                    </div>
                                  );
                                })()}
                                {gUnits.length === 0 && (
                                  <div className="empty-ne">
                                    <Info size={12} />
                                    <div>Keine Nutzungseinheiten</div>
                                  </div>
                                )}
                                {gUnits.map((u) => {
                                  const unitMeters = meters.filter((m) => m.usage_unit_id === u.id);
                                  const mains = unitMeters.filter((m) => !m.parent_meter_id);
                                  const uOpen = openSet.has(u.id);
                                  const isDragOver = dragOverNeId === u.id && !!dragMeter;
                                  return (
                                    <div
                                      key={u.id}
                                      className={`t-ne${isDragOver ? ' drop-active' : ''}`}
                                      onDragOver={(e) => {
                                        if (dragMeter) {
                                          e.preventDefault();
                                          e.stopPropagation();
                                          setDragOverNeId(u.id);
                                          setDragOverSiteId(null);
                                          setDragOverBuildingId(null);
                                        }
                                      }}
                                      onDragLeave={(e) => {
                                        e.stopPropagation();
                                        if (dragOverNeId === u.id) setDragOverNeId(null);
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (dragMeter) {
                                          handleDropOnUnit(dragMeter, u.id, g.id, s.id);
                                          setDragOverNeId(null);
                                        }
                                      }}
                                    >
                                      <div className="t-ne-head" onClick={() => toggleOpen(u.id)}>
                                        <span className="t-chev"><ChevronRight size={11} /></span>
                                        <DoorOpen size={12} />
                                        <span className="name">{u.name}</span>
                                        {u.usage_type && <span className="ne-typ">· {u.usage_type}</span>}
                                        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>
                                          {unitMeters.length}
                                        </span>
                                      </div>
                                      {uOpen && (
                                        <div className="t-ne-chains">
                                          {mains.length === 0 && (
                                            <div className="empty-ne">
                                              <Info size={12} />
                                              <div>Keine Zähler. <strong>Zähler hier hineinziehen</strong>.</div>
                                            </div>
                                          )}
                                          {mains.map((main) => renderChain(main, u))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Spalte 3: Detail ────────────────────────────── */}
      <div className="col">
        <div className="col-head">
          <span className="col-head-title">Detail</span>
        </div>
        <div className="col-body detail-pane">
          {!selected && (
            <div className="detail-empty">
              <strong>Keine Auswahl</strong>
              Wähle einen Zähler aus dem Eingang oder der Struktur.
            </div>
          )}
          {selected?.kind === 'inbox' && (
            <DetailMeter
              meter={selected.meter}
              sites={sites} buildings={buildings} units={units}
              placed={false}
              onUnplace={handleUnplace}
              onDetachFromMain={handleDetachFromMain}
            />
          )}
          {selected?.kind === 'placed' && (
            <DetailMeter
              meter={selected.meter}
              sites={sites} buildings={buildings} units={units}
              placed
              onUnplace={handleUnplace}
              onDetachFromMain={handleDetachFromMain}
            />
          )}
          {selected?.kind === 'chain' && (
            <DetailMeter
              meter={selected.chainMeter}
              sites={sites} buildings={buildings} units={units}
              placed
              extraSubs={selected.chainSubs}
              onUnplace={handleUnplace}
              onDetachFromMain={handleDetachFromMain}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-Komponente: Detail-Pane ────────────────────────────────────────

function DetailMeter({ meter, sites, buildings, units, placed, extraSubs, onUnplace, onDetachFromMain }: {
  meter: Meter;
  sites: Site[];
  buildings: Building[];
  units: UsageUnit[];
  placed: boolean;
  extraSubs?: Meter[];
  onUnplace: (m: Meter) => void;
  onDetachFromMain: (m: Meter) => void;
}) {
  const site = sites.find((s) => s.id === meter.site_id);
  const building = buildings.find((b) => b.id === meter.building_id);
  const unit = units.find((u) => u.id === meter.usage_unit_id);
  const isSubMeter = !!meter.parent_meter_id;
  const hasAnyPosition = placed && (meter.site_id || meter.building_id || meter.usage_unit_id || meter.parent_meter_id);

  return (
    <>
      <div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
          {placed ? 'Zugeordnet' : 'Im Eingang'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
            {meter.meter_number || meter.name}
          </h3>
          <EnergyChip type={meter.energy_type} size="sm" />
        </div>
      </div>

      <div className="detail-stammdaten">
        <div className="row"><span className="l">Nummer</span><span className="v">{meter.meter_number || '—'}</span></div>
        <div className="row"><span className="l">Name</span><span className="v" style={{ fontFamily: 'var(--font-sans)' }}>{meter.name}</span></div>
        <div className="row"><span className="l">Einheit</span><span className="v">{meter.unit}</span></div>
        <div className="row"><span className="l">Quelle</span><span className="v" style={{ fontFamily: 'var(--font-sans)' }}>{meter.data_source}</span></div>
        {meter.is_virtual && (
          <div className="row"><span className="l">Typ</span><span className="v" style={{ fontFamily: 'var(--font-sans)' }}>Virtueller Zähler</span></div>
        )}
      </div>

      <div>
        <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Physische Position
        </div>
        {placed && (site || building || unit) ? (
          <div className="detail-path">
            {site && <><Pin size={12} /><span>{site.name}</span></>}
            {building && <><span className="sep">›</span><Building2 size={12} /><span>{building.name}</span></>}
            {unit && <><span className="sep">›</span><DoorOpen size={12} /><span>{unit.name}</span></>}
          </div>
        ) : (
          <div className="detail-path" style={{ color: 'var(--warn)' }}>
            Noch nicht zugeordnet – per Drag&Drop auf einen Standort, ein Gebäude oder eine Nutzungseinheit ziehen.
          </div>
        )}
      </div>

      {extraSubs && extraSubs.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Sub-Zähler in dieser Kette
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {extraSubs.map((s) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 10px', border: '1px solid var(--line)', borderRadius: 'var(--r-sm)',
                background: 'var(--surface-2)', fontSize: 12,
              }}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{s.meter_number || s.name}</span>
                <EnergyChip type={s.energy_type} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Aktions-Footer — nur für zugeordnete Zähler. */}
      {hasAnyPosition && (
        <div style={{
          marginTop: 'auto',
          paddingTop: 12,
          borderTop: '1px solid var(--line)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {isSubMeter && (
            <button
              type="button"
              onClick={() => onDetachFromMain(meter)}
              className="btn-secondary"
              style={{ justifyContent: 'flex-start' }}
            >
              Vom Hauptzähler lösen
            </button>
          )}
          <button
            type="button"
            onClick={() => onUnplace(meter)}
            className="btn-secondary"
            style={{ justifyContent: 'flex-start', color: 'var(--alert)' }}
            title="Zähler-Position zurücksetzen; landet wieder im Eingang."
          >
            Zurück in den Eingang
          </button>
        </div>
      )}
    </>
  );
}

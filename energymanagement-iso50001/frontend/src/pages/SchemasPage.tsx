import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, ArrowLeft, Search, Calendar,
  Gauge, Zap, Droplets, Flame, Sun, X, Users,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';

/* ── Typen ── */

interface SchemaRoot {
  id: string;
  name: string;
  schema_label: string;
  energy_type: string;
  unit: string;
  child_count: number;
}

interface ConsumerInfo {
  id: string;
  name: string;
  category: string;
  rated_power: number | null;
  operating_hours: number | null;
}

interface TreeNode {
  id: string;
  name: string;
  energy_type: string;
  unit: string;
  schema_label: string | null;
  consumption: number;
  cost: number | null;
  unaccounted: number | null;
  consumers: ConsumerInfo[];
  children: TreeNode[];
}

interface Meter {
  id: string;
  name: string;
  energy_type: string;
  unit: string;
  parent_meter_id: string | null;
  schema_label: string | null;
}

/* ── Konstanten ── */

const ENERGY_ICONS: Record<string, React.ElementType> = {
  electricity: Zap,
  natural_gas: Flame,
  water: Droplets,
  solar: Sun,
};

const NODE_COLORS: Record<string, string> = {
  electricity: '#F59E0B',
  natural_gas: '#3B82F6',
  heating_oil: '#8B5CF6',
  district_heating: '#F97316',
  water: '#06B6D4',
  solar: '#10B981',
};

/* ── Formatierung ── */

function fmtNum(v: number): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

function fmtCurrency(v: number): string {
  return v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

/* ── Periodenhelfer ── */

function getDefaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return {
    start: start.toISOString().slice(0, 10),
    end: now.toISOString().slice(0, 10),
  };
}

type PresetKey = 'thisMonth' | 'lastMonth' | 'thisYear' | 'lastYear';

function getPresetPeriod(key: PresetKey): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'thisMonth':
      return { start: new Date(y, m, 1).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    case 'lastMonth':
      return { start: new Date(y, m - 1, 1).toISOString().slice(0, 10), end: new Date(y, m, 0).toISOString().slice(0, 10) };
    case 'thisYear':
      return { start: new Date(y, 0, 1).toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    case 'lastYear':
      return { start: new Date(y - 1, 0, 1).toISOString().slice(0, 10), end: new Date(y - 1, 11, 31).toISOString().slice(0, 10) };
  }
}

/* ── Layout-Algorithmus ── */

interface LayoutNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  children: LayoutNode[];
}

const NODE_W = 220;
const NODE_H = 110;
const GAP_X = 28;
const GAP_Y = 60;

function layoutTree(node: TreeNode, depth: number = 0): LayoutNode {
  const childLayouts = node.children.map((c) => layoutTree(c, depth + 1));

  let totalWidth = NODE_W;
  if (childLayouts.length > 0) {
    totalWidth = childLayouts.reduce((sum, c) => sum + c.width, 0) + (childLayouts.length - 1) * GAP_X;
    totalWidth = Math.max(totalWidth, NODE_W);
  }

  let offsetX = 0;
  for (const child of childLayouts) {
    child.x = offsetX + child.width / 2 - NODE_W / 2;
    child.y = (depth + 1) * (NODE_H + GAP_Y);
    offsetX += child.width + GAP_X;
  }

  return {
    node,
    x: totalWidth / 2 - NODE_W / 2,
    y: depth * (NODE_H + GAP_Y),
    width: totalWidth,
    children: childLayouts,
  };
}

function flattenLayout(layout: LayoutNode, offsetX: number = 0): { node: TreeNode; x: number; y: number }[] {
  const result: { node: TreeNode; x: number; y: number }[] = [];
  result.push({ node: layout.node, x: layout.x + offsetX, y: layout.y });
  for (const child of layout.children) {
    result.push(...flattenLayout(child, offsetX + layout.x + NODE_W / 2 - child.width / 2));
  }
  return result;
}

function getConnections(layout: LayoutNode, offsetX: number = 0): { x1: number; y1: number; x2: number; y2: number }[] {
  const conns: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const parentCenterX = layout.x + offsetX + NODE_W / 2;
  const parentBottomY = layout.y + NODE_H;

  for (const child of layout.children) {
    const childOffsetX = offsetX + layout.x + NODE_W / 2 - child.width / 2;
    const childCenterX = child.x + childOffsetX + NODE_W / 2;
    const childTopY = child.y;
    conns.push({ x1: parentCenterX, y1: parentBottomY, x2: childCenterX, y2: childTopY });
    conns.push(...getConnections(child, childOffsetX));
  }
  return conns;
}

/* ── Verbrauch aus Baum summieren ── */

function getRootConsumption(tree: TreeNode): number {
  return tree.consumption || 0;
}

/* ── Hauptkomponente ── */

export default function SchemasPage() {
  const [roots, setRoots] = useState<SchemaRoot[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeNode | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<SchemaRoot | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  // Periodenfilter
  const defaultPeriod = getDefaultPeriod();
  const [periodStart, setPeriodStart] = useState(defaultPeriod.start);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriod.end);

  const fetchRoots = useCallback(async () => {
    try {
      const res = await apiClient.get('/api/v1/meters/schema-roots');
      setRoots(res.data);
    } catch { /* leer */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchRoots();
  }, [fetchRoots]);

  const loadSubtree = useCallback(async (root: SchemaRoot, start?: string, end?: string) => {
    try {
      const ps = start || periodStart;
      const pe = end || periodEnd;
      const res = await apiClient.get(
        `/api/v1/meters/${root.id}/subtree?period_start=${ps}&period_end=${pe}`
      );
      setSelectedTree(res.data);
      setSelectedRoot(root);
    } catch { /* leer */ }
  }, [periodStart, periodEnd]);

  const removeLabel = async (meterId: string) => {
    if (!confirm('Betrachtungspunkt wirklich entfernen?')) return;
    try {
      await apiClient.put(`/api/v1/meters/${meterId}`, { schema_label: null });
      setRoots((prev) => prev.filter((r) => r.id !== meterId));
      if (selectedTree?.id === meterId) {
        setSelectedTree(null);
        setSelectedRoot(null);
      }
    } catch { /* leer */ }
  };

  const handlePeriodChange = (start: string, end: string) => {
    setPeriodStart(start);
    setPeriodEnd(end);
    if (selectedRoot) {
      loadSubtree(selectedRoot, start, end);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Energieschema</h1>
          <p className="mt-1 text-sm text-gray-500">
            Zählerstränge als Baumstruktur visualisieren – basierend auf der Zähler-Hierarchie.
          </p>
        </div>
        {!selectedTree && (
          <button onClick={() => setShowAddModal(true)} className="btn-primary flex items-center gap-1.5">
            <Plus className="h-4 w-4" />
            Betrachtungspunkt hinzufügen
          </button>
        )}
      </div>

      {!selectedTree ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {roots.length === 0 ? (
            <div className="card col-span-full text-center text-gray-400 py-12">
              <Gauge className="mx-auto h-12 w-12 text-gray-300 mb-3" />
              <p>Noch keine Betrachtungspunkte definiert.</p>
              <p className="text-sm mt-1">
                Markieren Sie einen Zähler als Einstiegspunkt, um dessen Unterbaum als Schema anzuzeigen.
              </p>
            </div>
          ) : (
            roots.map((root) => {
              const Icon = ENERGY_ICONS[root.energy_type] || Gauge;
              const color = NODE_COLORS[root.energy_type] || '#6b7280';
              return (
                <div
                  key={root.id}
                  className="card cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => loadSubtree(root)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg p-2" style={{ backgroundColor: `${color}15` }}>
                        <Icon className="h-5 w-5" style={{ color }} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">{root.schema_label}</h3>
                        <p className="text-sm text-gray-500">{root.name}</p>
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeLabel(root.id); }}
                      className="text-gray-300 hover:text-red-500 transition-colors"
                      title="Betrachtungspunkt entfernen"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                    <span>{ENERGY_TYPE_LABELS[root.energy_type as keyof typeof ENERGY_TYPE_LABELS] || root.energy_type}</span>
                    <span>{root.child_count} Unterzähler</span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : (
        <TreeView
          tree={selectedTree}
          label={selectedRoot?.schema_label || ''}
          periodStart={periodStart}
          periodEnd={periodEnd}
          onPeriodChange={handlePeriodChange}
          onBack={() => { setSelectedTree(null); setSelectedRoot(null); }}
        />
      )}

      {showAddModal && (
        <AddSchemaRootModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false);
            fetchRoots();
          }}
          existingRootIds={roots.map((r) => r.id)}
        />
      )}
    </div>
  );
}

/* ── Baumansicht ── */

function TreeView({
  tree,
  label,
  periodStart,
  periodEnd,
  onPeriodChange,
  onBack,
}: {
  tree: TreeNode;
  label: string;
  periodStart: string;
  periodEnd: string;
  onPeriodChange: (start: string, end: string) => void;
  onBack: () => void;
}) {
  const [popoverNode, setPopoverNode] = useState<string | null>(null);

  const layout = layoutTree(tree);
  const nodes = flattenLayout(layout);
  const connections = getConnections(layout);

  const pad = 30;
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W)) + pad * 2;
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H)) + pad * 2;

  const rootConsumption = getRootConsumption(tree);

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary text-sm flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" />
            Zurück
          </button>
          <h2 className="font-semibold text-gray-900">{label}</h2>
        </div>

        {/* Periodenfilter */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {([
              ['thisMonth', 'Dieser Monat'],
              ['lastMonth', 'Letzter Monat'],
              ['thisYear', 'Dieses Jahr'],
              ['lastYear', 'Letztes Jahr'],
            ] as [PresetKey, string][]).map(([key, text]) => (
              <button
                key={key}
                onClick={() => {
                  const p = getPresetPeriod(key);
                  onPeriodChange(p.start, p.end);
                }}
                className="rounded px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 border"
              >
                {text}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Calendar className="h-4 w-4 text-gray-400" />
            <input
              type="date"
              className="input text-xs py-1 px-2 w-32"
              value={periodStart}
              onChange={(e) => onPeriodChange(e.target.value, periodEnd)}
            />
            <span className="text-gray-400">–</span>
            <input
              type="date"
              className="input text-xs py-1 px-2 w-32"
              value={periodEnd}
              onChange={(e) => onPeriodChange(periodStart, e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="overflow-auto rounded-lg border bg-white" onClick={() => setPopoverNode(null)}>
        <div className="relative" style={{ width: maxX, height: maxY, minHeight: 300 }}>
          {/* SVG Verbindungslinien */}
          <svg className="absolute inset-0" width={maxX} height={maxY} style={{ zIndex: 0 }}>
            {connections.map((c, idx) => {
              const midY = (c.y1 + c.y2) / 2;
              return (
                <path
                  key={idx}
                  d={`M ${c.x1 + pad} ${c.y1 + pad} C ${c.x1 + pad} ${midY + pad}, ${c.x2 + pad} ${midY + pad}, ${c.x2 + pad} ${c.y2 + pad}`}
                  fill="none"
                  stroke="#cbd5e1"
                  strokeWidth={2}
                />
              );
            })}
          </svg>

          {/* Knoten */}
          {nodes.map((n) => {
            const color = NODE_COLORS[n.node.energy_type] || '#6b7280';
            const Icon = ENERGY_ICONS[n.node.energy_type] || Gauge;
            const share = rootConsumption > 0 && n.node.consumption > 0
              ? Math.round((n.node.consumption / rootConsumption) * 100)
              : 0;
            const isRoot = n.node.id === tree.id;

            return (
              <div
                key={n.node.id}
                className="absolute rounded-lg border-2 bg-white shadow-sm p-2.5"
                style={{
                  left: n.x + pad,
                  top: n.y + pad,
                  width: NODE_W,
                  height: NODE_H,
                  borderColor: color,
                  zIndex: popoverNode === n.node.id ? 10 : 1,
                }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Zeile 1: Icon + Name */}
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} />
                  <span className="text-xs font-semibold text-gray-700 truncate">{n.node.name}</span>
                </div>

                {/* Zeile 2: Verbrauch + Kosten */}
                <div className="flex items-baseline gap-1.5 text-[11px] mb-1.5">
                  <span className="font-bold text-gray-800">
                    {n.node.consumption > 0 ? `${fmtNum(n.node.consumption)} ${n.node.unit}` : '–'}
                  </span>
                  {n.node.cost != null && (
                    <span className="text-gray-500">{fmtCurrency(n.node.cost)}</span>
                  )}
                </div>

                {/* Zeile 3: Anteil-Balken */}
                {!isRoot && share > 0 && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${Math.min(share, 100)}%`, backgroundColor: color }}
                      />
                    </div>
                    <span className="text-[10px] text-gray-400 w-8 text-right">{share}%</span>
                  </div>
                )}

                {/* Zeile 4: Verbraucher + nicht zugeordnet */}
                <div className="flex items-center justify-between text-[10px]">
                  {n.node.consumers.length > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPopoverNode(popoverNode === n.node.id ? null : n.node.id);
                      }}
                      className="flex items-center gap-0.5 text-primary-600 hover:text-primary-700"
                    >
                      <Users className="h-3 w-3" />
                      {n.node.consumers.length} Verbraucher
                    </button>
                  ) : (
                    <span />
                  )}
                  {n.node.unaccounted != null && n.node.unaccounted > 0 && (
                    <span className="text-amber-600" title="Nicht zugeordneter Verbrauch">
                      Δ {fmtNum(n.node.unaccounted)} {n.node.unit}
                    </span>
                  )}
                </div>

                {/* Verbraucher-Popover */}
                {popoverNode === n.node.id && n.node.consumers.length > 0 && (
                  <div
                    className="absolute left-0 top-full mt-1 z-20 w-64 rounded-lg border bg-white shadow-lg p-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-700">Verbraucher</span>
                      <button onClick={() => setPopoverNode(null)} className="text-gray-400 hover:text-gray-600">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {n.node.consumers.map((c) => (
                        <div key={c.id} className="text-xs border-b pb-1.5 last:border-0 last:pb-0">
                          <div className="font-medium text-gray-700">{c.name}</div>
                          <div className="text-gray-400 flex gap-3">
                            <span>{c.category}</span>
                            {c.rated_power && <span>{c.rated_power} kW</span>}
                            {c.operating_hours && <span>{c.operating_hours} h/a</span>}
                          </div>
                          {c.rated_power && c.operating_hours && (
                            <div className="text-gray-500 mt-0.5">
                              ≈ {fmtNum(c.rated_power * c.operating_hours)} kWh/a
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ── Betrachtungspunkt hinzufügen Modal ── */

function AddSchemaRootModal({
  onClose,
  onAdded,
  existingRootIds,
}: {
  onClose: () => void;
  onAdded: () => void;
  existingRootIds: string[];
}) {
  const [meters, setMeters] = useState<Meter[]>([]);
  const [search, setSearch] = useState('');
  const [selectedMeter, setSelectedMeter] = useState<Meter | null>(null);
  const [schemaLabel, setSchemaLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/api/v1/meters?page_size=100');
        const items = res.data.items || res.data;
        setMeters(Array.isArray(items) ? items : []);
      } catch { /* leer */ }
      setLoading(false);
    })();
  }, []);

  const filteredMeters = meters.filter((m) => {
    if (existingRootIds.includes(m.id)) return false;
    if (!search) return true;
    return m.name.toLowerCase().includes(search.toLowerCase());
  });

  const handleSave = async () => {
    if (!selectedMeter || !schemaLabel.trim()) return;
    setSaving(true);
    try {
      await apiClient.put(`/api/v1/meters/${selectedMeter.id}`, {
        schema_label: schemaLabel.trim(),
      });
      onAdded();
    } catch {
      alert('Fehler beim Speichern');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Betrachtungspunkt hinzufügen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          Wählen Sie einen Zähler als Einstiegspunkt. Der gesamte Unterbaum ab diesem Zähler wird als Energieschema dargestellt.
        </p>

        <div className="mb-4">
          <label className="label">Zähler auswählen</label>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input
              type="text"
              className="input pl-9"
              placeholder="Zähler suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-48 overflow-y-auto rounded-lg border">
            {loading ? (
              <div className="p-4 text-center text-sm text-gray-400">Laden…</div>
            ) : filteredMeters.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-400">Keine passenden Zähler</div>
            ) : (
              filteredMeters.map((m) => {
                const Icon = ENERGY_ICONS[m.energy_type] || Gauge;
                const color = NODE_COLORS[m.energy_type] || '#6b7280';
                const isSelected = selectedMeter?.id === m.id;
                return (
                  <button
                    key={m.id}
                    onClick={() => {
                      setSelectedMeter(m);
                      if (!schemaLabel) setSchemaLabel(m.name);
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm border-b last:border-b-0 transition-colors ${
                      isSelected ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" style={{ color }} />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-gray-400">
                      {ENERGY_TYPE_LABELS[m.energy_type as keyof typeof ENERGY_TYPE_LABELS] || m.energy_type}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Bezeichnung *</label>
          <input
            className="input"
            value={schemaLabel}
            onChange={(e) => setSchemaLabel(e.target.value)}
            placeholder="z.B. Stromverteilung Halle 2"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            className="btn-primary"
            disabled={!selectedMeter || !schemaLabel.trim() || saving}
          >
            {saving ? 'Speichere…' : 'Hinzufügen'}
          </button>
        </div>
      </div>
    </div>
  );
}

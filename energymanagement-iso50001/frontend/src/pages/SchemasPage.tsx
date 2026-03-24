import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Trash2, ArrowLeft, Search,
  Gauge, Zap, Droplets, Flame, Sun, X,
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

interface TreeNode {
  id: string;
  name: string;
  energy_type: string;
  unit: string;
  schema_label: string | null;
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

/* ── Layout-Algorithmus ── */

interface LayoutNode {
  node: TreeNode;
  x: number;
  y: number;
  width: number;
  children: LayoutNode[];
}

const NODE_W = 180;
const NODE_H = 64;
const GAP_X = 32;
const GAP_Y = 80;

function layoutTree(node: TreeNode, depth: number = 0): LayoutNode {
  const childLayouts = node.children.map((c) => layoutTree(c, depth + 1));

  // Breite: Summe der Kinder-Breiten oder eigene Node-Breite
  let totalWidth = NODE_W;
  if (childLayouts.length > 0) {
    totalWidth = childLayouts.reduce((sum, c) => sum + c.width, 0) + (childLayouts.length - 1) * GAP_X;
    totalWidth = Math.max(totalWidth, NODE_W);
  }

  // Kinder horizontal verteilen
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

/* ── Hauptkomponente ── */

export default function SchemasPage() {
  const [roots, setRoots] = useState<SchemaRoot[]>([]);
  const [selectedTree, setSelectedTree] = useState<TreeNode | null>(null);
  const [selectedLabel, setSelectedLabel] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

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

  const loadSubtree = async (root: SchemaRoot) => {
    try {
      const res = await apiClient.get(`/api/v1/meters/${root.id}/subtree`);
      setSelectedTree(res.data);
      setSelectedLabel(root.schema_label);
    } catch { /* leer */ }
  };

  const removeLabel = async (meterId: string) => {
    if (!confirm('Betrachtungspunkt wirklich entfernen?')) return;
    try {
      await apiClient.put(`/api/v1/meters/${meterId}`, { schema_label: null });
      setRoots((prev) => prev.filter((r) => r.id !== meterId));
      if (selectedTree?.id === meterId) setSelectedTree(null);
    } catch { /* leer */ }
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
        /* Karten-Liste */
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
        /* Baumansicht */
        <TreeView
          tree={selectedTree}
          label={selectedLabel}
          onBack={() => setSelectedTree(null)}
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
  onBack,
}: {
  tree: TreeNode;
  label: string;
  onBack: () => void;
}) {
  const layout = layoutTree(tree);
  const nodes = flattenLayout(layout);
  const connections = getConnections(layout);

  // Canvas-Dimensionen berechnen
  const maxX = Math.max(...nodes.map((n) => n.x + NODE_W)) + 40;
  const maxY = Math.max(...nodes.map((n) => n.y + NODE_H)) + 40;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="btn-secondary text-sm flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" />
          Zurück
        </button>
        <h2 className="font-semibold text-gray-900">{label}</h2>
        <span className="text-sm text-gray-400">({tree.name})</span>
      </div>

      <div className="overflow-auto rounded-lg border bg-white">
        <div className="relative" style={{ width: maxX, height: maxY, minHeight: 300 }}>
          {/* SVG Verbindungslinien */}
          <svg className="absolute inset-0" width={maxX} height={maxY} style={{ zIndex: 0 }}>
            {connections.map((c, idx) => {
              const midY = (c.y1 + c.y2) / 2;
              return (
                <path
                  key={idx}
                  d={`M ${c.x1} ${c.y1} C ${c.x1} ${midY}, ${c.x2} ${midY}, ${c.x2} ${c.y2}`}
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
            return (
              <div
                key={n.node.id}
                className="absolute rounded-lg border-2 bg-white shadow-sm flex items-center gap-2 px-3"
                style={{
                  left: n.x + 20,
                  top: n.y + 20,
                  width: NODE_W,
                  height: NODE_H,
                  borderColor: color,
                  zIndex: 1,
                }}
              >
                <Icon className="h-5 w-5 flex-shrink-0" style={{ color }} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-700 truncate">{n.node.name}</div>
                  <div className="text-[10px] text-gray-400">
                    {ENERGY_TYPE_LABELS[n.node.energy_type as keyof typeof ENERGY_TYPE_LABELS] || n.node.energy_type}
                    {' · '}{n.node.unit}
                  </div>
                </div>
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

  // Zähler die noch keinen Betrachtungspunkt haben und Kinder haben könnten
  const filteredMeters = meters.filter((m) => {
    if (existingRootIds.includes(m.id)) return false;
    if (!search) return true;
    const lower = search.toLowerCase();
    return m.name.toLowerCase().includes(lower);
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

        {/* Zähler-Auswahl */}
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

        {/* Label */}
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

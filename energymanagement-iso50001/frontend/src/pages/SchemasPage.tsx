import { useEffect, useState, useRef } from 'react';
import {
  Plus, Trash2, Move, ZoomIn, ZoomOut,
  Gauge, Zap, Droplets, Flame, Sun, X,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';

/* ── Typen ── */

interface Schema {
  id: string;
  name: string;
  schema_type: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
}

interface SchemaPosition {
  id: string;
  schema_id: string;
  meter_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style_config: Record<string, unknown> | null;
  connections: { target_id: string; label?: string }[] | null;
  meter_name: string | null;
  energy_type: string | null;
}

interface SchemaDetail extends Schema {
  positions: SchemaPosition[];
}

interface Meter {
  id: string;
  name: string;
  energy_type: string;
  unit: string;
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

/* ── Hauptkomponente ── */

export default function SchemasPage() {
  const [schemas, setSchemas] = useState<Schema[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<SchemaDetail | null>(null);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);

  useEffect(() => {
    fetchSchemas();
    fetchMeters();
  }, []);

  const fetchSchemas = async () => {
    try {
      const res = await apiClient.get('/api/v1/schemas');
      setSchemas(res.data);
    } catch { /* leer */ }
    setLoading(false);
  };

  const fetchMeters = async () => {
    try {
      const res = await apiClient.get('/api/v1/meters');
      const items = res.data.items || res.data;
      setMeters(Array.isArray(items) ? items : []);
    } catch { /* leer */ }
  };

  const loadSchema = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/v1/schemas/${id}`);
      setSelectedSchema(res.data);
    } catch { /* leer */ }
  };

  const deleteSchema = async (id: string) => {
    if (!confirm('Schema wirklich löschen?')) return;
    try {
      await apiClient.delete(`/api/v1/schemas/${id}`);
      setSchemas((prev) => prev.filter((s) => s.id !== id));
      if (selectedSchema?.id === id) setSelectedSchema(null);
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
            Energieflussbilder erstellen und bearbeiten.
          </p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          Neues Schema
        </button>
      </div>

      {!selectedSchema ? (
        /* Schema-Liste */
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {schemas.length === 0 ? (
            <div className="card col-span-full text-center text-gray-400 py-12">
              Noch keine Schemas vorhanden. Erstellen Sie Ihr erstes Energieflussbild.
            </div>
          ) : (
            schemas.map((s) => (
              <div key={s.id} className="card cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadSchema(s.id)}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-gray-900">{s.name}</h3>
                    <p className="mt-1 text-sm text-gray-500">{s.description || 'Keine Beschreibung'}</p>
                  </div>
                  {s.is_default && (
                    <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-700">
                      Standard
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-gray-400">
                  <span>{s.schema_type}</span>
                  <span>{new Date(s.created_at).toLocaleDateString('de-DE')}</span>
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSchema(s.id); }}
                    className="text-red-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        /* Schema-Editor */
        <SchemaEditor
          schema={selectedSchema}
          meters={meters}
          onBack={() => setSelectedSchema(null)}
          onUpdate={loadSchema}
        />
      )}

      {/* Schema erstellen Modal */}
      {showCreateModal && (
        <CreateSchemaModal
          onClose={() => setShowCreateModal(false)}
          onCreate={(schema) => {
            setSchemas((prev) => [...prev, schema]);
            setShowCreateModal(false);
            loadSchema(schema.id);
          }}
        />
      )}
    </div>
  );
}

/* ── Schema-Editor mit Canvas ── */

function SchemaEditor({
  schema,
  meters,
  onBack,
  onUpdate: _onUpdate,
}: {
  schema: SchemaDetail;
  meters: Meter[];
  onBack: () => void;
  onUpdate: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [positions, setPositions] = useState<SchemaPosition[]>(schema.positions);
  const [draggedNode, setDraggedNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  void _onUpdate;
  const [showToolbox, setShowToolbox] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [connectingFrom, setConnectingFrom] = useState<string | null>(null);

  useEffect(() => {
    setPositions(schema.positions);
  }, [schema]);

  // Zähler, die noch nicht im Schema sind
  const availableMeters = meters.filter(
    (m) => !positions.some((p) => p.meter_id === m.id)
  );

  const handleMouseDown = (e: React.MouseEvent, posId: string) => {
    e.preventDefault();
    const pos = positions.find((p) => p.id === posId);
    if (!pos || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    setDraggedNode(posId);
    setDragOffset({
      x: (e.clientX - rect.left) / zoom - pos.x,
      y: (e.clientY - rect.top) / zoom - pos.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!draggedNode || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const newX = Math.max(0, (e.clientX - rect.left) / zoom - dragOffset.x);
    const newY = Math.max(0, (e.clientY - rect.top) / zoom - dragOffset.y);

    setPositions((prev) =>
      prev.map((p) =>
        p.id === draggedNode ? { ...p, x: newX, y: newY } : p
      )
    );
  };

  const handleMouseUp = async () => {
    if (!draggedNode) return;
    const pos = positions.find((p) => p.id === draggedNode);
    if (pos) {
      try {
        await apiClient.put(`/api/v1/schemas/${schema.id}/positions/${pos.id}`, {
          x: pos.x,
          y: pos.y,
        });
      } catch { /* leer */ }
    }
    setDraggedNode(null);
  };

  const addMeter = async (meterId: string) => {
    try {
      const _meter = meters.find((m) => m.id === meterId);
      void _meter;
      const newPos = {
        schema_id: schema.id,
        meter_id: meterId,
        x: 100 + positions.length * 30,
        y: 100 + positions.length * 30,
        width: 180,
        height: 70,
      };
      const res = await apiClient.post(`/api/v1/schemas/${schema.id}/positions`, newPos);
      setPositions((prev) => [...prev, res.data]);
    } catch { /* leer */ }
  };

  const removePosition = async (posId: string) => {
    try {
      await apiClient.delete(`/api/v1/schemas/${schema.id}/positions/${posId}`);
      setPositions((prev) => prev.filter((p) => p.id !== posId));
      if (selectedNode === posId) setSelectedNode(null);
    } catch { /* leer */ }
  };

  const addConnection = async (fromId: string, toId: string) => {
    const fromPos = positions.find((p) => p.id === fromId);
    if (!fromPos) return;

    const connections = [...(fromPos.connections || []), { target_id: toId }];
    try {
      await apiClient.put(`/api/v1/schemas/${schema.id}/positions/${fromId}`, {
        connections,
      });
      setPositions((prev) =>
        prev.map((p) => (p.id === fromId ? { ...p, connections } : p))
      );
    } catch { /* leer */ }
  };

  return (
    <div className="mt-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between rounded-t-lg border bg-gray-50 px-4 py-2">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="btn-secondary text-sm">
            ← Zurück
          </button>
          <h2 className="font-semibold text-gray-900">{schema.name}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowToolbox(!showToolbox)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              showToolbox ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 border hover:bg-gray-100'
            }`}
          >
            <Plus className="mr-1 inline h-4 w-4" />
            Zähler hinzufügen
          </button>
          {connectingFrom ? (
            <button
              onClick={() => setConnectingFrom(null)}
              className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-medium text-white"
            >
              Verbindung abbrechen
            </button>
          ) : null}
          <button onClick={() => setZoom((z) => Math.min(z + 0.1, 2))} className="rounded border p-1 hover:bg-gray-100">
            <ZoomIn className="h-4 w-4" />
          </button>
          <span className="text-xs text-gray-500">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.max(z - 0.1, 0.3))} className="rounded border p-1 hover:bg-gray-100">
            <ZoomOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="flex border-x border-b rounded-b-lg overflow-hidden">
        {/* Toolbox (Zähler-Auswahl) */}
        {showToolbox && (
          <div className="w-64 border-r bg-gray-50 p-3 overflow-y-auto max-h-[600px]">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Verfügbare Zähler</h3>
            {availableMeters.length === 0 ? (
              <p className="text-xs text-gray-400">Alle Zähler sind bereits im Schema</p>
            ) : (
              <div className="space-y-1.5">
                {availableMeters.map((m) => {
                  const Icon = ENERGY_ICONS[m.energy_type] || Gauge;
                  return (
                    <button
                      key={m.id}
                      onClick={() => addMeter(m.id)}
                      className="flex w-full items-center gap-2 rounded-lg border bg-white p-2 text-left text-sm hover:bg-primary-50 hover:border-primary-300 transition-colors"
                    >
                      <Icon className="h-4 w-4" style={{ color: NODE_COLORS[m.energy_type] || '#6b7280' }} />
                      <div>
                        <div className="font-medium text-gray-700">{m.name}</div>
                        <div className="text-xs text-gray-400">
                          {ENERGY_TYPE_LABELS[m.energy_type as keyof typeof ENERGY_TYPE_LABELS] || m.energy_type}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Canvas */}
        <div
          ref={canvasRef}
          className="relative flex-1 bg-white overflow-auto"
          style={{ minHeight: 600, cursor: draggedNode ? 'grabbing' : 'default' }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid-Hintergrund */}
          <svg className="absolute inset-0 w-full h-full" style={{ zIndex: 0 }}>
            <defs>
              <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f0f0f0" strokeWidth="0.5" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Verbindungslinien */}
            {positions.map((pos) =>
              (pos.connections || []).map((conn, idx) => {
                const target = positions.find((p) => p.id === conn.target_id);
                if (!target) return null;
                const x1 = (pos.x + pos.width / 2) * zoom;
                const y1 = (pos.y + pos.height / 2) * zoom;
                const x2 = (target.x + target.width / 2) * zoom;
                const y2 = (target.y + target.height / 2) * zoom;
                return (
                  <line
                    key={`${pos.id}-${idx}`}
                    x1={x1} y1={y1} x2={x2} y2={y2}
                    stroke="#94a3b8"
                    strokeWidth={2}
                    markerEnd="url(#arrowhead)"
                  />
                );
              })
            )}
            <defs>
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
              </marker>
            </defs>
          </svg>

          {/* Knoten */}
          {positions.map((pos) => {
            const color = NODE_COLORS[pos.energy_type || ''] || '#6b7280';
            const Icon = ENERGY_ICONS[pos.energy_type || ''] || Gauge;
            const isSelected = selectedNode === pos.id;
            const isConnecting = connectingFrom === pos.id;

            return (
              <div
                key={pos.id}
                className={`absolute rounded-lg border-2 bg-white shadow-sm transition-shadow ${
                  isSelected ? 'ring-2 ring-primary-400 shadow-md' : ''
                } ${isConnecting ? 'ring-2 ring-amber-400' : ''}`}
                style={{
                  left: pos.x * zoom,
                  top: pos.y * zoom,
                  width: pos.width * zoom,
                  height: pos.height * zoom,
                  borderColor: color,
                  zIndex: draggedNode === pos.id ? 10 : 1,
                  cursor: draggedNode === pos.id ? 'grabbing' : 'grab',
                }}
                onMouseDown={(e) => {
                  if (connectingFrom && connectingFrom !== pos.id) {
                    addConnection(connectingFrom, pos.id);
                    setConnectingFrom(null);
                    return;
                  }
                  handleMouseDown(e, pos.id);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedNode(pos.id === selectedNode ? null : pos.id);
                }}
              >
                <div className="flex h-full flex-col items-center justify-center p-2" style={{ transform: `scale(${Math.min(zoom, 1)})` }}>
                  <Icon className="h-5 w-5" style={{ color }} />
                  <span className="mt-1 text-center text-xs font-medium text-gray-700 leading-tight">
                    {pos.meter_name || 'Zähler'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    {ENERGY_TYPE_LABELS[(pos.energy_type || '') as keyof typeof ENERGY_TYPE_LABELS] || ''}
                  </span>
                </div>

                {/* Aktions-Buttons bei Selektion */}
                {isSelected && (
                  <div className="absolute -right-2 -top-2 flex gap-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); setConnectingFrom(pos.id); }}
                      className="rounded-full bg-blue-500 p-1 text-white shadow hover:bg-blue-600"
                      title="Verbindung erstellen"
                    >
                      <Move className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removePosition(pos.id); }}
                      className="rounded-full bg-red-500 p-1 text-white shadow hover:bg-red-600"
                      title="Entfernen"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {positions.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400">
              <div className="text-center">
                <Gauge className="mx-auto h-12 w-12 text-gray-300" />
                <p className="mt-2">Klicken Sie auf "Zähler hinzufügen" um Ihr Energieflussbild zu erstellen</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Schema erstellen Modal ── */

function CreateSchemaModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (schema: Schema) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [schemaType, setSchemaType] = useState('sankey');
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiClient.post('/api/v1/schemas', {
        name,
        schema_type: schemaType,
        description: description || null,
        is_default: isDefault,
      });
      onCreate(res.data);
    } catch {
      alert('Fehler beim Erstellen');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Neues Energieschema</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="z.B. Gebäude A – Stromverteilung"
              required
            />
          </div>
          <div>
            <label className="label">Beschreibung</label>
            <textarea
              className="input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optionale Beschreibung..."
            />
          </div>
          <div>
            <label className="label">Typ</label>
            <select className="input" value={schemaType} onChange={(e) => setSchemaType(e.target.value)}>
              <option value="sankey">Sankey (Energiefluss)</option>
              <option value="tree">Baumstruktur</option>
              <option value="floor_plan">Grundriss</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_default"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-primary-600"
            />
            <label htmlFor="is_default" className="text-sm text-gray-700">
              Als Standardschema festlegen
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">
              Abbrechen
            </button>
            <button type="submit" className="btn-primary" disabled={!name.trim() || saving}>
              {saving ? 'Erstelle…' : 'Erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

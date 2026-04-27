import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronRight, Zap, Building2, Home, GripVertical, Settings, Trash2, Activity, Wifi, Plus } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type PaginatedResponse } from '@/types';

// ── Typen ──

interface Site {
  id: string;
  name: string;
  street: string | null;
  zip_code: string | null;
  city: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  co2_region: string | null;
  timezone: string;
  building_count: number;
  meter_count: number;
  created_at: string;
}

interface Building {
  id: string;
  name: string;
  site_id: string;
  building_type: string | null;
  building_year: number | null;
  total_area_m2: number | null;
  heated_area_m2: number | null;
  cooled_area_m2: number | null;
  floors: number | null;
  energy_certificate_class: string | null;
  usage_unit_count: number;
  created_at: string;
}

interface UsageUnit {
  id: string;
  name: string;
  building_id: string;
  usage_type: string;
  floor: string | null;
  area_m2: number | null;
  occupants: number | null;
  tenant_name: string | null;
  created_at: string;
}

interface AnnotatedMeterNode {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
  data_source: string;
  parent_meter_id: string | null;
  is_active: boolean;
  is_virtual: boolean;
  is_feed_in: boolean;
  is_submeter: boolean;
  is_delivery_based: boolean;
  is_weather_corrected: boolean;
  site_id: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  source_config: Record<string, unknown> | null;
  virtual_config: Record<string, unknown> | null;
  schema_label: string | null;
  notes: string | null;
  display_name?: string | null;
  serial_number?: string | null;
  installation_date?: string | null;
  removal_date?: string | null;
  calibration_date?: string | null;
  cross_site_boundary: boolean;
  owner_site_name: string | null;
  children: AnnotatedMeterNode[];
}

interface SiteConsumption {
  site_id: string;
  site_name: string;
  period_start: string;
  period_end: string;
  gross_consumption_kwh: number;
  cross_site_exit_kwh: number;
  net_consumption_kwh: number;
  exit_points: Array<{
    meter_id: string;
    meter_name: string;
    owner_site_id: string | null;
    owner_site_name: string;
    consumption_kwh: number;
  }>;
}

// ── Forms ──

interface SiteForm {
  name: string; street: string; zip_code: string;
  city: string; country: string; latitude: string; longitude: string;
}
interface BuildingForm {
  name: string; building_type: string; building_year: string;
  total_area_m2: string; heated_area_m2: string; cooled_area_m2: string;
  floors: string; energy_certificate_class: string;
}
interface UnitForm {
  name: string; usage_type: string; floor: string;
  area_m2: string; occupants: string; tenant_name: string;
}
interface MeterForm {
  name: string; meter_number: string; energy_type: string; unit: string;
  data_source: string; location: string;
  site_id: string; building_id: string; usage_unit_id: string; parent_meter_id: string;
  is_virtual: boolean; is_feed_in: boolean; is_delivery_based: boolean; is_weather_corrected: boolean;
  schema_label: string; notes: string;
  source_host: string; source_channel: string; source_entity_id: string;
  source_register: string; source_topic: string; source_broker: string;
  display_name: string; serial_number: string;
  installation_date: string; removal_date: string; calibration_date: string;
}

const emptySiteForm: SiteForm = { name: '', street: '', zip_code: '', city: '', country: 'DE', latitude: '', longitude: '' };
const emptyBuildingForm: BuildingForm = { name: '', building_type: '', building_year: '', total_area_m2: '', heated_area_m2: '', cooled_area_m2: '', floors: '', energy_certificate_class: '' };
const emptyUnitForm: UnitForm = { name: '', usage_type: 'office', floor: '', area_m2: '', occupants: '', tenant_name: '' };
const emptyMeterForm: MeterForm = {
  name: '', meter_number: '', energy_type: 'electricity', unit: 'kWh',
  data_source: 'manual', location: '',
  site_id: '', building_id: '', usage_unit_id: '', parent_meter_id: '',
  is_virtual: false, is_feed_in: false, is_delivery_based: false, is_weather_corrected: false,
  schema_label: '', notes: '',
  source_host: '', source_channel: '0', source_entity_id: '', source_register: '', source_topic: '', source_broker: '',
  display_name: '', serial_number: '', installation_date: '', removal_date: '', calibration_date: '',
};

// ── Konstanten ──

const ENERGY_COLORS: Record<string, string> = {
  electricity: 'bg-yellow-100 text-yellow-800',
  gas: 'bg-blue-100 text-blue-800',
  district_heating: 'bg-red-100 text-red-800',
  district_cooling: 'bg-cyan-100 text-cyan-800',
  water: 'bg-teal-100 text-teal-800',
};

const DATA_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manuell', csv_import: 'CSV', shelly: 'Shelly', modbus: 'Modbus',
  knx: 'KNX', homeassistant: 'Home Assistant', spie: 'SPIE', mqtt: 'MQTT',
  bacnet: 'BACnet', virtual: 'Virtuell',
};

const ENERGY_TYPE_OPTIONS = [
  { value: 'electricity', label: 'Strom' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Wasser' },
  { value: 'district_heating', label: 'Fernwärme' },
  { value: 'district_cooling', label: 'Fernkälte' },
  { value: 'oil', label: 'Heizöl' },
  { value: 'pellets', label: 'Pellets' },
  { value: 'solar_thermal', label: 'Solarthermie' },
  { value: 'biomass', label: 'Biomasse' },
];

const UNIT_OPTIONS: Record<string, string[]> = {
  electricity: ['kWh', 'MWh'],
  gas: ['m³', 'kWh', 'MWh'],
  water: ['m³', 'l'],
  district_heating: ['kWh', 'MWh'],
  district_cooling: ['kWh', 'MWh'],
  default: ['kWh', 'MWh', 'm³', 'l', 'kg', 'Stk'],
};

const DATA_SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manuell' },
  { value: 'shelly', label: 'Shelly' },
  { value: 'modbus', label: 'Modbus' },
  { value: 'knx', label: 'KNX' },
  { value: 'homeassistant', label: 'Home Assistant' },
  { value: 'mqtt', label: 'MQTT' },
  { value: 'bacnet', label: 'BACnet' },
  { value: 'csv_import', label: 'CSV-Import' },
  { value: 'spie', label: 'SPIE' },
  { value: 'virtual', label: 'Virtuell' },
];

const BUILDING_TYPES: Record<string, string> = {
  office: 'Büro', residential: 'Wohnen', production: 'Produktion',
  retail: 'Einzelhandel', warehouse: 'Lager', school: 'Schule',
  hospital: 'Krankenhaus', hotel: 'Hotel', other: 'Sonstige',
};

const USAGE_TYPES: Record<string, string> = {
  office: 'Büro', server_room: 'Serverraum', workshop: 'Werkstatt',
  apartment: 'Wohnung', retail: 'Verkaufsfläche', storage: 'Lager',
  common_area: 'Allgemeinfläche', parking: 'Parkhaus/TG', other: 'Sonstige',
};

// ── Hilfsfunktionen ──

function cleanFormData(data: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    if (['latitude', 'longitude', 'total_area_m2', 'heated_area_m2', 'cooled_area_m2', 'area_m2'].includes(key))
      result[key] = parseFloat(value);
    else if (['building_year', 'floors', 'occupants'].includes(key))
      result[key] = parseInt(value, 10);
    else result[key] = value;
  }
  return result;
}

function buildMeterPayload(form: MeterForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name,
    energy_type: form.energy_type,
    unit: form.unit,
    data_source: form.data_source,
    is_virtual: form.is_virtual,
    is_feed_in: form.is_feed_in,
    is_delivery_based: form.is_delivery_based,
    is_weather_corrected: form.is_weather_corrected,
  };
  if (form.meter_number) payload.meter_number = form.meter_number;
  if (form.location) payload.location = form.location;
  if (form.site_id) payload.site_id = form.site_id;
  if (form.building_id) payload.building_id = form.building_id;
  if (form.usage_unit_id) payload.usage_unit_id = form.usage_unit_id;
  if (form.parent_meter_id) payload.parent_meter_id = form.parent_meter_id;
  if (form.schema_label) payload.schema_label = form.schema_label;
  if (form.notes) payload.notes = form.notes;
  if (form.display_name) payload.display_name = form.display_name;
  if (form.serial_number) payload.serial_number = form.serial_number;
  if (form.installation_date) payload.installation_date = form.installation_date;
  if (form.removal_date) payload.removal_date = form.removal_date;
  if (form.calibration_date) payload.calibration_date = form.calibration_date;

  // source_config je nach Datenquelle
  if (form.data_source === 'shelly' && form.source_host) {
    payload.source_config = { shelly_host: form.source_host, channel: parseInt(form.source_channel) || 0 };
  } else if (form.data_source === 'modbus' && form.source_host) {
    payload.source_config = { ip: form.source_host, register: parseInt(form.source_register) || 0 };
  } else if (form.data_source === 'homeassistant' && form.source_entity_id) {
    payload.source_config = { entity_id: form.source_entity_id };
  } else if (form.data_source === 'mqtt' && form.source_topic) {
    payload.source_config = { broker_host: form.source_broker, topic: form.source_topic, port: 1883 };
  }

  return payload;
}

function flattenTree(nodes: AnnotatedMeterNode[]): AnnotatedMeterNode[] {
  const result: AnnotatedMeterNode[] = [];
  const visit = (n: AnnotatedMeterNode) => { result.push(n); n.children.forEach(visit); };
  nodes.forEach(visit);
  return result;
}

function filterTree(nodes: AnnotatedMeterNode[], energyType: string): AnnotatedMeterNode[] {
  const filtered: AnnotatedMeterNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTree(node.children, energyType);
    if (node.energy_type === energyType || filteredChildren.length > 0) {
      filtered.push({ ...node, children: filteredChildren });
    }
  }
  return filtered;
}

function countNodes(nodes: AnnotatedMeterNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

// ── DnD-Typen ──
interface DndProps {
  draggingId: string | null;
  dragOverId: string | null;
  setDraggingId: (id: string | null) => void;
  setDragOverId: (id: string | null) => void;
  onDropOnNode: (targetId: string) => void;
}

// ── MeterTreeRow ──

function MeterTreeRow({
  node, depth = 0, dnd, onEdit, onDelete, onPoll, onTestConnection,
}: {
  node: AnnotatedMeterNode;
  depth?: number;
  dnd: DndProps;
  onEdit: (node: AnnotatedMeterNode) => void;
  onDelete: (node: AnnotatedMeterNode) => void;
  onPoll: (node: AnnotatedMeterNode) => void;
  onTestConnection: (node: AnnotatedMeterNode) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  const isDragging = dnd.draggingId === node.id;
  const isDragOver = dnd.dragOverId === node.id;

  return (
    <>
      <tr
        draggable
        onDragStart={e => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', node.id);
          dnd.setDraggingId(node.id);
        }}
        onDragEnd={() => { dnd.setDraggingId(null); dnd.setDragOverId(null); }}
        onDragOver={e => {
          e.preventDefault();
          if (dnd.draggingId && dnd.draggingId !== node.id) {
            e.dataTransfer.dropEffect = 'move';
            dnd.setDragOverId(node.id);
          }
        }}
        onDragLeave={() => { if (dnd.dragOverId === node.id) dnd.setDragOverId(null); }}
        onDrop={e => {
          e.preventDefault();
          if (dnd.draggingId && dnd.draggingId !== node.id) dnd.onDropOnNode(node.id);
          dnd.setDragOverId(null);
        }}
        className={`group select-none transition-colors ${
          isDragging ? 'opacity-40' : ''
        } ${isDragOver ? 'bg-primary-50 ring-1 ring-inset ring-primary-300' : 'hover:bg-gray-50'}`}
      >
        {/* Name */}
        <td className="px-3 py-2">
          <div className="flex items-center min-w-0" style={{ paddingLeft: `${depth * 18}px` }}>
            <GripVertical className="w-3 h-3 text-gray-300 mr-1 flex-shrink-0 cursor-grab active:cursor-grabbing" />
            {hasChildren
              ? <button onClick={() => setOpen(!open)} className="mr-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
              : <span className="mr-1 w-3.5 inline-block flex-shrink-0" />}
            <span className={`font-medium truncate text-sm ${node.cross_site_boundary ? 'text-amber-800' : 'text-gray-900'}`}
              title={node.display_name ? `${node.name}\n${node.display_name}` : node.name}>
              {node.name}
              {node.display_name && (
                <span className="block text-xs font-normal text-gray-400 truncate">{node.display_name}</span>
              )}
            </span>
            {node.cross_site_boundary && (
              <span className="ml-1.5 flex-shrink-0 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                ↗ {node.owner_site_name ?? 'Anderer Standort'}
              </span>
            )}
            {node.meter_number && (
              <span className="ml-1.5 text-xs text-gray-400 font-mono flex-shrink-0">{node.meter_number}</span>
            )}
          </div>
        </td>
        {/* Energieart */}
        <td className="px-3 py-2 flex-shrink-0">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ENERGY_COLORS[node.energy_type] || 'bg-gray-100 text-gray-700'}`}>
            {ENERGY_TYPE_LABELS[node.energy_type as keyof typeof ENERGY_TYPE_LABELS] || node.energy_type}
          </span>
        </td>
        {/* Datenquelle */}
        <td className="px-3 py-2 text-xs text-gray-500">
          {DATA_SOURCE_LABELS[node.data_source] || node.data_source}
          {node.is_virtual && <span className="ml-1 text-purple-600">(V)</span>}
          {node.is_feed_in && <span className="ml-1 text-green-600">(E)</span>}
        </td>
        {/* Info */}
        <td className="px-3 py-2 text-xs text-gray-400 text-right">
          {hasChildren && `${node.children.length} Sub`}
        </td>
        {/* Aktionen – via CSS group-hover sichtbar, kein JS-State */}
        <td className="px-3 py-2 text-right">
          <div className="inline-flex items-center gap-1 transition-opacity opacity-0 group-hover:opacity-100">
            {!node.cross_site_boundary && (
              <>
                <button
                  onClick={() => onEdit(node)}
                  title="Bearbeiten"
                  className="p-1 text-gray-400 hover:text-primary-600 rounded"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onPoll(node)}
                  title="Messwert abfragen"
                  className="p-1 text-gray-400 hover:text-blue-600 rounded"
                >
                  <Activity className="w-3.5 h-3.5" />
                </button>
                {node.data_source === 'shelly' && (
                  <button
                    onClick={() => onTestConnection(node)}
                    title="Verbindung testen"
                    className="p-1 text-gray-400 hover:text-green-600 rounded"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => onDelete(node)}
                  title="Löschen"
                  className="p-1 text-gray-400 hover:text-red-600 rounded"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            <a
              href={`/readings?meter_id=${node.id}`}
              onClick={e => { e.preventDefault(); window.location.href = `/readings?meter_id=${node.id}`; }}
              className="text-xs text-primary-600 hover:text-primary-800 px-1"
            >
              Werte
            </a>
          </div>
        </td>
      </tr>
      {open && node.children.map(child => (
        <MeterTreeRow
          key={child.id} node={child} depth={depth + 1} dnd={dnd}
          onEdit={onEdit} onDelete={onDelete} onPoll={onPoll} onTestConnection={onTestConnection}
        />
      ))}
    </>
  );
}

// ── MeterTreeTable ──

function MeterTreeTable({
  nodes, loading, emptyMessage, onReload, onEdit, onDelete, onPoll, onTestConnection,
}: {
  nodes: AnnotatedMeterNode[];
  loading?: boolean;
  emptyMessage?: string;
  onReload: () => void;
  onEdit: (node: AnnotatedMeterNode) => void;
  onDelete: (node: AnnotatedMeterNode) => void;
  onPoll: (node: AnnotatedMeterNode) => void;
  onTestConnection: (node: AnnotatedMeterNode) => void;
}) {
  const [colWidths, setColWidths] = useState([280, 120, 130, 80, 120]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropOverRoot, setDropOverRoot] = useState(false);
  const resizingRef = useRef<{ colIdx: number; startX: number; startWidth: number } | null>(null);

  const startResize = (colIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = { colIdx, startX: e.clientX, startWidth: colWidths[colIdx] };
    const onMouseMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const { colIdx: ci, startX, startWidth } = resizingRef.current;
      setColWidths(prev => { const next = [...prev]; next[ci] = Math.max(60, startWidth + ev.clientX - startX); return next; });
    };
    const onMouseUp = () => { resizingRef.current = null; document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp); };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleDropOnNode = async (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    try { await apiClient.put(`/api/v1/meters/${draggingId}`, { parent_meter_id: targetId }); onReload(); }
    catch { /* interceptor */ } finally { setDraggingId(null); setDragOverId(null); }
  };

  const handleDropToRoot = async () => {
    if (!draggingId) return;
    setDropOverRoot(false);
    try { await apiClient.put(`/api/v1/meters/${draggingId}`, { parent_meter_id: null }); onReload(); }
    catch { /* interceptor */ } finally { setDraggingId(null); setDragOverId(null); }
  };

  const dnd: DndProps = { draggingId, dragOverId, setDraggingId, setDragOverId, onDropOnNode: handleDropOnNode };
  const resizeHandle = (i: number) => (
    <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 5, cursor: 'col-resize', zIndex: 1 }}
      onMouseDown={e => startResize(i, e)} onClick={e => e.stopPropagation()} />
  );

  if (loading) return <div className="p-8 text-center text-gray-400">Zähler werden geladen...</div>;
  if (nodes.length === 0) return <div className="p-8 text-center text-gray-400">{emptyMessage || 'Keine Zähler.'}</div>;

  return (
    <div>
      {draggingId && (
        <div
          onDragOver={e => { e.preventDefault(); setDropOverRoot(true); }}
          onDragLeave={() => setDropOverRoot(false)}
          onDrop={e => { e.preventDefault(); handleDropToRoot(); }}
          className={`mb-2 flex items-center justify-center rounded-lg border-2 border-dashed py-2 text-sm transition-colors ${dropOverRoot ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-300 text-gray-400'}`}
        >
          Hier ablegen → Elternzuordnung entfernen (Hauptzähler)
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>{colWidths.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
            <tr>
              {['Name / Zählernummer', 'Energieart', 'Datenquelle', 'Info', ''].map((label, i) => (
                <th key={i} className={`px-3 py-2.5 ${i > 2 ? 'text-right' : 'text-left'}`}
                  style={{ width: colWidths[i], position: 'relative', userSelect: 'none' }}>
                  {label}{resizeHandle(i)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {nodes.map(node => (
              <MeterTreeRow key={node.id} node={node} depth={0} dnd={dnd}
                onEdit={onEdit} onDelete={onDelete} onPoll={onPoll} onTestConnection={onTestConnection} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Zähler-Modal ──

function MeterModal({
  form, setForm, editingId, onSubmit, onClose, error, saving,
  siteMeters, siteBuildings, siteUnits,
}: {
  form: MeterForm;
  setForm: (f: MeterForm) => void;
  editingId: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  error: string | null;
  saving: boolean;
  siteMeters: AnnotatedMeterNode[];
  siteBuildings: Building[];
  siteUnits: UsageUnit[];
}) {
  const unitOptions = UNIT_OPTIONS[form.energy_type] || UNIT_OPTIONS.default;
  const flatMeters = flattenTree(siteMeters).filter(m => m.id !== editingId);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl mx-4">
        <h2 className="mb-4 text-lg font-bold">{editingId ? 'Zähler bearbeiten' : 'Neuer Zähler'}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

          {/* Basis */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Name *</label>
              <input type="text" className="input" value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div>
              <label className="label">Zählernummer</label>
              <input type="text" className="input" value={form.meter_number}
                onChange={e => setForm({ ...form, meter_number: e.target.value })} placeholder="z.B. EL-001" />
            </div>
            <div>
              <label className="label">Standort / Bezeichnung</label>
              <input type="text" className="input" value={form.location}
                onChange={e => setForm({ ...form, location: e.target.value })} placeholder="z.B. Technikraum UG" />
            </div>
          </div>

          {/* Energieart / Einheit */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Energieart *</label>
              <select className="input" value={form.energy_type}
                onChange={e => setForm({ ...form, energy_type: e.target.value, unit: UNIT_OPTIONS[e.target.value]?.[0] || 'kWh' })}>
                {ENERGY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Einheit *</label>
              <select className="input" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Datenquelle *</label>
              <select className="input" value={form.data_source} onChange={e => setForm({ ...form, data_source: e.target.value })}>
                {DATA_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>

          {/* Datenquellen-Konfiguration */}
          {(form.data_source === 'shelly') && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">IP-Adresse / Hostname</label>
                <input type="text" className="input" value={form.source_host}
                  onChange={e => setForm({ ...form, source_host: e.target.value })} placeholder="192.168.1.100" />
              </div>
              <div>
                <label className="label">Kanal</label>
                <input type="number" className="input" value={form.source_channel}
                  onChange={e => setForm({ ...form, source_channel: e.target.value })} min="0" max="5" />
              </div>
            </div>
          )}
          {form.data_source === 'modbus' && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">IP-Adresse</label>
                <input type="text" className="input" value={form.source_host}
                  onChange={e => setForm({ ...form, source_host: e.target.value })} placeholder="192.168.1.100" />
              </div>
              <div>
                <label className="label">Register</label>
                <input type="number" className="input" value={form.source_register}
                  onChange={e => setForm({ ...form, source_register: e.target.value })} />
              </div>
            </div>
          )}
          {form.data_source === 'homeassistant' && (
            <div className="rounded-lg bg-gray-50 p-3">
              <label className="label">Entity-ID</label>
              <input type="text" className="input" value={form.source_entity_id}
                onChange={e => setForm({ ...form, source_entity_id: e.target.value })} placeholder="sensor.stromzaehler_kwh" />
            </div>
          )}
          {form.data_source === 'mqtt' && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div>
                <label className="label">Broker</label>
                <input type="text" className="input" value={form.source_broker}
                  onChange={e => setForm({ ...form, source_broker: e.target.value })} placeholder="192.168.1.10" />
              </div>
              <div>
                <label className="label">Topic</label>
                <input type="text" className="input" value={form.source_topic}
                  onChange={e => setForm({ ...form, source_topic: e.target.value })} placeholder="energie/strom/kwh" />
              </div>
            </div>
          )}

          {/* Hierarchie */}
          <div className="grid grid-cols-2 gap-4">
            {siteBuildings.length > 0 && (
              <div>
                <label className="label">Gebäude</label>
                <select className="input" value={form.building_id} onChange={e => setForm({ ...form, building_id: e.target.value, usage_unit_id: '' })}>
                  <option value="">– Keines –</option>
                  {siteBuildings.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            {siteUnits.length > 0 && (
              <div>
                <label className="label">Nutzungseinheit</label>
                <select className="input" value={form.usage_unit_id} onChange={e => setForm({ ...form, usage_unit_id: e.target.value })}>
                  <option value="">– Keine –</option>
                  {siteUnits.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">Übergeordneter Zähler</label>
              <select className="input" value={form.parent_meter_id} onChange={e => setForm({ ...form, parent_meter_id: e.target.value })}>
                <option value="">– Kein (Hauptzähler) –</option>
                {flatMeters.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          {/* Flags */}
          <div className="flex flex-wrap gap-4">
            {[
              { key: 'is_feed_in', label: 'Einspeisung (Feed-In)' },
              { key: 'is_virtual', label: 'Virtueller Zähler' },
              { key: 'is_delivery_based', label: 'Lieferbasiert (Öl/Pellets)' },
              { key: 'is_weather_corrected', label: 'Witterungskorrigiert' },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form[key as keyof MeterForm] as boolean}
                  onChange={e => setForm({ ...form, [key]: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                {label}
              </label>
            ))}
          </div>

          {/* Zusatzfelder */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Schema-Label</label>
              <input type="text" className="input" value={form.schema_label}
                onChange={e => setForm({ ...form, schema_label: e.target.value })} placeholder="z.B. Haupteinspeisung" />
            </div>
            <div>
              <label className="label">Notizen</label>
              <input type="text" className="input" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>

          {/* Technische Daten */}
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
              Technische Daten (Einbau, Eichfrist, Seriennummer)
            </summary>
            <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="label">Klarname</label>
                <input type="text" className="input" value={form.display_name}
                  onChange={e => setForm({ ...form, display_name: e.target.value })}
                  placeholder="z.B. WC Allgemein EG A-00/81/82" />
              </div>
              <div>
                <label className="label">Seriennummer / akt. Zählernummer</label>
                <input type="text" className="input" value={form.serial_number}
                  onChange={e => setForm({ ...form, serial_number: e.target.value })}
                  placeholder="z.B. 12345678" />
              </div>
              <div>
                <label className="label">Einbaudatum</label>
                <input type="date" className="input" value={form.installation_date}
                  onChange={e => setForm({ ...form, installation_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Ausbaudatum / Tausch</label>
                <input type="date" className="input" value={form.removal_date}
                  onChange={e => setForm({ ...form, removal_date: e.target.value })} />
              </div>
              <div>
                <label className="label">Eichfrist</label>
                <input type="date" className="input" value={form.calibration_date}
                  onChange={e => setForm({ ...form, calibration_date: e.target.value })} />
              </div>
            </div>
          </details>

          <div className="flex justify-end gap-3 pt-2 border-t">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Hauptkomponente ──

export default function SitesPage() {
  const [searchParams] = useSearchParams();

  // Standort-Liste
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Hierarchie-Navigation
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<(Building & { usage_units: UsageUnit[] }) | null>(null);

  // Standort-Detail
  const [siteBuildings, setSiteBuildings] = useState<Building[]>([]);
  const [siteMeters, setSiteMeters] = useState<AnnotatedMeterNode[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'meters' | 'buildings'>('meters');
  const [meterEnergyFilter, setMeterEnergyFilter] = useState<string>('');

  // Nettoverbrauch
  const [siteConsumption, setSiteConsumption] = useState<SiteConsumption | null>(null);
  const currentYear = new Date().getFullYear();
  const [consumptionYear, setConsumptionYear] = useState(currentYear - 1);

  // Gebäude-Detail
  const [buildingMeters, setBuildingMeters] = useState<AnnotatedMeterNode[]>([]);
  const [buildingActiveTab, setBuildingActiveTab] = useState<'units' | 'meters'>('meters');

  // Zähler-Modal
  const [showMeterModal, setShowMeterModal] = useState(false);
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [meterForm, setMeterForm] = useState<MeterForm>(emptyMeterForm);
  const [meterFormError, setMeterFormError] = useState<string | null>(null);
  const [meterSaving, setMeterSaving] = useState(false);

  // Poll/Test-Ergebnis-Modal
  const [actionResult, setActionResult] = useState<{ title: string; message: string } | null>(null);

  // Site/Building/Unit Modals
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<SiteForm>(emptySiteForm);
  const [buildingForm, setBuildingForm] = useState<BuildingForm>(emptyBuildingForm);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnitForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Alle Nutzungseinheiten des Standorts (für Zähler-Modal)
  const [allSiteUnits, setAllSiteUnits] = useState<UsageUnit[]>([]);

  const pageSize = 25;

  // ── Laden ──

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() });
      if (search) params.append('search', search);
      const res = await apiClient.get<PaginatedResponse<Site>>(`/api/v1/sites?${params}`);
      setSites(res.data.items);
      setTotal(res.data.total);
    } catch { /* Interceptor */ } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { loadSites(); }, [loadSites]);

  const loadSiteDetail = useCallback(async (site: Site) => {
    setSelectedSite(site);
    setSelectedBuilding(null);
    setDetailLoading(true);
    setSiteBuildings([]);
    setSiteMeters([]);
    setSiteConsumption(null);
    setMeterEnergyFilter('');
    try {
      const [buildingsRes, metersRes] = await Promise.all([
        apiClient.get<Building[]>(`/api/v1/sites/${site.id}/buildings`),
        apiClient.get<AnnotatedMeterNode[]>(`/api/v1/sites/${site.id}/meter-tree`),
      ]);
      setSiteBuildings(buildingsRes.data);
      setSiteMeters(metersRes.data);

      // Nutzungseinheiten aller Gebäude laden (für Zähler-Modal)
      const units: UsageUnit[] = [];
      for (const b of buildingsRes.data) {
        try {
          const bRes = await apiClient.get<{ usage_units: UsageUnit[] }>(`/api/v1/sites/${site.id}/buildings/${b.id}`);
          units.push(...(bRes.data.usage_units || []));
        } catch { /* weiter */ }
      }
      setAllSiteUnits(units);
    } catch { /* Interceptor */ } finally { setDetailLoading(false); }
  }, []);

  const loadSiteConsumption = useCallback(async (siteId: string, year: number) => {
    try {
      const res = await apiClient.get<SiteConsumption>(
        `/api/v1/sites/${siteId}/consumption?period_start=${year}-01-01&period_end=${year}-12-31`
      );
      setSiteConsumption(res.data);
    } catch { /* Interceptor */ }
  }, []);

  useEffect(() => {
    if (selectedSite) loadSiteConsumption(selectedSite.id, consumptionYear);
  }, [selectedSite, consumptionYear, loadSiteConsumption]);

  // Auto-Standort aus URL-Parameter öffnen
  const autoSiteParam = searchParams.get('site');
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoSiteParam || autoOpenedRef.current || loading || sites.length === 0) return;
    const match = sites.find((s) => s.id === autoSiteParam);
    if (match) {
      autoOpenedRef.current = true;
      loadSiteDetail(match);
    }
  }, [autoSiteParam, sites, loading, loadSiteDetail]);

  const reloadSiteMeters = useCallback(async () => {
    if (!selectedSite) return;
    try {
      const res = await apiClient.get<AnnotatedMeterNode[]>(`/api/v1/sites/${selectedSite.id}/meter-tree`);
      setSiteMeters(res.data);
    } catch { /* Interceptor */ }
  }, [selectedSite]);

  const loadBuildingDetail = useCallback(async (siteId: string, buildingId: string) => {
    try {
      const buildingRes = await apiClient.get(`/api/v1/sites/${siteId}/buildings/${buildingId}`);
      const building = buildingRes.data;
      setSelectedBuilding(building);

      const unitIds: string[] = (building.usage_units || []).map((u: UsageUnit) => u.id);
      const meterRequests = [
        apiClient.get<PaginatedResponse<AnnotatedMeterNode>>(`/api/v1/meters?building_id=${buildingId}&page_size=500`),
        ...unitIds.map(uid => apiClient.get<PaginatedResponse<AnnotatedMeterNode>>(`/api/v1/meters?usage_unit_id=${uid}&page_size=500`)),
      ];
      const meterResults = await Promise.all(meterRequests);
      const meterMap = new Map<string, AnnotatedMeterNode>();
      meterResults.forEach(r => r.data.items.forEach((m: AnnotatedMeterNode) => meterMap.set(m.id, m)));
      // Flache Liste → Baum aufbauen
      const flat = [...meterMap.values()];
      const nodeMap = new Map(flat.map(m => [m.id, { ...m, children: [] as AnnotatedMeterNode[] }]));
      const roots: AnnotatedMeterNode[] = [];
      for (const node of nodeMap.values()) {
        if (node.parent_meter_id && nodeMap.has(node.parent_meter_id)) nodeMap.get(node.parent_meter_id)!.children.push(node);
        else roots.push(node);
      }
      roots.sort((a, b) => a.name.localeCompare(b.name));
      setBuildingMeters(roots);
    } catch { /* Interceptor */ }
  }, []);

  const reloadBuildingMeters = useCallback(async () => {
    if (!selectedBuilding || !selectedSite) return;
    await loadBuildingDetail(selectedSite.id, selectedBuilding.id);
  }, [selectedBuilding, selectedSite, loadBuildingDetail]);

  // ── Zähler CRUD ──

  const openNewMeter = () => {
    setEditingMeterId(null);
    setMeterForm({ ...emptyMeterForm, site_id: selectedSite?.id || '' });
    setMeterFormError(null);
    setShowMeterModal(true);
  };

  const openEditMeter = (node: AnnotatedMeterNode) => {
    const sourceConfig = node.source_config || {};
    setEditingMeterId(node.id);
    setMeterForm({
      name: node.name,
      meter_number: node.meter_number || '',
      energy_type: node.energy_type,
      unit: node.unit,
      data_source: node.data_source,
      location: '',
      site_id: node.site_id || selectedSite?.id || '',
      building_id: node.building_id || '',
      usage_unit_id: node.usage_unit_id || '',
      parent_meter_id: node.parent_meter_id || '',
      is_virtual: node.is_virtual,
      is_feed_in: node.is_feed_in,
      is_delivery_based: node.is_delivery_based,
      is_weather_corrected: node.is_weather_corrected,
      schema_label: node.schema_label || '',
      notes: node.notes || '',
      source_host: (sourceConfig.shelly_host || sourceConfig.ip || '') as string,
      source_channel: String(sourceConfig.channel ?? '0'),
      source_entity_id: (sourceConfig.entity_id || '') as string,
      source_register: String(sourceConfig.register ?? ''),
      source_topic: (sourceConfig.topic || '') as string,
      source_broker: (sourceConfig.broker_host || '') as string,
      display_name: node.display_name || '',
      serial_number: node.serial_number || '',
      installation_date: node.installation_date || '',
      removal_date: node.removal_date || '',
      calibration_date: node.calibration_date || '',
    });
    setMeterFormError(null);
    setShowMeterModal(true);
  };

  const handleSubmitMeter = async (e: React.FormEvent) => {
    e.preventDefault();
    setMeterFormError(null);
    setMeterSaving(true);
    try {
      const payload = buildMeterPayload(meterForm);
      if (editingMeterId) {
        await apiClient.put(`/api/v1/meters/${editingMeterId}`, payload);
      } else {
        await apiClient.post('/api/v1/meters', payload);
      }
      setShowMeterModal(false);
      reloadSiteMeters();
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string } } };
      setMeterFormError(e2.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setMeterSaving(false); }
  };

  const handleDeleteMeter = async (node: AnnotatedMeterNode) => {
    if (!confirm(`Zähler "${node.name}" wirklich deaktivieren?`)) return;
    try { await apiClient.delete(`/api/v1/meters/${node.id}`); reloadSiteMeters(); }
    catch { /* interceptor */ }
  };

  const handlePollMeter = async (node: AnnotatedMeterNode) => {
    try {
      const res = await apiClient.post<{ success?: boolean; value?: number; message?: string }>(`/api/v1/meters/${node.id}/poll`);
      const d = res.data;
      setActionResult({
        title: `Abfrage: ${node.name}`,
        message: d.value !== undefined
          ? `Wert: ${d.value} ${node.unit}`
          : d.message || JSON.stringify(d),
      });
    } catch { setActionResult({ title: `Abfrage: ${node.name}`, message: 'Fehler beim Abfragen.' }); }
  };

  const handleTestConnection = async (node: AnnotatedMeterNode) => {
    try {
      const res = await apiClient.get<{ success: boolean; current_power_w?: number; total_energy_kwh?: number; error?: string }>(
        `/api/v1/meters/${node.id}/test-connection`
      );
      const d = res.data;
      setActionResult({
        title: `Verbindungstest: ${node.name}`,
        message: d.success
          ? `OK – Leistung: ${d.current_power_w ?? '?'} W · Zähler: ${d.total_energy_kwh?.toFixed(2) ?? '?'} kWh`
          : `Fehler: ${d.error}`,
      });
    } catch { setActionResult({ title: `Verbindungstest: ${node.name}`, message: 'Verbindung fehlgeschlagen.' }); }
  };

  // ── Standort CRUD ──

  const handleSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(null); setSaving(true);
    try {
      const data = cleanFormData(siteForm as unknown as Record<string, string>);
      if (editingId) await apiClient.put(`/api/v1/sites/${editingId}`, data);
      else await apiClient.post('/api/v1/sites', data);
      setShowSiteModal(false);
      loadSites();
      if (selectedSite && editingId === selectedSite.id) loadSiteDetail(selectedSite);
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string } } };
      setFormError(e2.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDeleteSite = async (site: Site, ev: React.MouseEvent) => {
    ev.stopPropagation();
    if (!confirm(`Standort "${site.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${site.id}`);
      loadSites();
      if (selectedSite?.id === site.id) setSelectedSite(null);
    } catch { /* Interceptor */ }
  };

  // ── Gebäude CRUD ──

  const handleSubmitBuilding = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedSite) return;
    setFormError(null); setSaving(true);
    try {
      const data = cleanFormData(buildingForm as unknown as Record<string, string>);
      if (editingId) await apiClient.put(`/api/v1/sites/${selectedSite.id}/buildings/${editingId}`, data);
      else { data.site_id = selectedSite.id; await apiClient.post(`/api/v1/sites/${selectedSite.id}/buildings`, data); }
      setShowBuildingModal(false);
      loadSiteDetail(selectedSite);
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string } } };
      setFormError(e2.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDeleteBuilding = async (b: Building) => {
    if (!selectedSite || !confirm(`Gebäude "${b.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${selectedSite.id}/buildings/${b.id}`);
      loadSiteDetail(selectedSite);
      if (selectedBuilding?.id === b.id) setSelectedBuilding(null);
    } catch { /* Interceptor */ }
  };

  // ── Nutzungseinheit CRUD ──

  const handleSubmitUnit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedSite || !selectedBuilding) return;
    setFormError(null); setSaving(true);
    try {
      const data = cleanFormData(unitForm as unknown as Record<string, string>);
      if (editingId) await apiClient.put(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units/${editingId}`, data);
      else { data.building_id = selectedBuilding.id; await apiClient.post(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units`, data); }
      setShowUnitModal(false);
      loadBuildingDetail(selectedSite.id, selectedBuilding.id);
    } catch (err: unknown) {
      const e2 = err as { response?: { data?: { detail?: string } } };
      setFormError(e2.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const handleDeleteUnit = async (u: UsageUnit) => {
    if (!selectedSite || !selectedBuilding || !confirm(`Nutzungseinheit "${u.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units/${u.id}`);
      loadBuildingDetail(selectedSite.id, selectedBuilding.id);
    } catch { /* Interceptor */ }
  };

  const totalPages = Math.ceil(total / pageSize);

  // ── Energieart-Extraktion aus annotiertem Baum ──

  function extractEnergyTypes(nodes: AnnotatedMeterNode[]): string[] {
    const types = new Set<string>();
    const visit = (n: AnnotatedMeterNode) => { types.add(n.energy_type); n.children.forEach(visit); };
    nodes.forEach(visit);
    return [...types].sort();
  }

  // ── Breadcrumb ──

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
      <button className={`hover:text-primary-600 ${!selectedSite ? 'font-semibold text-gray-900' : ''}`}
        onClick={() => { setSelectedSite(null); setSelectedBuilding(null); }}>Standorte</button>
      {selectedSite && (<>
        <span>/</span>
        <button className={`hover:text-primary-600 ${!selectedBuilding ? 'font-semibold text-gray-900' : ''}`}
          onClick={() => setSelectedBuilding(null)}>{selectedSite.name}</button>
      </>)}
      {selectedBuilding && (<><span>/</span><span className="font-semibold text-gray-900">{selectedBuilding.name}</span></>)}
    </div>
  );

  // ── Render: Standort-Liste ──

  if (!selectedSite) {
    return (
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Standorte</h1>
            <p className="mt-1 text-sm text-gray-500">{total} Standorte insgesamt</p>
          </div>
          <button onClick={() => { setEditingId(null); setSiteForm(emptySiteForm); setFormError(null); setShowSiteModal(true); }} className="btn-primary">
            + Neuer Standort
          </button>
        </div>

        <div className="card mt-4">
          <input type="text" className="input w-full" placeholder="Suche nach Name, Stadt..."
            value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
        </div>

        <div className="card mt-4 overflow-hidden p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Laden...</div>
          ) : sites.length === 0 ? (
            <div className="p-8 text-center text-gray-400">Keine Standorte gefunden.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Stadt</th>
                  <th className="px-4 py-3">PLZ</th>
                  <th className="px-4 py-3 text-center">Gebäude</th>
                  <th className="px-4 py-3 text-center">Zähler</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sites.map(site => (
                  <tr key={site.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadSiteDetail(site)}>
                    <td className="px-4 py-3 font-medium text-primary-600">{site.name}</td>
                    <td className="px-4 py-3 text-gray-500">{site.city || '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{site.zip_code || '–'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">{site.building_count}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{site.meter_count}</span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingId(site.id); setSiteForm({ name: site.name, street: site.street || '', zip_code: site.zip_code || '', city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '', longitude: site.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}
                        className="mr-2 text-primary-600 hover:text-primary-800">Bearbeiten</button>
                      <button onClick={e => handleDeleteSite(site, e)} className="text-red-500 hover:text-red-700">Löschen</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm text-gray-500">Seite {page} von {totalPages}</p>
            <div className="flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</button>
              <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Weiter</button>
            </div>
          </div>
        )}

        {showSiteModal && <SiteModal form={siteForm} setForm={setSiteForm} editingId={editingId}
          onSubmit={handleSubmitSite} onClose={() => setShowSiteModal(false)} error={formError} saving={saving} />}
      </div>
    );
  }

  // ── Render: Standort-Detail ──

  if (!selectedBuilding) {
    const energyTypes = extractEnergyTypes(siteMeters);
    const filteredTree = meterEnergyFilter ? filterTree(siteMeters, meterEnergyFilter) : siteMeters;
    const totalMeterCount = countNodes(siteMeters);
    const hasExits = siteConsumption && siteConsumption.cross_site_exit_kwh > 0;

    return (
      <div>
        {breadcrumb}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="page-title">{selectedSite.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {[selectedSite.zip_code, selectedSite.city].filter(Boolean).join(' ')}
              {selectedSite.street && ` · ${selectedSite.street}`}
            </p>
          </div>
          <button onClick={() => { setEditingId(selectedSite.id); setSiteForm({ name: selectedSite.name, street: selectedSite.street || '', zip_code: selectedSite.zip_code || '', city: selectedSite.city || '', country: selectedSite.country, latitude: selectedSite.latitude?.toString() || '', longitude: selectedSite.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}
            className="btn-secondary">Standort bearbeiten</button>
        </div>

        {/* KPI-Kacheln */}
        <div className={`grid gap-4 mb-6 ${hasExits ? 'grid-cols-2 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'}`}>
          <div className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Zähler</p>
            <p className="text-2xl font-bold text-primary-700 mt-1">{totalMeterCount || selectedSite.meter_count}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Gebäude</p>
            <p className="text-2xl font-bold text-gray-700 mt-1">{siteBuildings.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">CO₂-Region</p>
            <p className="text-lg font-semibold text-gray-700 mt-1">{selectedSite.co2_region || '–'}</p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Zeitzone</p>
            <p className="text-sm font-semibold text-gray-700 mt-1">{selectedSite.timezone}</p>
          </div>
          {hasExits && siteConsumption && (
            <div className="card p-4 border-amber-200 bg-amber-50">
              <div className="flex items-center justify-between">
                <p className="text-xs text-amber-600 uppercase tracking-wide font-medium">Nettoverbrauch</p>
                <select
                  className="text-xs text-amber-600 bg-transparent border-none cursor-pointer"
                  value={consumptionYear}
                  onChange={e => setConsumptionYear(Number(e.target.value))}
                  onClick={e => e.stopPropagation()}
                >
                  {Array.from({ length: 5 }, (_, i) => currentYear - 1 - i).map(y => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <p className="text-xl font-bold text-amber-800 mt-1">
                {Number(siteConsumption.net_consumption_kwh).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh
              </p>
              <p className="text-xs text-amber-600 mt-0.5">
                abzgl. {Number(siteConsumption.cross_site_exit_kwh).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh an andere Standorte
              </p>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-4 gap-1">
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'meters' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('meters')}
          >
            <Zap className="w-4 h-4" /> Zähler ({totalMeterCount || selectedSite.meter_count})
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'buildings' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('buildings')}
          >
            <Building2 className="w-4 h-4" /> Gebäude ({siteBuildings.length})
          </button>
        </div>

        {/* Tab: Zähler */}
        {activeTab === 'meters' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              {/* Energieart-Filter */}
              {!detailLoading && energyTypes.length > 1 && (
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => setMeterEnergyFilter('')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${meterEnergyFilter === '' ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'}`}>
                    Alle ({totalMeterCount})
                  </button>
                  {energyTypes.map(et => {
                    const count = countNodes(filterTree(siteMeters, et));
                    return (
                      <button key={et} onClick={() => setMeterEnergyFilter(et === meterEnergyFilter ? '' : et)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${meterEnergyFilter === et ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-gray-300 hover:border-primary-400 ' + (ENERGY_COLORS[et] || 'text-gray-600')}`}>
                        {ENERGY_TYPE_LABELS[et as keyof typeof ENERGY_TYPE_LABELS] || et} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
              <button onClick={openNewMeter} className="btn-primary ml-auto flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Neuer Zähler
              </button>
            </div>

            {hasExits && siteConsumption && (
              <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700">
                <strong>Subtraktionszähler vorhanden:</strong> Die amber-markierten Zähler gehören anderen Standorten und werden beim Nettoverbrauch abgezogen.
                {siteConsumption.exit_points.map(ep => (
                  <span key={ep.meter_id} className="ml-2">· {ep.meter_name} ({ep.owner_site_name}: {Number(ep.consumption_kwh).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh)</span>
                ))}
              </div>
            )}

            <div className="card overflow-hidden p-0">
              <MeterTreeTable
                nodes={filteredTree}
                loading={detailLoading}
                emptyMessage={totalMeterCount === 0 ? 'Diesem Standort sind keine aktiven Zähler zugewiesen.' : 'Keine Zähler für diese Energieart.'}
                onReload={reloadSiteMeters}
                onEdit={openEditMeter}
                onDelete={handleDeleteMeter}
                onPoll={handlePollMeter}
                onTestConnection={handleTestConnection}
              />
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Tipp: Zähler per Drag & Drop (⠿) in Eltern-Kind-Beziehungen anordnen
            </p>
          </div>
        )}

        {/* Tab: Gebäude */}
        {activeTab === 'buildings' && (
          <div>
            <div className="flex justify-end mb-3">
              <button onClick={() => { setEditingId(null); setBuildingForm(emptyBuildingForm); setFormError(null); setShowBuildingModal(true); }}
                className="btn-primary">+ Neues Gebäude</button>
            </div>
            {detailLoading ? (
              <div className="p-8 text-center text-gray-400">Laden...</div>
            ) : siteBuildings.length === 0 ? (
              <div className="card p-8 text-center text-gray-400">Keine Gebäude vorhanden.</div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {siteBuildings.map(b => (
                  <div key={b.id} className="card cursor-pointer hover:border-primary-300 transition-colors"
                    onClick={() => loadBuildingDetail(selectedSite.id, b.id)}>
                    <h3 className="font-semibold text-primary-700">{b.name}</h3>
                    <div className="mt-2 space-y-1 text-sm text-gray-500">
                      {b.building_type && <p>Typ: {BUILDING_TYPES[b.building_type] || b.building_type}</p>}
                      {b.total_area_m2 && <p>Fläche: {Number(b.total_area_m2).toLocaleString('de-DE')} m²</p>}
                      {b.building_year && <p>Baujahr: {b.building_year}</p>}
                      <p className="text-xs">{b.usage_unit_count} Nutzungseinheit(en)</p>
                    </div>
                    <div className="mt-3 flex gap-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingId(b.id); setBuildingForm({ name: b.name, building_type: b.building_type || '', building_year: b.building_year?.toString() || '', total_area_m2: b.total_area_m2?.toString() || '', heated_area_m2: b.heated_area_m2?.toString() || '', cooled_area_m2: b.cooled_area_m2?.toString() || '', floors: b.floors?.toString() || '', energy_certificate_class: b.energy_certificate_class || '' }); setFormError(null); setShowBuildingModal(true); }}
                        className="text-xs text-primary-600 hover:text-primary-800">Bearbeiten</button>
                      <button onClick={() => handleDeleteBuilding(b)} className="text-xs text-red-500 hover:text-red-700">Löschen</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {showSiteModal && <SiteModal form={siteForm} setForm={setSiteForm} editingId={editingId}
          onSubmit={handleSubmitSite} onClose={() => setShowSiteModal(false)} error={formError} saving={saving} />}

        {showBuildingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-bold">{editingId ? 'Gebäude bearbeiten' : 'Neues Gebäude'}</h2>
              <form onSubmit={handleSubmitBuilding} className="space-y-4">
                {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
                <div><label className="label">Name *</label><input type="text" className="input" value={buildingForm.name} onChange={e => setBuildingForm({ ...buildingForm, name: e.target.value })} required autoFocus /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">Gebäudetyp</label><select className="input" value={buildingForm.building_type} onChange={e => setBuildingForm({ ...buildingForm, building_type: e.target.value })}><option value="">– Wählen –</option>{Object.entries(BUILDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                  <div><label className="label">Baujahr</label><input type="number" className="input" value={buildingForm.building_year} onChange={e => setBuildingForm({ ...buildingForm, building_year: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><label className="label">Bruttofläche (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.total_area_m2} onChange={e => setBuildingForm({ ...buildingForm, total_area_m2: e.target.value })} /></div>
                  <div><label className="label">Beheizt (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.heated_area_m2} onChange={e => setBuildingForm({ ...buildingForm, heated_area_m2: e.target.value })} /></div>
                  <div><label className="label">Gekühlt (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.cooled_area_m2} onChange={e => setBuildingForm({ ...buildingForm, cooled_area_m2: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">Stockwerke</label><input type="number" className="input" value={buildingForm.floors} onChange={e => setBuildingForm({ ...buildingForm, floors: e.target.value })} /></div>
                  <div><label className="label">Energieausweis-Klasse</label><select className="input" value={buildingForm.energy_certificate_class} onChange={e => setBuildingForm({ ...buildingForm, energy_certificate_class: e.target.value })}><option value="">– Keine –</option>{['A+','A','B','C','D','E','F','G','H'].map(c => <option key={c} value={c}>{c}</option>)}</select></div>
                </div>
                <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowBuildingModal(false)} className="btn-secondary">Abbrechen</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button></div>
              </form>
            </div>
          </div>
        )}

        {showMeterModal && (
          <MeterModal
            form={meterForm} setForm={setMeterForm} editingId={editingMeterId}
            onSubmit={handleSubmitMeter} onClose={() => setShowMeterModal(false)}
            error={meterFormError} saving={meterSaving}
            siteMeters={siteMeters} siteBuildings={siteBuildings} siteUnits={allSiteUnits}
          />
        )}

        {actionResult && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
              <h2 className="mb-3 text-lg font-bold">{actionResult.title}</h2>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{actionResult.message}</p>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setActionResult(null)} className="btn-secondary">Schließen</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Gebäude-Detail ──

  return (
    <div>
      {breadcrumb}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">{selectedBuilding.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {selectedBuilding.building_type && (BUILDING_TYPES[selectedBuilding.building_type] || selectedBuilding.building_type)}
            {selectedBuilding.total_area_m2 && ` · ${Number(selectedBuilding.total_area_m2).toLocaleString('de-DE')} m²`}
            {selectedBuilding.building_year && ` · Baujahr ${selectedBuilding.building_year}`}
          </p>
        </div>
        {buildingActiveTab === 'units' && (
          <button onClick={() => { setEditingId(null); setUnitForm(emptyUnitForm); setFormError(null); setShowUnitModal(true); }}
            className="btn-primary">+ Neue Nutzungseinheit</button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4 gap-1">
        <button className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${buildingActiveTab === 'meters' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setBuildingActiveTab('meters')}>
          <Zap className="w-4 h-4" /> Zähler ({countNodes(buildingMeters)})
        </button>
        <button className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${buildingActiveTab === 'units' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setBuildingActiveTab('units')}>
          <Home className="w-4 h-4" /> Nutzungseinheiten ({selectedBuilding.usage_units.length})
        </button>
      </div>

      {buildingActiveTab === 'meters' && (
        <div className="card overflow-hidden p-0">
          <MeterTreeTable
            nodes={buildingMeters}
            emptyMessage="Diesem Gebäude sind keine Zähler zugewiesen."
            onReload={reloadBuildingMeters}
            onEdit={openEditMeter}
            onDelete={handleDeleteMeter}
            onPoll={handlePollMeter}
            onTestConnection={handleTestConnection}
          />
        </div>
      )}

      {buildingActiveTab === 'units' && (
        <div className="card overflow-hidden p-0">
          {selectedBuilding.usage_units.length === 0 ? (
            <div className="p-8 text-center text-gray-400"><Home className="w-8 h-8 mx-auto mb-2 opacity-30" />Keine Nutzungseinheiten vorhanden.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th><th className="px-4 py-3">Nutzungsart</th><th className="px-4 py-3">Etage</th>
                  <th className="px-4 py-3 text-right">Fläche (m²)</th><th className="px-4 py-3 text-right">Personen</th>
                  <th className="px-4 py-3">Mieter</th><th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {selectedBuilding.usage_units.map(u => (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3"><span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">{USAGE_TYPES[u.usage_type] || u.usage_type}</span></td>
                    <td className="px-4 py-3 text-gray-500">{u.floor || '–'}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{u.area_m2 ? Number(u.area_m2).toLocaleString('de-DE') : '–'}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{u.occupants ?? '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{u.tenant_name || '–'}</td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => { setEditingId(u.id); setUnitForm({ name: u.name, usage_type: u.usage_type, floor: u.floor || '', area_m2: u.area_m2?.toString() || '', occupants: u.occupants?.toString() || '', tenant_name: u.tenant_name || '' }); setFormError(null); setShowUnitModal(true); }}
                        className="mr-2 text-primary-600 hover:text-primary-800">Bearbeiten</button>
                      <button onClick={() => handleDeleteUnit(u)} className="text-red-500 hover:text-red-700">Löschen</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {showUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'Nutzungseinheit bearbeiten' : 'Neue Nutzungseinheit'}</h2>
            <form onSubmit={handleSubmitUnit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Name *</label><input type="text" className="input" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} required autoFocus /></div>
                <div><label className="label">Nutzungsart *</label><select className="input" value={unitForm.usage_type} onChange={e => setUnitForm({ ...unitForm, usage_type: e.target.value })}>{Object.entries(USAGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Etage</label><input type="text" className="input" value={unitForm.floor} onChange={e => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="z.B. EG, 1. OG" /></div>
                <div><label className="label">Fläche (m²)</label><input type="number" step="0.01" className="input" value={unitForm.area_m2} onChange={e => setUnitForm({ ...unitForm, area_m2: e.target.value })} /></div>
                <div><label className="label">Personen</label><input type="number" className="input" value={unitForm.occupants} onChange={e => setUnitForm({ ...unitForm, occupants: e.target.value })} /></div>
              </div>
              <div><label className="label">Mieter</label><input type="text" className="input" value={unitForm.tenant_name} onChange={e => setUnitForm({ ...unitForm, tenant_name: e.target.value })} /></div>
              <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={() => setShowUnitModal(false)} className="btn-secondary">Abbrechen</button><button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button></div>
            </form>
          </div>
        </div>
      )}

      {showMeterModal && (
        <MeterModal
          form={meterForm} setForm={setMeterForm} editingId={editingMeterId}
          onSubmit={handleSubmitMeter} onClose={() => setShowMeterModal(false)}
          error={meterFormError} saving={meterSaving}
          siteMeters={siteMeters} siteBuildings={siteBuildings} siteUnits={allSiteUnits}
        />
      )}

      {actionResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-3 text-lg font-bold">{actionResult.title}</h2>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{actionResult.message}</p>
            <div className="mt-4 flex justify-end"><button onClick={() => setActionResult(null)} className="btn-secondary">Schließen</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Standort-Modal ──

function SiteModal({ form, setForm, editingId, onSubmit, onClose, error, saving }: {
  form: SiteForm; setForm: (f: SiteForm) => void; editingId: string | null;
  onSubmit: (e: React.FormEvent) => void; onClose: () => void;
  error: string | null; saving: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">{editingId ? 'Standort bearbeiten' : 'Neuer Standort'}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div><label className="label">Name *</label><input type="text" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus /></div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><label className="label">Straße</label><input type="text" className="input" value={form.street} onChange={e => setForm({ ...form, street: e.target.value })} /></div>
            <div><label className="label">Land</label><input type="text" className="input" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">PLZ</label><input type="text" className="input" value={form.zip_code} onChange={e => setForm({ ...form, zip_code: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Stadt</label><input type="text" className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Breitengrad</label><input type="number" step="any" className="input" value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="53.5511" /></div>
            <div><label className="label">Längengrad</label><input type="number" step="any" className="input" value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="9.9937" /></div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

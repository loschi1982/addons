import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Network, GripVertical, ChevronDown, ChevronRight, ChevronUp, ArrowUpDown, Filter } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type EnergyType } from '@/types';
import { useSiteHierarchy } from '@/hooks/useSiteHierarchy';
import DiscoveryModal from '@/components/DiscoveryModal';

// ── Typen ──

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  unit: string;
  data_source: string;
  location: string | null;
  site_id: string | null;
  site_name: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  parent_meter_id: string | null;
  is_active: boolean;
  is_virtual: boolean;
  is_feed_in: boolean;
  is_delivery_based: boolean;
  is_weather_corrected: boolean;
  source_config: Record<string, unknown> | null;
  virtual_config: Record<string, unknown> | null;
  created_at: string;
}

interface MeterForm {
  name: string;
  meter_number: string;
  energy_type: string;
  unit: string;
  data_source: string;
  location: string;
  is_virtual: boolean;
  is_feed_in: boolean;
  is_delivery_based: boolean;
  is_weather_corrected: boolean;
  source_config_ip: string;
  source_config_channel: string;
  source_config_mode: string;
  source_config_register: string;
  source_config_entity_id: string;
  source_config_mqtt_topic: string;
  source_config_mqtt_broker: string;
  source_config_bacnet_device: string;
  source_config_bacnet_object_type: string;
  source_config_bacnet_object_instance: string;
  parent_meter_id: string;
  virtual_type: string;
  virtual_source_meter_id: string;
  virtual_subtract_meter_ids: string[];
  virtual_sum_meter_ids: string[];
}

const emptyForm: MeterForm = {
  name: '',
  meter_number: '',
  energy_type: 'electricity',
  unit: 'kWh',
  data_source: 'manual',
  location: '',
  is_virtual: false,
  is_feed_in: false,
  is_delivery_based: false,
  is_weather_corrected: false,
  parent_meter_id: '',
  source_config_ip: '',
  source_config_channel: '0',
  source_config_mode: 'single',
  source_config_register: '',
  source_config_entity_id: '',
  source_config_mqtt_topic: '',
  source_config_mqtt_broker: '',
  source_config_bacnet_device: '',
  source_config_bacnet_object_type: 'analogInput',
  source_config_bacnet_object_instance: '0',
  virtual_type: 'difference',
  virtual_source_meter_id: '',
  virtual_subtract_meter_ids: [],
  virtual_sum_meter_ids: [],
};

const DATA_SOURCES: Record<string, string> = {
  manual: 'Manuell',
  shelly: 'Shelly',
  modbus: 'Modbus',
  knx: 'KNX',
  homeassistant: 'Home Assistant',
  mqtt: 'MQTT',
  bacnet: 'BACnet',
  virtual: 'Virtuell (berechnet)',
};

// ── Hauptkomponente ──

export default function MetersPage() {
  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  const [loading, setLoading] = useState(true);

  const [showDiscovery, setShowDiscovery] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMeter, setEditingMeter] = useState<Meter | null>(null);
  const [form, setForm] = useState<MeterForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadMeters = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<{ items: Meter[]; total: number }>('/api/v1/meters/tree');
      setAllMeters(res.data.items);
    } catch { /* interceptor */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadMeters(); }, [loadMeters]);

  const handleCreate = () => {
    setEditingId(null);
    setEditingMeter(null);
    setForm(emptyForm);
    setFormError(null);
    setShowModal(true);
  };

  const handleEdit = (meter: Meter) => {
    setEditingId(meter.id);
    setEditingMeter(meter);
    const cfg = meter.source_config || {};
    const vcfg = meter.virtual_config || {};
    setForm({
      name: meter.name,
      meter_number: meter.meter_number || '',
      energy_type: meter.energy_type,
      unit: meter.unit,
      data_source: meter.is_virtual ? 'virtual' : meter.data_source,
      location: meter.location || '',
      is_virtual: meter.is_virtual,
      is_feed_in: meter.is_feed_in,
      is_delivery_based: meter.is_delivery_based,
      is_weather_corrected: meter.is_weather_corrected,
      parent_meter_id: meter.parent_meter_id || '',
      source_config_ip: (cfg.ip as string) || '',
      source_config_channel: (cfg.channel?.toString()) || '0',
      source_config_mode: (cfg.mode as string) || 'single',
      source_config_register: (cfg.register?.toString()) || '',
      source_config_entity_id: (cfg.entity_id as string) || '',
      source_config_mqtt_topic: (cfg.topic as string) || '',
      source_config_mqtt_broker: (cfg.broker_host as string) || '',
      source_config_bacnet_device: (cfg.device_address as string) || '',
      source_config_bacnet_object_type: (cfg.object_type as string) || 'analogInput',
      source_config_bacnet_object_instance: (cfg.object_instance?.toString()) || '0',
      virtual_type: (vcfg.type as string) || 'difference',
      virtual_source_meter_id: (vcfg.source_meter_id as string) || '',
      virtual_subtract_meter_ids: (vcfg.subtract_meter_ids as string[]) || [],
      virtual_sum_meter_ids: ((vcfg.source_meter_ids ?? vcfg.parallel_meter_ids) as string[]) || [],
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleDelete = async (meter: Meter) => {
    if (!confirm(`Zähler "${meter.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/meters/${meter.id}`);
      loadMeters();
    } catch { /* interceptor */ }
  };

  const handleSubmit = async (e: React.FormEvent, hierarchy: { siteId: string; buildingId: string; unitId: string }) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    const isVirtual = form.data_source === 'virtual';
    const actualDataSource = isVirtual ? 'manual' : form.data_source;

    const source_config: Record<string, unknown> = {};
    if (form.data_source === 'shelly') {
      if (form.source_config_ip) source_config.ip = form.source_config_ip;
      source_config.mode = form.source_config_mode;
      if (form.source_config_mode === 'balanced') {
        source_config.channels = [0, 1, 2];
      } else {
        source_config.channel = parseInt(form.source_config_channel) || 0;
      }
    } else if (form.data_source === 'modbus') {
      if (form.source_config_ip) source_config.ip = form.source_config_ip;
      if (form.source_config_register) source_config.register = parseInt(form.source_config_register);
    } else if (form.data_source === 'homeassistant') {
      if (form.source_config_entity_id) source_config.entity_id = form.source_config_entity_id;
    } else if (form.data_source === 'mqtt') {
      if (form.source_config_mqtt_broker) source_config.broker_host = form.source_config_mqtt_broker;
      if (form.source_config_mqtt_topic) source_config.topic = form.source_config_mqtt_topic;
    } else if (form.data_source === 'bacnet') {
      if (form.source_config_bacnet_device) source_config.device_address = form.source_config_bacnet_device;
      source_config.object_type = form.source_config_bacnet_object_type;
      source_config.object_instance = parseInt(form.source_config_bacnet_object_instance) || 0;
    }

    let virtual_config: Record<string, unknown> | null = null;
    if (isVirtual) {
      if (form.virtual_type === 'difference') {
        virtual_config = {
          type: 'difference',
          source_meter_id: form.virtual_source_meter_id || null,
          subtract_meter_ids: form.virtual_subtract_meter_ids.filter(Boolean),
        };
      } else if (form.virtual_type === 'sum') {
        virtual_config = { type: 'sum', source_meter_ids: form.virtual_sum_meter_ids.filter(Boolean) };
      } else if (form.virtual_type === 'parallel') {
        virtual_config = { type: 'parallel', parallel_meter_ids: form.virtual_sum_meter_ids.filter(Boolean) };
      }
    }

    const payload: Record<string, unknown> = {
      name: form.name,
      meter_number: form.meter_number || null,
      energy_type: form.energy_type,
      unit: form.unit,
      data_source: actualDataSource,
      location: form.location || null,
      is_virtual: isVirtual,
      is_feed_in: form.is_feed_in,
      is_delivery_based: form.is_delivery_based,
      is_weather_corrected: form.is_weather_corrected,
      parent_meter_id: form.parent_meter_id || null,
      site_id: hierarchy.siteId || null,
      building_id: hierarchy.buildingId || null,
      usage_unit_id: hierarchy.unitId || null,
      source_config: Object.keys(source_config).length > 0 ? source_config : null,
      virtual_config,
    };

    try {
      if (editingId) {
        await apiClient.put(`/api/v1/meters/${editingId}`, payload);
      } else {
        await apiClient.post('/api/v1/meters', payload);
      }
      setShowModal(false);
      loadMeters();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  };

  const handlePoll = async (meter: Meter) => {
    try {
      const res = await apiClient.post(`/api/v1/meters/${meter.id}/poll`);
      const data = res.data;
      if (data.success) {
        if (data.skipped) {
          alert(`${meter.name}: Wert unverändert (${data.reason})`);
        } else {
          alert(`${meter.name}: Wert ${data.value} erfasst` + (data.consumption != null ? ` (Verbrauch: ${data.consumption})` : ''));
        }
      } else {
        alert(`${meter.name}: Fehler – ${data.error}`);
      }
    } catch {
      alert(`Polling fehlgeschlagen für ${meter.name}`);
    }
  };

  const handleTestConnection = async (meter: Meter) => {
    try {
      const res = await apiClient.get(`/api/v1/meters/${meter.id}/test-connection`);
      const data = res.data;
      if (data.success) {
        alert(
          `Verbindung OK!\n` +
          `Gerät: ${data.device?.model || 'unbekannt'} (Gen${data.device?.gen})\n` +
          `Modus: ${data.mode}\n` +
          `Aktuelle Leistung: ${data.current_power_w} W\n` +
          `Gesamtenergie: ${data.total_energy_kwh?.toFixed(2)} kWh`
        );
      } else {
        alert(`Verbindung fehlgeschlagen: ${data.error}`);
      }
    } catch {
      alert(`Verbindungstest fehlgeschlagen für ${meter.name}`);
    }
  };

  const handlePollAll = async () => {
    try {
      const res = await apiClient.post('/api/v1/meters/poll-all');
      const data = res.data;
      alert(`Polling abgeschlossen: ${data.success}/${data.polled} erfolgreich, ${data.errors} Fehler`);
    } catch {
      alert('Polling aller Zähler fehlgeschlagen');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Zähler</h1>
          <p className="mt-1 text-sm text-gray-500">{allMeters.length} Zähler insgesamt</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/meter-map"
            className="flex items-center gap-1 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded border border-gray-300 transition-colors"
            title="Baumansicht"
          >
            <Network className="h-4 w-4" />
            <span className="hidden sm:inline">Karte</span>
          </Link>
          <button onClick={handlePollAll} className="btn-secondary">Alle abfragen</button>
          <button onClick={() => setShowDiscovery(true)} className="btn-secondary">Geräte entdecken</button>
          <button onClick={handleCreate} className="btn-primary">+ Neuer Zähler</button>
        </div>
      </div>

      <MeterNetworkView
        meters={allMeters}
        loading={loading}
        onReload={loadMeters}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onPoll={handlePoll}
        onTestConnection={handleTestConnection}
      />

      {showDiscovery && (
        <DiscoveryModal
          mode="meter"
          onClose={() => setShowDiscovery(false)}
          onCreated={loadMeters}
        />
      )}

      {showModal && (
        <MeterModal
          editingId={editingId}
          editingMeter={editingMeter}
          form={form}
          setForm={setForm}
          formError={formError}
          saving={saving}
          onSubmit={handleSubmit}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── Netzwerk-Baum mit sortierbaren / filterbaren Spalten ────────────────────

interface NetworkNode extends Meter {
  children: NetworkNode[];
}

function buildTree(meters: Meter[]): NetworkNode[] {
  const byId: Record<string, NetworkNode> = {};
  meters.forEach(m => { byId[m.id] = { ...m, children: [] }; });
  const roots: NetworkNode[] = [];
  meters.forEach(m => {
    if (m.parent_meter_id && byId[m.parent_meter_id]) {
      byId[m.parent_meter_id].children.push(byId[m.id]);
    } else {
      roots.push(byId[m.id]);
    }
  });
  return roots;
}

type SortCol = 'name' | 'meter_number' | 'energy_type' | 'site' | 'data_source';
type SortDir = 'asc' | 'desc';
type FilterValue = { text?: string; values?: Set<string> };

function getSortValue(m: Meter, col: SortCol): string {
  switch (col) {
    case 'name': return m.name.toLowerCase();
    case 'meter_number': return (m.meter_number || '').toLowerCase();
    case 'energy_type': return m.energy_type;
    case 'site': return (m.site_name || m.location || '').toLowerCase();
    case 'data_source': return m.is_virtual ? 'virtual' : m.data_source;
  }
}

function matchesMeter(m: Meter, filters: Record<string, FilterValue>): boolean {
  const f = filters;
  if (f.name?.text && !m.name.toLowerCase().includes(f.name.text.toLowerCase())) return false;
  if (f.meter_number?.text && !(m.meter_number || '').toLowerCase().includes(f.meter_number.text.toLowerCase())) return false;
  if (f.energy_type?.values?.size && !f.energy_type.values.has(m.energy_type)) return false;
  if (f.site?.text) {
    const site = (m.site_name || m.location || '').toLowerCase();
    if (!site.includes(f.site.text.toLowerCase())) return false;
  }
  if (f.data_source?.values?.size) {
    const src = m.is_virtual ? 'virtual' : m.data_source;
    if (!f.data_source.values.has(src)) return false;
  }
  return true;
}

function MeterNetworkView({
  meters, loading, onReload, onEdit, onDelete, onPoll, onTestConnection,
}: {
  meters: Meter[];
  loading: boolean;
  onReload: () => void;
  onEdit: (m: Meter) => void;
  onDelete: (m: Meter) => void;
  onPoll: (m: Meter) => void;
  onTestConnection: (m: Meter) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [dropOverRoot, setDropOverRoot] = useState(false);
  const [treeKey, setTreeKey] = useState(0); // erzwingt Baum-Neuaufbau nach Drop

  const [sortCol, setSortCol] = useState<SortCol | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filters, setFilters] = useState<Record<string, FilterValue>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);

  const isFiltered = useMemo(
    () => Object.values(filters).some(f => f.text || (f.values && f.values.size > 0)),
    [filters]
  );

  // Sortierung auf Flat-Liste anwenden, dann Baum bauen
  const sortedMeters = useMemo(() => {
    if (!sortCol) return meters;
    return [...meters].sort((a, b) => {
      const va = getSortValue(a, sortCol);
      const vb = getSortValue(b, sortCol);
      const cmp = va.localeCompare(vb, 'de');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [meters, sortCol, sortDir]);

  // Baum rekursiv filtern: Knoten behalten wenn er selbst oder ein Nachfahre passt
  const filterTree = useCallback((nodes: NetworkNode[]): NetworkNode[] => {
    return nodes.flatMap(node => {
      const filteredChildren = filterTree(node.children);
      const selfMatches = matchesMeter(node, filters);
      if (selfMatches || filteredChildren.length > 0) {
        return [{ ...node, children: filteredChildren }];
      }
      return [];
    });
  }, [filters]);

  const tree = useMemo(() => {
    const full = buildTree(sortedMeters);
    return isFiltered ? filterTree(full) : full;
  }, [sortedMeters, isFiltered, filterTree]);

  const processedMeters = sortedMeters; // für uniqueEnergyTypes/uniqueDataSources

  const handleSortClick = (col: SortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  const setFilterText = (col: string, text: string) => {
    setFilters(prev => ({ ...prev, [col]: { ...prev[col], text } }));
  };

  const toggleFilterValue = (col: string, val: string, checked: boolean) => {
    setFilters(prev => {
      const existing = new Set(prev[col]?.values || []);
      if (checked) existing.add(val); else existing.delete(val);
      return { ...prev, [col]: { ...prev[col], values: existing } };
    });
  };

  const clearFilter = (col: string) => {
    setFilters(prev => { const next = { ...prev }; delete next[col]; return next; });
  };

  const hasFilter = (col: string) => {
    const f = filters[col];
    return !!(f?.text || (f?.values && f.values.size > 0));
  };

  const applyParentChange = async (sourceId: string, targetId: string | null) => {
    if (!sourceId) return;
    if (targetId && sourceId === targetId) return;
    try {
      await apiClient.patch(`/api/v1/meters/${sourceId}/parent`, { parent_meter_id: targetId });
      setTreeKey(k => k + 1);
      onReload();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string }; status?: number } };
      alert(`Fehler: ${e?.response?.data?.detail || e?.response?.status || 'Unbekannt'}`);
    } finally { setDraggingId(null); setDragOverId(null); }
  };

  const handleDrop = (sourceId: string, targetId: string) => { applyParentChange(sourceId, targetId); };

  const handleDropToRoot = (e: React.DragEvent) => {
    setDropOverRoot(false);
    const sourceId = e.dataTransfer.getData('text/plain');
    applyParentChange(sourceId, null);
  };

  const dnd = { draggingId, dragOverId, setDraggingId, setDragOverId, onDrop: handleDrop };

  // Eindeutige Werte für Enum-Filter
  const uniqueEnergyTypes = useMemo(() => [...new Set(meters.map(m => m.energy_type))].sort(), [meters]);
  const uniqueDataSources = useMemo(() => [...new Set(meters.map(m => m.is_virtual ? 'virtual' : m.data_source))].sort(), [meters]);

  function ColHeader({ col, label, type }: { col: SortCol; label: string; type: 'text' | 'enum' }) {
    const isOpen = openFilterCol === col;
    const active = hasFilter(col);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!isOpen) return;
      const handler = (e: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
          setOpenFilterCol(null);
        }
      };
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    const enumValues = col === 'energy_type' ? uniqueEnergyTypes : uniqueDataSources;
    const getEnumLabel = (val: string) => col === 'energy_type'
      ? (ENERGY_TYPE_LABELS[val as EnergyType] || val)
      : (DATA_SOURCES[val] || val);

    return (
      <div className="flex items-center gap-1 min-w-0 relative" ref={dropdownRef}>
        <button
          className="flex items-center gap-1 flex-1 min-w-0 group"
          onClick={() => handleSortClick(col)}
          title="Sortieren"
        >
          <span className="truncate">{label}</span>
          {sortCol === col
            ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 flex-shrink-0 text-primary-600" /> : <ChevronDown className="w-3 h-3 flex-shrink-0 text-primary-600" />)
            : <ArrowUpDown className="w-3 h-3 flex-shrink-0 text-gray-300 group-hover:text-gray-500" />
          }
        </button>
        <button
          className={`flex-shrink-0 p-0.5 rounded hover:bg-gray-200 transition-colors ${active ? 'text-primary-600' : 'text-gray-300 hover:text-gray-600'}`}
          onClick={(e) => { e.stopPropagation(); setOpenFilterCol(isOpen ? null : col); }}
          title="Filtern"
        >
          <Filter className="w-3 h-3" />
        </button>

        {isOpen && (
          <div className="absolute z-30 top-full left-0 mt-1 min-w-[200px] bg-white border border-gray-200 rounded-lg shadow-lg p-3">
            {type === 'text' ? (
              <input
                autoFocus
                type="text"
                className="input text-xs w-full"
                placeholder="Filtern..."
                value={filters[col]?.text || ''}
                onChange={e => setFilterText(col, e.target.value)}
              />
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {enumValues.map(val => (
                  <label key={val} className="flex items-center gap-2 cursor-pointer py-0.5">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={filters[col]?.values?.has(val) ?? false}
                      onChange={e => toggleFilterValue(col, val, e.target.checked)}
                    />
                    <span className="text-xs">{getEnumLabel(val)}</span>
                  </label>
                ))}
              </div>
            )}
            {active && (
              <button
                className="mt-2 text-xs text-gray-400 hover:text-gray-700 w-full text-left"
                onClick={() => clearFilter(col)}
              >
                Filter löschen
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <div className="mt-4 p-8 text-center text-gray-400">Laden...</div>;

  return (
    <div className="mt-4">
      {isFiltered && (
        <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
          <button
            className="text-xs text-primary-600 hover:text-primary-800 underline"
            onClick={() => setFilters({})}
          >
            Alle Filter löschen
          </button>
        </div>
      )}

      {/* Drop-Zone: Elternzuordnung entfernen */}
      <div
        onDragOver={e => { e.preventDefault(); setDropOverRoot(true); }}
        onDragLeave={() => setDropOverRoot(false)}
        onDrop={e => { e.preventDefault(); handleDropToRoot(e); }}
        style={{ visibility: draggingId ? 'visible' : 'hidden' }}
        className={`mb-2 flex items-center justify-center rounded-lg border-2 border-dashed py-2 text-sm transition-colors ${dropOverRoot ? 'border-orange-400 bg-orange-50 text-orange-700' : 'border-gray-300 text-gray-400'}`}
      >
        Hier ablegen → Hauptzähler (keine Elternzuordnung)
      </div>

      <div className="card overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50 text-xs text-gray-500">
            <tr>
              <th className="px-3 py-2 text-left font-medium uppercase tracking-wide w-[35%]">
                <ColHeader col="name" label="Zähler" type="text" />
              </th>
              <th className="px-3 py-2 text-left font-medium uppercase tracking-wide w-[12%]">
                <ColHeader col="meter_number" label="Nummer" type="text" />
              </th>
              <th className="px-3 py-2 text-left font-medium uppercase tracking-wide w-[14%]">
                <ColHeader col="energy_type" label="Energieart" type="enum" />
              </th>
              <th className="px-3 py-2 text-left font-medium uppercase tracking-wide w-[16%]">
                <ColHeader col="site" label="Standort" type="text" />
              </th>
              <th className="px-3 py-2 text-left font-medium uppercase tracking-wide w-[13%]">
                <ColHeader col="data_source" label="Quelle" type="enum" />
              </th>
              <th className="px-3 py-2 text-right font-medium uppercase tracking-wide">Aktionen</th>
            </tr>
          </thead>
          <tbody key={treeKey} className="divide-y divide-gray-100">
            {tree.map(node => (
              <NetworkRow
                key={node.id}
                node={node}
                depth={0}
                dnd={dnd}
                onEdit={onEdit}
                onDelete={onDelete}
                onPoll={onPoll}
                onTestConnection={onTestConnection}
              />
            ))}
          </tbody>
        </table>
        {processedMeters.length === 0 && (
          <div className="p-8 text-center text-gray-400">
            {isFiltered ? 'Keine Zähler entsprechen den Filterkriterien.' : 'Keine aktiven Zähler vorhanden.'}
          </div>
        )}
      </div>

      {!isFiltered && (
        <p className="mt-2 text-xs text-gray-400">
          Zähler per Drag &amp; Drop in die Hierarchie ziehen. Einrückung = Unterzähler.
        </p>
      )}
    </div>
  );
}

// ── Zeile im Baum (mit DnD) ────────────────────────────────────────────────

function NetworkRow({
  node, depth, dnd, onEdit, onDelete, onPoll, onTestConnection,
}: {
  node: NetworkNode;
  depth: number;
  dnd: DndProps;
  onEdit: (m: Meter) => void;
  onDelete: (m: Meter) => void;
  onPoll: (m: Meter) => void;
  onTestConnection: (m: Meter) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isDragging = dnd.draggingId === node.id;
  const isDragOver = dnd.dragOverId === node.id;

  const rowDnd = {
    draggable: true as const,
    onDragStart: (e: React.DragEvent) => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', node.id); dnd.setDraggingId(node.id); },
    onDragEnd: () => { dnd.setDraggingId(null); dnd.setDragOverId(null); },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; dnd.setDragOverId(node.id); },
    onDragLeave: (e: React.DragEvent) => { e.stopPropagation(); dnd.setDragOverId(null); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); const src = e.dataTransfer.getData('text/plain'); if (src && src !== node.id) dnd.onDrop(src, node.id); dnd.setDragOverId(null); },
  };

  return (
    <>
      <tr
        {...rowDnd}
        className={`group select-none transition-colors ${isDragging ? 'opacity-40' : ''} ${isDragOver ? 'bg-primary-50 outline outline-2 outline-primary-400' : 'hover:bg-gray-50'}`}
      >
        <td className="px-3 py-2">
          <div className="flex items-center min-w-0" style={{ paddingLeft: `${depth * 20}px` }}>
            <GripVertical className="w-3 h-3 text-gray-300 mr-1 flex-shrink-0 cursor-grab active:cursor-grabbing" />
            {node.children.length > 0
              ? <button onClick={() => setOpen(!open)} className="mr-1 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                </button>
              : <span className="mr-4 w-3 flex-shrink-0" />
            }
            <span className="truncate font-medium text-sm text-gray-900">{node.name}</span>
            {node.is_virtual && <span className="ml-1.5 rounded bg-purple-100 px-1.5 py-0.5 text-xs text-purple-700">V</span>}
            {node.is_feed_in && <span className="ml-1 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-700">PV</span>}
          </div>
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">{node.meter_number || '–'}</td>
        <td className="px-3 py-2">
          <span className="inline-flex rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
            {ENERGY_TYPE_LABELS[node.energy_type as EnergyType] || node.energy_type}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-gray-500">{node.site_name || node.location || '–'}</td>
        <td className="px-3 py-2 text-xs text-gray-500">
          {node.is_virtual
            ? (node.virtual_config?.type === 'parallel' ? 'Doppelzähler' : 'Virtuell')
            : (DATA_SOURCES[node.data_source] || node.data_source)}
          {node.is_feed_in && <span className="ml-1 inline-flex rounded-full bg-green-50 px-1.5 py-0.5 text-xs text-green-700">PV</span>}
        </td>
        <td className="px-3 py-2 text-right space-x-2 text-xs">
          {node.data_source !== 'manual' && !node.is_virtual && (
            <>
              <button onClick={() => onTestConnection(node)} className="text-gray-500 hover:text-gray-700">Test</button>
              <button onClick={() => onPoll(node)} className="text-green-600 hover:text-green-800">Abfragen</button>
            </>
          )}
          <button onClick={() => onEdit(node)} className="text-primary-600 hover:text-primary-800">Bearbeiten</button>
          <button onClick={() => onDelete(node)} className="text-red-500 hover:text-red-700">Löschen</button>
        </td>
      </tr>
      {open && node.children.map(child => (
        <NetworkRow
          key={child.id}
          node={child}
          depth={depth + 1}
          dnd={dnd}
          onEdit={onEdit}
          onDelete={onDelete}
          onPoll={onPoll}
          onTestConnection={onTestConnection}
        />
      ))}
    </>
  );
}

type DndProps = { draggingId: string | null; dragOverId: string | null; setDraggingId: (id: string | null) => void; setDragOverId: (id: string | null) => void; onDrop: (sourceId: string, targetId: string) => void };

/* ── Zähler-Modal mit Standort-Kaskade + Datenquellen-Konfig ── */

function MeterModal({
  editingId,
  editingMeter,
  form,
  setForm,
  formError,
  saving,
  onSubmit,
  onClose,
}: {
  editingId: string | null;
  editingMeter: Meter | null;
  form: MeterForm;
  setForm: (f: MeterForm) => void;
  formError: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent, hierarchy: { siteId: string; buildingId: string; unitId: string }) => void;
  onClose: () => void;
}) {
  const hierarchy = useSiteHierarchy(editingMeter ? {
    siteId: editingMeter.site_id,
    buildingId: editingMeter.building_id,
    unitId: editingMeter.usage_unit_id,
  } : undefined);

  const [allMeters, setAllMeters] = useState<Meter[]>([]);
  useEffect(() => {
    apiClient.get('/api/v1/meters?page_size=100&is_active=true')
      .then((res) => setAllMeters((res.data.items || []).filter((m: Meter) => m.id !== editingId)))
      .catch(() => {});
  }, [editingId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-bold">
          {editingId ? 'Zähler bearbeiten' : 'Neuer Zähler'}
        </h2>

        <form onSubmit={(e) => onSubmit(e, { siteId: hierarchy.selectedSiteId, buildingId: hierarchy.selectedBuildingId, unitId: hierarchy.selectedUnitId })} className="space-y-4">
          {formError && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {formError}
            </div>
          )}

          <div>
            <label className="label">Name *</label>
            <input
              type="text"
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Zählernummer</label>
              <input
                type="text"
                className="input"
                value={form.meter_number}
                onChange={(e) => setForm({ ...form, meter_number: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Standort (Freitext)</label>
              <input
                type="text"
                className="input"
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                placeholder="z.B. Keller, Technikraum"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Energieart *</label>
              <select
                className="input"
                value={form.energy_type}
                onChange={(e) => setForm({ ...form, energy_type: e.target.value })}
              >
                {Object.entries(ENERGY_TYPE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Einheit</label>
              <select
                className="input"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                <option value="kWh">kWh</option>
                <option value="MWh">MWh</option>
                <option value="m³">m³</option>
                <option value="l">Liter</option>
                <option value="kg">kg</option>
              </select>
            </div>
            <div>
              <label className="label">Datenquelle</label>
              <select
                className="input"
                value={form.data_source}
                onChange={(e) => setForm({ ...form, data_source: e.target.value })}
              >
                {Object.entries(DATA_SOURCES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Datenquellen-Konfiguration */}
          {form.data_source === 'shelly' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Shelly-Konfiguration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">IP-Adresse *</label>
                  <input type="text" className="input" value={form.source_config_ip}
                    onChange={(e) => setForm({ ...form, source_config_ip: e.target.value })}
                    placeholder="192.168.1.42" />
                </div>
                <div>
                  <label className="label">Messmodus</label>
                  <select className="input" value={form.source_config_mode}
                    onChange={(e) => setForm({ ...form, source_config_mode: e.target.value })}>
                    <option value="single">Einzelkanal</option>
                    <option value="balanced">Saldierend (3 Phasen)</option>
                  </select>
                </div>
              </div>
              {form.source_config_mode === 'single' && (
                <div className="mt-3">
                  <label className="label">Kanal</label>
                  <input type="number" className="input w-24" min={0} max={3}
                    value={form.source_config_channel}
                    onChange={(e) => setForm({ ...form, source_config_channel: e.target.value })} />
                </div>
              )}
              {form.source_config_mode === 'balanced' && (
                <p className="mt-3 text-xs text-gray-500">Summiert Kanal 0 + 1 + 2.</p>
              )}
            </div>
          )}

          {form.data_source === 'modbus' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Modbus-Konfiguration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">IP-Adresse *</label>
                  <input type="text" className="input" value={form.source_config_ip}
                    onChange={(e) => setForm({ ...form, source_config_ip: e.target.value })}
                    placeholder="192.168.1.100" />
                </div>
                <div>
                  <label className="label">Register</label>
                  <input type="number" className="input" value={form.source_config_register}
                    onChange={(e) => setForm({ ...form, source_config_register: e.target.value })}
                    placeholder="0" />
                </div>
              </div>
            </div>
          )}

          {form.data_source === 'homeassistant' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Home Assistant-Konfiguration</p>
              <div>
                <label className="label">Entity-ID *</label>
                <input type="text" className="input" value={form.source_config_entity_id}
                  onChange={(e) => setForm({ ...form, source_config_entity_id: e.target.value })}
                  placeholder="sensor.stromzaehler_total" />
              </div>
            </div>
          )}

          {form.data_source === 'mqtt' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">MQTT-Konfiguration</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Broker-Host</label>
                  <input type="text" className="input" value={form.source_config_mqtt_broker}
                    onChange={(e) => setForm({ ...form, source_config_mqtt_broker: e.target.value })}
                    placeholder="z.B. 192.168.1.10" />
                  <p className="text-xs text-gray-500 mt-1">Leer = globale MQTT-Einstellung</p>
                </div>
                <div>
                  <label className="label">Topic *</label>
                  <input type="text" className="input" value={form.source_config_mqtt_topic}
                    onChange={(e) => setForm({ ...form, source_config_mqtt_topic: e.target.value })}
                    placeholder="z.B. tasmota/sensor/energy/state" />
                </div>
              </div>
            </div>
          )}

          {form.data_source === 'bacnet' && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">BACnet-Konfiguration</p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Geräte-Adresse *</label>
                  <input type="text" className="input" value={form.source_config_bacnet_device}
                    onChange={(e) => setForm({ ...form, source_config_bacnet_device: e.target.value })}
                    placeholder="192.168.1.50" />
                </div>
                <div>
                  <label className="label">Objekttyp</label>
                  <select className="input" value={form.source_config_bacnet_object_type}
                    onChange={(e) => setForm({ ...form, source_config_bacnet_object_type: e.target.value })}>
                    <option value="analogInput">Analog Input</option>
                    <option value="analogValue">Analog Value</option>
                    <option value="multiStateInput">Multi-State Input</option>
                  </select>
                </div>
                <div>
                  <label className="label">Object Instance</label>
                  <input type="number" className="input" value={form.source_config_bacnet_object_instance}
                    onChange={(e) => setForm({ ...form, source_config_bacnet_object_instance: e.target.value })}
                    placeholder="0" />
                </div>
              </div>
            </div>
          )}

          {/* Virtueller Zähler */}
          {form.data_source === 'virtual' && (
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4">
              <p className="text-sm font-medium text-indigo-700 mb-3">Berechnungsformel</p>
              <div className="mb-3">
                <label className="label">Formeltyp</label>
                <select className="input" value={form.virtual_type}
                  onChange={(e) => setForm({ ...form, virtual_type: e.target.value })}>
                  <option value="difference">Differenz (A minus B, C, ...)</option>
                  <option value="sum">Summe (A + B + C + ...)</option>
                  <option value="parallel">Doppelzählerstrecke (Parallelschaltung)</option>
                </select>
              </div>

              {form.virtual_type === 'difference' && (
                <div className="space-y-3">
                  <div>
                    <label className="label">Quellzähler (A)</label>
                    <select className="input" value={form.virtual_source_meter_id}
                      onChange={(e) => setForm({ ...form, virtual_source_meter_id: e.target.value })}>
                      <option value="">– Zähler wählen –</option>
                      {allMeters.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} {m.meter_number ? `(${m.meter_number})` : ''}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Abzugszähler (B, C, ...)</label>
                    <select className="input mb-2" value=""
                      onChange={(e) => {
                        if (e.target.value && !form.virtual_subtract_meter_ids.includes(e.target.value)) {
                          setForm({ ...form, virtual_subtract_meter_ids: [...form.virtual_subtract_meter_ids, e.target.value] });
                        }
                      }}>
                      <option value="">+ Abzugszähler hinzufügen</option>
                      {allMeters
                        .filter((m) => m.id !== form.virtual_source_meter_id && !form.virtual_subtract_meter_ids.includes(m.id))
                        .map((m) => (
                          <option key={m.id} value={m.id}>{m.name} {m.meter_number ? `(${m.meter_number})` : ''}</option>
                        ))}
                    </select>
                    {form.virtual_subtract_meter_ids.map((id) => {
                      const m = allMeters.find((x) => x.id === id);
                      return (
                        <div key={id} className="flex items-center gap-2 text-sm py-1">
                          <span className="text-red-600">−</span>
                          <span className="flex-1">{m?.name || id}</span>
                          <button type="button" className="text-red-500 hover:text-red-700 text-xs"
                            onClick={() => setForm({ ...form, virtual_subtract_meter_ids: form.virtual_subtract_meter_ids.filter((x) => x !== id) })}>
                            Entfernen
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500">Ergebnis = Quellzähler − Summe der Abzugszähler</p>
                </div>
              )}

              {(form.virtual_type === 'sum' || form.virtual_type === 'parallel') && (
                <div className="space-y-3">
                  <div>
                    <label className="label">
                      {form.virtual_type === 'parallel' ? 'Parallelzähler (z. B. KWZ 55, KWZ 56)' : 'Quellzähler'}
                    </label>
                    <select className="input mb-2" value=""
                      onChange={(e) => {
                        if (e.target.value && !form.virtual_sum_meter_ids.includes(e.target.value)) {
                          setForm({ ...form, virtual_sum_meter_ids: [...form.virtual_sum_meter_ids, e.target.value] });
                        }
                      }}>
                      <option value="">+ Zähler hinzufügen</option>
                      {allMeters.filter((m) => !form.virtual_sum_meter_ids.includes(m.id)).map((m) => (
                        <option key={m.id} value={m.id}>{m.name} {m.meter_number ? `(${m.meter_number})` : ''}</option>
                      ))}
                    </select>
                    {form.virtual_sum_meter_ids.map((id) => {
                      const m = allMeters.find((x) => x.id === id);
                      return (
                        <div key={id} className="flex items-center gap-2 text-sm py-1">
                          <span className="text-green-600">+</span>
                          <span className="flex-1">{m?.name || id}</span>
                          <button type="button" className="text-red-500 hover:text-red-700 text-xs"
                            onClick={() => setForm({ ...form, virtual_sum_meter_ids: form.virtual_sum_meter_ids.filter((x) => x !== id) })}>
                            Entfernen
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-gray-500">
                    {form.virtual_type === 'parallel'
                      ? 'Gesamtverbrauch = Summe aller Parallelzähler.'
                      : 'Ergebnis = Summe aller Quellzähler'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Zuordnung */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">Zuordnung (optional)</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Standort</label>
                <select className="input" value={hierarchy.selectedSiteId}
                  onChange={(e) => hierarchy.setSelectedSiteId(e.target.value)}>
                  <option value="">– Kein Standort –</option>
                  {hierarchy.sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Gebäude</label>
                <select className="input" value={hierarchy.selectedBuildingId}
                  onChange={(e) => hierarchy.setSelectedBuildingId(e.target.value)}
                  disabled={!hierarchy.selectedSiteId}>
                  <option value="">– Kein Gebäude –</option>
                  {hierarchy.buildings.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Nutzungseinheit</label>
                <select className="input" value={hierarchy.selectedUnitId}
                  onChange={(e) => hierarchy.setSelectedUnitId(e.target.value)}
                  disabled={!hierarchy.selectedBuildingId}>
                  <option value="">– Keine Einheit –</option>
                  {hierarchy.units.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Übergeordneter Zähler */}
          <div>
            <label className="label">Übergeordneter Zähler</label>
            <select className="input" value={form.parent_meter_id}
              onChange={(e) => setForm({ ...form, parent_meter_id: e.target.value })}>
              <option value="">– Kein übergeordneter Zähler (Hauptzähler) –</option>
              {allMeters.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} {m.meter_number ? `(${m.meter_number})` : ''} – {ENERGY_TYPE_LABELS[m.energy_type as EnergyType] || m.energy_type}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Definiert die Messtopologie: Unterzähler werden in der Karte unterhalb des übergeordneten Zählers angezeigt.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_feed_in" checked={form.is_feed_in}
                onChange={(e) => setForm({ ...form, is_feed_in: e.target.checked })} />
              <label htmlFor="is_feed_in" className="text-sm">Einspeisezähler (PV / Erzeugung)</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_delivery_based" checked={form.is_delivery_based}
                onChange={(e) => setForm({ ...form, is_delivery_based: e.target.checked })} />
              <label htmlFor="is_delivery_based" className="text-sm">Lieferungsbasiert (Pellets, Heizöl etc.)</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="is_weather_corrected" checked={form.is_weather_corrected}
                onChange={(e) => setForm({ ...form, is_weather_corrected: e.target.checked })} />
              <label htmlFor="is_weather_corrected" className="text-sm">Witterungskorrektur</label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

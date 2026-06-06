import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ChevronRight, Zap, Building2, Settings, Trash2, Activity, Wifi, Plus, Search, DoorOpen } from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, type PaginatedResponse } from '@/types';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import Sankey from '@/components/charts/Sankey';

// ── Typen ──

interface Site {
  id: string; name: string; street: string | null; zip_code: string | null;
  city: string | null; country: string; latitude: number | null; longitude: number | null;
  co2_region: string | null; timezone: string; building_count: number; meter_count: number;
  created_at: string;
}
interface Building {
  id: string; name: string; site_id: string; building_type: string | null;
  building_year: number | null; total_area_m2: number | null; heated_area_m2: number | null;
  cooled_area_m2: number | null; floors: number | null; energy_certificate_class: string | null;
  usage_unit_count: number; created_at: string;
}
interface UsageUnit {
  id: string; name: string; building_id: string; usage_type: string; floor: string | null;
  area_m2: number | null; occupants: number | null; tenant_name: string | null; created_at: string;
}
interface AnnotatedMeterNode {
  id: string; name: string; meter_number: string | null; energy_type: string; unit: string;
  data_source: string; parent_meter_id: string | null; is_active: boolean; is_virtual: boolean;
  is_feed_in: boolean; is_submeter: boolean; is_delivery_based: boolean; is_weather_corrected: boolean;
  site_id: string | null; building_id: string | null; usage_unit_id: string | null;
  source_config: Record<string, unknown> | null; virtual_config: Record<string, unknown> | null;
  schema_label: string | null; notes: string | null; display_name?: string | null;
  serial_number?: string | null; installation_date?: string | null;
  removal_date?: string | null; calibration_date?: string | null;
  cross_site_boundary: boolean; owner_site_name: string | null; children: AnnotatedMeterNode[];
}
interface SiteConsumption {
  site_id: string; site_name: string; period_start: string; period_end: string;
  gross_consumption_kwh: number; cross_site_exit_kwh: number; net_consumption_kwh: number;
  exit_points: Array<{ meter_id: string; meter_name: string; owner_site_id: string | null; owner_site_name: string; consumption_kwh: number; }>;
}
interface SiteConsumptionSummary {
  site_id: string; site_name: string; by_energy: Record<string, number>;
}

type SelectedNode =
  | { type: 'site' }
  | { type: 'building'; id: string }
  | { type: 'unit'; id: string; buildingId: string };

// ── Forms ──
interface SiteForm { name: string; street: string; zip_code: string; city: string; country: string; latitude: string; longitude: string; }
interface BuildingForm { name: string; building_type: string; building_year: string; total_area_m2: string; heated_area_m2: string; cooled_area_m2: string; floors: string; energy_certificate_class: string; }
interface UnitForm { name: string; usage_type: string; floor: string; area_m2: string; occupants: string; tenant_name: string; }
interface MeterForm {
  name: string; meter_number: string; energy_type: string; unit: string; data_source: string; location: string;
  site_id: string; building_id: string; usage_unit_id: string; parent_meter_id: string;
  is_virtual: boolean; is_feed_in: boolean; is_delivery_based: boolean; is_weather_corrected: boolean;
  schema_label: string; notes: string;
  source_host: string; source_channel: string; source_entity_id: string;
  source_register: string; source_topic: string; source_broker: string;
  display_name: string; serial_number: string; installation_date: string; removal_date: string; calibration_date: string;
}

const emptySiteForm: SiteForm = { name: '', street: '', zip_code: '', city: '', country: 'DE', latitude: '', longitude: '' };
const emptyBuildingForm: BuildingForm = { name: '', building_type: '', building_year: '', total_area_m2: '', heated_area_m2: '', cooled_area_m2: '', floors: '', energy_certificate_class: '' };
const emptyUnitForm: UnitForm = { name: '', usage_type: 'office', floor: '', area_m2: '', occupants: '', tenant_name: '' };
const emptyMeterForm: MeterForm = {
  name: '', meter_number: '', energy_type: 'electricity', unit: 'kWh', data_source: 'manual', location: '',
  site_id: '', building_id: '', usage_unit_id: '', parent_meter_id: '',
  is_virtual: false, is_feed_in: false, is_delivery_based: false, is_weather_corrected: false,
  schema_label: '', notes: '',
  source_host: '', source_channel: '0', source_entity_id: '', source_register: '', source_topic: '', source_broker: '',
  display_name: '', serial_number: '', installation_date: '', removal_date: '', calibration_date: '',
};

// ── Konstanten ──
const DATA_SOURCE_LABELS: Record<string, string> = {
  manual: 'Manuell', csv_import: 'CSV', shelly: 'Shelly', modbus: 'Modbus',
  knx: 'KNX', homeassistant: 'Home Assistant', spie: 'SPIE', mqtt: 'MQTT',
  bacnet: 'BACnet', virtual: 'Virtuell',
};
const ENERGY_TYPE_OPTIONS = [
  { value: 'electricity', label: 'Strom' }, { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Wasser' }, { value: 'district_heating', label: 'Fernwärme' },
  { value: 'district_cooling', label: 'Fernkälte' }, { value: 'oil', label: 'Heizöl' },
  { value: 'pellets', label: 'Pellets' }, { value: 'solar_thermal', label: 'Solarthermie' },
  { value: 'biomass', label: 'Biomasse' },
];
const UNIT_OPTIONS: Record<string, string[]> = {
  electricity: ['kWh', 'MWh'], gas: ['m³', 'kWh', 'MWh'], water: ['m³', 'l'],
  district_heating: ['kWh', 'MWh'], district_cooling: ['kWh', 'MWh'],
  default: ['kWh', 'MWh', 'm³', 'l', 'kg', 'Stk'],
};
const DATA_SOURCE_OPTIONS = [
  { value: 'manual', label: 'Manuell' }, { value: 'shelly', label: 'Shelly' },
  { value: 'modbus', label: 'Modbus' }, { value: 'knx', label: 'KNX' },
  { value: 'homeassistant', label: 'Home Assistant' }, { value: 'mqtt', label: 'MQTT' },
  { value: 'bacnet', label: 'BACnet' }, { value: 'csv_import', label: 'CSV-Import' },
  { value: 'spie', label: 'SPIE' }, { value: 'virtual', label: 'Virtuell' },
];
const BUILDING_TYPES: Record<string, string> = {
  office: 'Büro', residential: 'Wohnen', production: 'Produktion', retail: 'Einzelhandel',
  warehouse: 'Lager', school: 'Schule', hospital: 'Krankenhaus', hotel: 'Hotel', other: 'Sonstige',
};
const USAGE_TYPES: Record<string, string> = {
  office: 'Büro', server_room: 'Serverraum', workshop: 'Werkstatt', apartment: 'Wohnung',
  retail: 'Verkaufsfläche', storage: 'Lager', common_area: 'Allgemeinfläche',
  parking: 'Parkhaus/TG', other: 'Sonstige',
};
const SITE_ENERGY_DEFS = [
  { key: 'district_heating', label: 'Fernwärme',  color: '#E89A3C' },
  { key: 'electricity',      label: 'Strom',      color: '#F2C94C' },
  { key: 'district_cooling', label: 'Fernkälte',  color: '#4FC3F7' },
  { key: 'water',            label: 'Wasser',     color: '#2A6FDB' },
] as const;

// ── Hilfsfunktionen ──
function cleanFormData(data: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    if (['latitude', 'longitude', 'total_area_m2', 'heated_area_m2', 'cooled_area_m2', 'area_m2'].includes(key)) result[key] = parseFloat(value);
    else if (['building_year', 'floors', 'occupants'].includes(key)) result[key] = parseInt(value, 10);
    else result[key] = value;
  }
  return result;
}

function buildMeterPayload(form: MeterForm): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name, energy_type: form.energy_type, unit: form.unit, data_source: form.data_source,
    is_virtual: form.is_virtual, is_feed_in: form.is_feed_in,
    is_delivery_based: form.is_delivery_based, is_weather_corrected: form.is_weather_corrected,
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
  if (form.data_source === 'shelly' && form.source_host)
    payload.source_config = { shelly_host: form.source_host, channel: parseInt(form.source_channel) || 0 };
  else if (form.data_source === 'modbus' && form.source_host)
    payload.source_config = { ip: form.source_host, register: parseInt(form.source_register) || 0 };
  else if (form.data_source === 'homeassistant' && form.source_entity_id)
    payload.source_config = { entity_id: form.source_entity_id };
  else if (form.data_source === 'mqtt' && form.source_topic)
    payload.source_config = { broker_host: form.source_broker, topic: form.source_topic, port: 1883 };
  return payload;
}

function flattenTree(nodes: AnnotatedMeterNode[]): AnnotatedMeterNode[] {
  const result: AnnotatedMeterNode[] = [];
  const visit = (n: AnnotatedMeterNode) => { result.push(n); n.children.forEach(visit); };
  nodes.forEach(visit);
  return result;
}

// ── Zähler-Modal ──
function MeterModal({ form, setForm, editingId, onSubmit, onClose, error, saving, siteBuildings, siteUnits }: {
  form: MeterForm; setForm: (f: MeterForm) => void; editingId: string | null;
  onSubmit: (e: React.FormEvent) => void; onClose: () => void;
  error: string | null; saving: boolean; siteBuildings: Building[]; siteUnits: UsageUnit[];
}) {
  const unitOptions = UNIT_OPTIONS[form.energy_type] || UNIT_OPTIONS.default;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 overflow-y-auto py-8">
      <div className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl mx-4">
        <h2 className="mb-4 text-lg font-bold">{editingId ? 'Zähler bearbeiten' : 'Neuer Zähler'}</h2>
        <form onSubmit={onSubmit} className="space-y-4">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="label">Name *</label>
              <input type="text" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
            </div>
            <div>
              <label className="label">Zählernummer</label>
              <input type="text" className="input" value={form.meter_number} onChange={e => setForm({ ...form, meter_number: e.target.value })} placeholder="z.B. EL-001" />
            </div>
            <div>
              <label className="label">Standort / Bezeichnung</label>
              <input type="text" className="input" value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="z.B. Technikraum UG" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Energieart *</label>
              <select className="input" value={form.energy_type} onChange={e => setForm({ ...form, energy_type: e.target.value, unit: UNIT_OPTIONS[e.target.value]?.[0] || 'kWh' })}>
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
          {form.data_source === 'shelly' && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div><label className="label">IP-Adresse / Hostname</label><input type="text" className="input" value={form.source_host} onChange={e => setForm({ ...form, source_host: e.target.value })} placeholder="192.168.1.100" /></div>
              <div><label className="label">Kanal</label><input type="number" className="input" value={form.source_channel} onChange={e => setForm({ ...form, source_channel: e.target.value })} min="0" max="5" /></div>
            </div>
          )}
          {form.data_source === 'modbus' && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div><label className="label">IP-Adresse</label><input type="text" className="input" value={form.source_host} onChange={e => setForm({ ...form, source_host: e.target.value })} placeholder="192.168.1.100" /></div>
              <div><label className="label">Register</label><input type="number" className="input" value={form.source_register} onChange={e => setForm({ ...form, source_register: e.target.value })} /></div>
            </div>
          )}
          {form.data_source === 'homeassistant' && (
            <div className="rounded-lg bg-gray-50 p-3">
              <label className="label">Entity-ID</label>
              <input type="text" className="input" value={form.source_entity_id} onChange={e => setForm({ ...form, source_entity_id: e.target.value })} placeholder="sensor.stromzaehler_kwh" />
            </div>
          )}
          {form.data_source === 'mqtt' && (
            <div className="rounded-lg bg-gray-50 p-3 grid grid-cols-2 gap-3">
              <div><label className="label">Broker</label><input type="text" className="input" value={form.source_broker} onChange={e => setForm({ ...form, source_broker: e.target.value })} placeholder="192.168.1.10" /></div>
              <div><label className="label">Topic</label><input type="text" className="input" value={form.source_topic} onChange={e => setForm({ ...form, source_topic: e.target.value })} placeholder="energie/strom/kwh" /></div>
            </div>
          )}
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
            <div className="col-span-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
              Die Zähler-Hierarchie wird unter <a href="/meters" className="font-medium underline">Zähler → Physikalisches Netzwerk</a> festgelegt.
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            {[{ key: 'is_feed_in', label: 'Einspeisung' }, { key: 'is_virtual', label: 'Virtuell' }, { key: 'is_delivery_based', label: 'Lieferbasiert' }, { key: 'is_weather_corrected', label: 'Witterungskorrigiert' }].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={form[key as keyof MeterForm] as boolean}
                  onChange={e => setForm({ ...form, [key]: e.target.checked })}
                  className="rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                {label}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Schema-Label</label><input type="text" className="input" value={form.schema_label} onChange={e => setForm({ ...form, schema_label: e.target.value })} /></div>
            <div><label className="label">Notizen</label><input type="text" className="input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <details className="rounded-lg border border-gray-200">
            <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">Technische Daten</summary>
            <div className="px-3 pb-3 pt-2 grid grid-cols-2 gap-4">
              <div className="col-span-2"><label className="label">Klarname</label><input type="text" className="input" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} /></div>
              <div><label className="label">Seriennummer</label><input type="text" className="input" value={form.serial_number} onChange={e => setForm({ ...form, serial_number: e.target.value })} /></div>
              <div><label className="label">Einbaudatum</label><input type="date" className="input" value={form.installation_date} onChange={e => setForm({ ...form, installation_date: e.target.value })} /></div>
              <div><label className="label">Ausbaudatum</label><input type="date" className="input" value={form.removal_date} onChange={e => setForm({ ...form, removal_date: e.target.value })} /></div>
              <div><label className="label">Eichfrist</label><input type="date" className="input" value={form.calibration_date} onChange={e => setForm({ ...form, calibration_date: e.target.value })} /></div>
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
  const navigate = useNavigate();

  // Liste
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [consumptionSummary, setConsumptionSummary] = useState<Record<string, SiteConsumptionSummary>>({});

  // Navigation
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedNode>({ type: 'site' });
  const [buildingsExpanded, setBuildingsExpanded] = useState(true);
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());

  // Detail-Daten
  const [siteBuildings, setSiteBuildings] = useState<Building[]>([]);
  const [siteMeters, setSiteMeters] = useState<AnnotatedMeterNode[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [meterEnergyFilter, setMeterEnergyFilter] = useState('');

  // Gebäude-Detail (für usage_units → NE-Sankey)
  const [selectedBuilding, setSelectedBuilding] = useState<(Building & { usage_units: UsageUnit[] }) | null>(null);

  // Verbrauchsrechnung
  const [siteConsumption, setSiteConsumption] = useState<SiteConsumption | null>(null);
  const [vbrCollapsed, setVbrCollapsed] = useState(false);
  const currentYear = new Date().getFullYear();
  const [consumptionYear, setConsumptionYear] = useState(currentYear - 1);

  // Zähler-Modal
  const [showMeterModal, setShowMeterModal] = useState(false);
  const [editingMeterId, setEditingMeterId] = useState<string | null>(null);
  const [meterForm, setMeterForm] = useState<MeterForm>(emptyMeterForm);
  const [meterFormError, setMeterFormError] = useState<string | null>(null);
  const [meterSaving, setMeterSaving] = useState(false);

  // Aktionsergebnis
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

  // Alle NE des Standorts (für Zähler-Modal)
  const [allSiteUnits, setAllSiteUnits] = useState<UsageUnit[]>([]);

  // Sync
  const [syncingNetMeters, setSyncingNetMeters] = useState(false);
  const [syncResult, setSyncResult] = useState<{ name: string; action: string; subtract_count: number }[] | null>(null);

  const pageSize = 25;

  // ── Laden ──

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const year = new Date().getFullYear() - 1;
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() });
      if (search) params.append('search', search);
      const [res, summaryRes] = await Promise.all([
        apiClient.get<PaginatedResponse<Site>>(`/api/v1/sites?${params}`),
        apiClient.get<SiteConsumptionSummary[]>(
          `/api/v1/sites/consumption-summary?period_start=${year}-01-01&period_end=${year}-12-31`
        ).catch(() => ({ data: [] as SiteConsumptionSummary[] })),
      ]);
      setSites(res.data.items);
      setTotal(res.data.total);
      const map: Record<string, SiteConsumptionSummary> = {};
      summaryRes.data.forEach(s => { map[s.site_id] = s; });
      setConsumptionSummary(map);
    } catch { /* Interceptor */ } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { loadSites(); }, [loadSites]);

  const loadSiteDetail = useCallback(async (site: Site) => {
    setSelectedSite(site);
    setSelectedNode({ type: 'site' });
    setSelectedBuilding(null);
    setSiteConsumption(null);
    setDetailLoading(true);
    setSiteBuildings([]);
    setSiteMeters([]);
    setMeterEnergyFilter('');
    setSyncResult(null);
    try {
      const [buildingsRes, metersRes] = await Promise.all([
        apiClient.get<Building[]>(`/api/v1/sites/${site.id}/buildings`),
        apiClient.get<AnnotatedMeterNode[]>(`/api/v1/sites/${site.id}/meter-tree`),
      ]);
      setSiteBuildings(buildingsRes.data);
      setSiteMeters(metersRes.data);
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

  const autoSiteParam = searchParams.get('site');
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoSiteParam || autoOpenedRef.current || loading || sites.length === 0) return;
    const match = sites.find((s) => s.id === autoSiteParam);
    if (match) { autoOpenedRef.current = true; loadSiteDetail(match); }
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
      const res = await apiClient.get(`/api/v1/sites/${siteId}/buildings/${buildingId}`);
      setSelectedBuilding(res.data);
    } catch { /* Interceptor */ }
  }, []);

  const handleBuildingNodeClick = useCallback((b: Building) => {
    setSelectedNode({ type: 'building', id: b.id });
    if (selectedSite && selectedBuilding?.id !== b.id) {
      loadBuildingDetail(selectedSite.id, b.id);
    }
  }, [selectedSite, selectedBuilding, loadBuildingDetail]);

  // ── Zähler CRUD ──

  const openNewMeter = () => {
    setEditingMeterId(null);
    setMeterForm({
      ...emptyMeterForm,
      site_id: selectedSite?.id || '',
      building_id: selectedNode.type === 'building' ? selectedNode.id : '',
    });
    setMeterFormError(null);
    setShowMeterModal(true);
  };

  const openEditMeter = (node: AnnotatedMeterNode) => {
    const sc = node.source_config || {};
    setEditingMeterId(node.id);
    setMeterForm({
      name: node.name, meter_number: node.meter_number || '', energy_type: node.energy_type,
      unit: node.unit, data_source: node.data_source, location: '',
      site_id: node.site_id || selectedSite?.id || '', building_id: node.building_id || '',
      usage_unit_id: node.usage_unit_id || '', parent_meter_id: node.parent_meter_id || '',
      is_virtual: node.is_virtual, is_feed_in: node.is_feed_in,
      is_delivery_based: node.is_delivery_based, is_weather_corrected: node.is_weather_corrected,
      schema_label: node.schema_label || '', notes: node.notes || '',
      source_host: (sc.shelly_host || sc.ip || '') as string,
      source_channel: String(sc.channel ?? '0'),
      source_entity_id: (sc.entity_id || '') as string,
      source_register: String(sc.register ?? ''),
      source_topic: (sc.topic || '') as string,
      source_broker: (sc.broker_host || '') as string,
      display_name: node.display_name || '', serial_number: node.serial_number || '',
      installation_date: node.installation_date || '', removal_date: node.removal_date || '',
      calibration_date: node.calibration_date || '',
    });
    setMeterFormError(null);
    setShowMeterModal(true);
  };

  const handleSubmitMeter = async (e: React.FormEvent) => {
    e.preventDefault(); setMeterFormError(null); setMeterSaving(true);
    try {
      const payload = buildMeterPayload(meterForm);
      if (editingMeterId) await apiClient.put(`/api/v1/meters/${editingMeterId}`, payload);
      else await apiClient.post('/api/v1/meters', payload);
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
      setActionResult({ title: `Abfrage: ${node.name}`, message: d.value !== undefined ? `Wert: ${d.value} ${node.unit}` : d.message || JSON.stringify(d) });
    } catch { setActionResult({ title: `Abfrage: ${node.name}`, message: 'Fehler beim Abfragen.' }); }
  };

  const handleTestConnection = async (node: AnnotatedMeterNode) => {
    try {
      const res = await apiClient.get<{ success: boolean; current_power_w?: number; total_energy_kwh?: number; error?: string }>(`/api/v1/meters/${node.id}/test-connection`);
      const d = res.data;
      setActionResult({ title: `Verbindungstest: ${node.name}`, message: d.success ? `OK – Leistung: ${d.current_power_w ?? '?'} W · Zähler: ${d.total_energy_kwh?.toFixed(2) ?? '?'} kWh` : `Fehler: ${d.error}` });
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

  const handleSyncNetMeters = async () => {
    if (!selectedSite) return;
    setSyncingNetMeters(true); setSyncResult(null);
    try {
      const res = await apiClient.post(`/api/v1/sites/${selectedSite.id}/sync-net-meters`);
      setSyncResult(res.data);
      await reloadSiteMeters();
      loadSiteConsumption(selectedSite.id, consumptionYear);
    } catch { /* Interceptor */ }
    setSyncingNetMeters(false);
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
      if (selectedNode.type === 'building' && selectedNode.id === b.id) setSelectedNode({ type: 'site' });
    } catch { /* Interceptor */ }
  };

  // ── NE CRUD ──

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


  const totalPages = Math.ceil(total / pageSize);
  const breakoutStyle = { margin: '-1.5rem' };

  // ── Render: Liste ──

  if (!selectedSite) {
    const totalMeters = sites.reduce((a, s) => a + s.meter_count, 0);
    return (
      <div className="sites-v2 dash-v2" style={breakoutStyle}>
        <div className="page-head">
          <div>
            <div className="breadcrumb">Stammdaten · Standorte</div>
            <h1>Standorte</h1>
            <div className="head-sub">{total} Standorte · {totalMeters} Zähler gesamt</div>
          </div>
          <div className="head-actions">
            <button className="btn-primary" onClick={() => { setEditingId(null); setSiteForm(emptySiteForm); setFormError(null); setShowSiteModal(true); }}>
              <Plus size={13} /> Neuer Standort
            </button>
          </div>
        </div>

        <div className="toolbar">
          <div className="search-input">
            <Search size={13} style={{ color: 'var(--ink-4)', flexShrink: 0 }} />
            <input type="text" placeholder="Suche nach Name, Stadt…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <div className="view-toggle">
            <button className={viewMode === 'cards' ? 'active' : ''} onClick={() => setViewMode('cards')}>Karten</button>
            <button className={viewMode === 'table' ? 'active' : ''} onClick={() => setViewMode('table')}>Tabelle</button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px 24px' }}><LoadingSpinner /></div>
        ) : sites.length === 0 ? (
          <div className="empty" style={{ margin: '24px' }}>
            <strong>Noch keine Standorte</strong>Legen Sie jetzt Ihren ersten Standort an.
          </div>
        ) : viewMode === 'cards' ? (
          <div className="standorte-grid">
            {sites.map(site => (
              <div key={site.id} className="standort-card" onClick={() => loadSiteDetail(site)}>
                <div className="standort-card-head">
                  <div>
                    <div className="standort-card-title">{site.name}</div>
                    <div className="standort-card-sub">{[site.zip_code, site.city].filter(Boolean).join(' ') || '–'}</div>
                  </div>
                  <div className="standort-card-menu" onClick={e => { e.stopPropagation(); setEditingId(site.id); setSiteForm({ name: site.name, street: site.street || '', zip_code: site.zip_code || '', city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '', longitude: site.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}>
                    <Settings size={13} />
                  </div>
                </div>
                <div className="struct-row">
                  <div className="struct-cell">
                    <div className="struct-num">{site.building_count}</div>
                    <div className="struct-label">Gebäude</div>
                  </div>
                  <div className="struct-cell">
                    <div className="struct-num muted">–</div>
                    <div className="struct-label">NE</div>
                  </div>
                  <div className="struct-cell">
                    <div className="struct-num">{site.meter_count}</div>
                    <div className="struct-label">Zähler</div>
                  </div>
                </div>
                {(() => {
                  const summary = consumptionSummary[site.id];
                  if (!summary) return null;
                  const entries = SITE_ENERGY_DEFS.filter(d => summary.by_energy[d.key] != null);
                  if (entries.length === 0) return null;
                  const fmtMwh = (kwh: number) => kwh >= 1000
                    ? `${(kwh / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MWh`
                    : `${Math.round(kwh).toLocaleString('de-DE')} kWh`;
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '8px 14px 4px', borderTop: '1px solid var(--line)' }}>
                      {entries.map(d => (
                        <span key={d.key} style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          background: d.color + '18', border: `1px solid ${d.color}44`,
                          borderRadius: 4, padding: '2px 7px', fontSize: 10.5, color: 'var(--ink-2)',
                        }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: d.color, display: 'inline-block', flexShrink: 0 }} />
                          {d.label}: {fmtMwh(summary.by_energy[d.key])}
                        </span>
                      ))}
                    </div>
                  );
                })()}
                <div className="standort-card-foot">
                  <span style={{ fontSize: 11 }}>{site.timezone}</span>
                  <span className="open-cta">Öffnen <ChevronRight size={12} /></span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="standorte-table">
            <div className="st-tr head">
              <span>Name</span><span>Stadt</span><span>PLZ</span><span>Gebäude · Zähler</span><span>Aktionen</span>
            </div>
            {sites.map(site => (
              <div key={site.id} className="st-tr" onClick={() => loadSiteDetail(site)}>
                <span className="st-name">{site.name}</span>
                <span className="st-mono">{site.city || '–'}</span>
                <span className="st-mono">{site.zip_code || '–'}</span>
                <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{site.building_count} · {site.meter_count}</span>
                <div className="st-actions" onClick={e => e.stopPropagation()}>
                  <span className="edit" onClick={() => { setEditingId(site.id); setSiteForm({ name: site.name, street: site.street || '', zip_code: site.zip_code || '', city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '', longitude: site.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}>Bearb.</span>
                  <span className="delete" onClick={e => handleDeleteSite(site, e)}>Löschen</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {totalPages > 1 && (
          <div style={{ padding: '0 24px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
            <span style={{ color: 'var(--ink-3)' }}>Seite {page} von {totalPages}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary" disabled={page <= 1} onClick={() => setPage(page - 1)} style={{ padding: '6px 12px', fontSize: 12 }}>Zurück</button>
              <button className="btn-primary" disabled={page >= totalPages} onClick={() => setPage(page + 1)} style={{ padding: '6px 12px', fontSize: 12 }}>Weiter</button>
            </div>
          </div>
        )}

        {showSiteModal && <SiteModal form={siteForm} setForm={setSiteForm} editingId={editingId}
          onSubmit={handleSubmitSite} onClose={() => setShowSiteModal(false)} error={formError} saving={saving} />}
      </div>
    );
  }

  // ── Render: Detail ──

  const flatMeters = flattenTree(siteMeters);
  const totalMeterCount = flatMeters.length || selectedSite.meter_count;
  const hasExits = !!(siteConsumption && siteConsumption.cross_site_exit_kwh > 0);

  const siteEnergySet = new Set(flatMeters.map(m => m.energy_type));
  const activeDefs = SITE_ENERGY_DEFS.filter(d => siteEnergySet.has(d.key));
  const unknownEnergyTypes = [...siteEnergySet].filter(k => !SITE_ENERGY_DEFS.some(d => d.key === k));
  const filterDefs: Array<{ key: string; label: string; color: string }> = [
    ...activeDefs,
    ...unknownEnergyTypes.map(k => ({ key: k, label: ENERGY_TYPE_LABELS[k as keyof typeof ENERGY_TYPE_LABELS] || k, color: 'var(--ink-4)' })),
  ];

  const panelMeters = selectedNode.type === 'building'
    ? flatMeters.filter(m => m.building_id === selectedNode.id)
    : selectedNode.type === 'unit'
    ? flatMeters.filter(m => m.usage_unit_id === selectedNode.id)
    : flatMeters;
  const filteredPanelMeters = meterEnergyFilter
    ? panelMeters.filter(m => m.energy_type === meterEnergyFilter)
    : panelMeters;

  // Sankey: Energieart → Gebäude
  const sankeyFlowMap = new Map<string, number>();
  flatMeters.forEach(m => {
    if (!m.building_id) return;
    const k = `${m.energy_type}::${m.building_id}`;
    sankeyFlowMap.set(k, (sankeyFlowMap.get(k) ?? 0) + 1);
  });
  const siteFlows: Array<{ source: string; target: string; value: number }> = [];
  sankeyFlowMap.forEach((cnt, k) => { const [s, t] = k.split('::'); siteFlows.push({ source: s, target: t, value: cnt }); });
  const sankeyBuildingIds = new Set(flatMeters.map(m => m.building_id).filter(Boolean) as string[]);
  const sankeyBuildingTargets = siteBuildings.filter(b => sankeyBuildingIds.has(b.id)).map(b => ({ id: b.id, label: b.name }));

  // Sankey: Energieart → NE (nur wenn Gebäude gewählt + units geladen)
  const bldgFlowMap = new Map<string, number>();
  if (selectedNode.type === 'building' && selectedBuilding?.id === selectedNode.id && selectedBuilding.usage_units?.length) {
    flatMeters.filter(m => m.building_id === selectedNode.id && m.usage_unit_id).forEach(m => {
      const k = `${m.energy_type}::${m.usage_unit_id}`;
      bldgFlowMap.set(k, (bldgFlowMap.get(k) ?? 0) + 1);
    });
  }
  const bldgFlows: Array<{ source: string; target: string; value: number }> = [];
  bldgFlowMap.forEach((cnt, k) => { const [s, t] = k.split('::'); bldgFlows.push({ source: s, target: t, value: cnt }); });

  const panelBuilding = selectedNode.type === 'building' ? siteBuildings.find(b => b.id === selectedNode.id) ?? null : null;
  const panelBuildingUnits = (selectedNode.type === 'building' && selectedBuilding?.id === selectedNode.id) ? (selectedBuilding?.usage_units ?? []) : [];

  const getEnergyColor = (k: string) => (SITE_ENERGY_DEFS.find(d => d.key === k)?.color ?? 'var(--ink-4)');
  const fmtKwh = (v: number) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 0 }) + ' kWh';

  return (
    <div className="sites-v2 dash-v2" style={breakoutStyle}>
      {/* Page head */}
      <div className="page-head">
        <div>
          <div className="breadcrumb">
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit', padding: 0 }}
              onClick={() => setSelectedSite(null)}>Standorte</button>
            <span style={{ color: 'var(--ink-4)' }}>›</span>
            <span style={{ color: 'var(--ink)', fontWeight: 500 }}>{selectedSite.name}</span>
          </div>
          <h1>{selectedSite.name}</h1>
          <div className="head-sub">{[selectedSite.zip_code, selectedSite.city, selectedSite.street].filter(Boolean).join(' · ')}</div>
        </div>
        <div className="head-actions">
          <button className="btn-primary" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', fontSize: 12 }}
            onClick={() => { setEditingId(selectedSite.id); setSiteForm({ name: selectedSite.name, street: selectedSite.street || '', zip_code: selectedSite.zip_code || '', city: selectedSite.city || '', country: selectedSite.country, latitude: selectedSite.latitude?.toString() || '', longitude: selectedSite.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}>
            Bearbeiten
          </button>
          <button className="btn-primary" onClick={openNewMeter}><Plus size={13} /> Neuer Zähler</button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="stats-strip" style={{ margin: '16px 24px 0' }}>
        <div className="stats-cell">
          <div className="stats-label">Gebäude</div>
          <div className="stats-value">{siteBuildings.length}</div>
        </div>
        <div className="stats-cell">
          <div className="stats-label">Zähler</div>
          <div className="stats-value">{totalMeterCount}</div>
        </div>
        <div className="stats-cell">
          <div className="stats-label">CO₂-Region</div>
          <div className="stats-value" style={{ fontSize: 14 }}>{selectedSite.co2_region || '–'}</div>
        </div>
        <div className="stats-cell">
          <div className="stats-label">Zeitzone</div>
          <div className="stats-value" style={{ fontSize: 12 }}>{selectedSite.timezone}</div>
        </div>
        <div className="stats-cell">
          <div className="stats-label">Fremd-Abzüge</div>
          <div className="stats-value">{siteConsumption ? siteConsumption.exit_points.length : '–'}</div>
          {siteConsumption && <div className="stats-sub">{consumptionYear}</div>}
        </div>
      </div>

      {/* VBR-Block */}
      {siteConsumption && (
        <div className={`vbr-block${vbrCollapsed ? ' collapsed' : ''}`}>
          <div className="vbr-head" onClick={() => setVbrCollapsed(v => !v)}>
            <div className="vbr-head-left">
              <div className="vbr-icon"><Zap size={13} /></div>
              <div>
                <div className="vbr-title">Verbrauchsrechnung</div>
                <div className="vbr-sub">Physikalische Zählerhierarchie</div>
              </div>
            </div>
            <div className="vbr-head-right">
              <div className="vbr-net">
                <div className="vbr-net-label">Netto</div>
                <div className="vbr-net-value">{fmtKwh(siteConsumption.net_consumption_kwh)}</div>
              </div>
              <select className="vbr-year-select" value={consumptionYear}
                onClick={e => e.stopPropagation()}
                onChange={e => setConsumptionYear(Number(e.target.value))}>
                {Array.from({ length: 5 }, (_, i) => currentYear - 1 - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <span className="vbr-chev"><ChevronRight size={14} /></span>
            </div>
          </div>
          <div className="vbr-body">
            <div className="vbr-line brutto">
              <span>Bruttoverbrauch</span>
              <span className="meter-val">{fmtKwh(siteConsumption.gross_consumption_kwh)}</span>
            </div>
            {hasExits && siteConsumption.exit_points.map(ep => (
              <div key={ep.meter_id} className="vbr-line">
                <div className="meter-line">
                  <span className="meter-code">{ep.meter_name}</span>
                  <span className="meter-belongs">gehört zu: {ep.owner_site_name}</span>
                </div>
                <span className="meter-val">− {fmtKwh(ep.consumption_kwh)}</span>
              </div>
            ))}
            {hasExits && (
              <div className="vbr-line section-sum">
                <span>Abzüge gesamt</span>
                <span className="meter-val">− {fmtKwh(siteConsumption.cross_site_exit_kwh)}</span>
              </div>
            )}
            <div className="vbr-line netto">
              <span>= Nettoverbrauch {selectedSite.name}</span>
              <span className="meter-val">{fmtKwh(siteConsumption.net_consumption_kwh)}</span>
            </div>
            {!hasExits && (
              <p style={{ fontSize: 11.5, color: '#92551A', fontStyle: 'italic', marginTop: 4 }}>
                Keine standortübergreifenden Subtraktionszähler – Brutto = Netto.
              </p>
            )}
            {hasExits && (
              <div className="vbr-actions">
                <button className="btn-amber" onClick={handleSyncNetMeters} disabled={syncingNetMeters}>
                  {syncingNetMeters
                    ? <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-700 border-t-transparent" />
                    : <Zap size={11} />}
                  Netto-Zähler erstellen
                </button>
                <button className="btn-amber" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>Berechnung exportieren</button>
              </div>
            )}
            {syncResult && syncResult.length > 0 && (
              <div style={{ marginTop: 6 }}>
                {syncResult.map(r => <p key={r.name} style={{ fontSize: 11.5, color: '#7B3F0C' }}>✓ {r.name} ({r.action}, {r.subtract_count} Subtraktionszähler)</p>)}
              </div>
            )}
            {syncResult && syncResult.length === 0 && (
              <p style={{ fontSize: 11.5, color: '#92551A', marginTop: 4 }}>Alle Netto-Zähler sind bereits aktuell.</p>
            )}
          </div>
        </div>
      )}

      {/* Zwei-Spalten-Layout */}
      <div className="detail-main">
        {/* Baum */}
        <div className="tree">
          <div className="tree-head">
            <span className="tree-head-title">Hierarchie</span>
            <span className="tree-expand-toggle" onClick={() => setBuildingsExpanded(v => !v)}>
              {buildingsExpanded ? 'Einklappen' : 'Aufklappen'}
            </span>
          </div>
          <div className="tree-body">
            <div className={`tree-node${buildingsExpanded && siteBuildings.length > 0 ? ' open' : ''}`}>
              <div className={`tree-row tree-level-standort${selectedNode.type === 'site' ? ' selected' : ''}`}
                onClick={() => setSelectedNode({ type: 'site' })}>
                <div className={`tree-chev${siteBuildings.length === 0 ? ' empty' : ''}`}
                  onClick={e => { e.stopPropagation(); setBuildingsExpanded(v => !v); }}>
                  {siteBuildings.length > 0 && <ChevronRight size={12} />}
                </div>
                <div className="tree-ico"><Building2 size={13} /></div>
                <span className="tree-label">{selectedSite.name}</span>
                <span className="tree-meta">{totalMeterCount}</span>
              </div>
              <div className="tree-children">
                {detailLoading && <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--ink-4)' }}>Laden…</div>}
                {siteBuildings.map(b => {
                  const bCount = flatMeters.filter(m => m.building_id === b.id).length;
                  const isSel = selectedNode.type === 'building' && selectedNode.id === b.id;
                  const bUnits = allSiteUnits.filter(u => u.building_id === b.id);
                  const isExpanded = expandedBuildings.has(b.id);
                  return (
                    <div key={b.id} className={`tree-node${isExpanded && bUnits.length > 0 ? ' open' : ''}`}>
                      <div className={`tree-row tree-level-gebaeude${isSel ? ' selected' : ''}`}
                        onClick={() => handleBuildingNodeClick(b)}>
                        <div
                          className={`tree-chev${bUnits.length === 0 ? ' empty' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (bUnits.length === 0) return;
                            setExpandedBuildings((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.id)) next.delete(b.id); else next.add(b.id);
                              return next;
                            });
                          }}
                        >
                          {bUnits.length > 0 && <ChevronRight size={12} />}
                        </div>
                        <div className="tree-ico"><Building2 size={12} /></div>
                        <span className="tree-label">{b.name}</span>
                        <span className="tree-meta">{bCount}</span>
                      </div>
                      {isExpanded && bUnits.length > 0 && (
                        <div className="tree-children">
                          {bUnits.map((u) => {
                            const uCount = flatMeters.filter((m) => m.usage_unit_id === u.id).length;
                            const isUnitSel = selectedNode.type === 'unit' && selectedNode.id === u.id;
                            return (
                              <div key={u.id} className="tree-node">
                                <div
                                  className={`tree-row${isUnitSel ? ' selected' : ''}`}
                                  onClick={() => setSelectedNode({ type: 'unit', id: u.id, buildingId: b.id })}
                                >
                                  <div className="tree-chev empty" />
                                  <div className="tree-ico"><DoorOpen size={12} /></div>
                                  <span className="tree-label">{u.name}</span>
                                  <span className="tree-meta">{uCount}</span>
                                </div>
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
        </div>

        {/* Panel */}
        <div className="panel">
          {selectedNode.type === 'site' ? (
            <>
              {/* Standort Entity-Head */}
              <div className="entity-head">
                <div className="entity-crumb">Standort</div>
                <div className="entity-title-row">
                  <h2>{selectedSite.name}</h2>
                  <span className="entity-kind">Standort</span>
                </div>
                <div className="entity-meta">
                  {selectedSite.city && <div className="item"><span className="item-label">Stadt</span><span className="item-val">{selectedSite.city}</span></div>}
                  {selectedSite.zip_code && <div className="item"><span className="item-label">PLZ</span><span className="item-val">{selectedSite.zip_code}</span></div>}
                  {selectedSite.co2_region && <div className="item"><span className="item-label">CO₂</span><span className="item-val">{selectedSite.co2_region}</span></div>}
                  <div className="item"><span className="item-label">Gebäude</span><span className="item-val">{siteBuildings.length}</span></div>
                  <div className="item"><span className="item-label">Zähler</span><span className="item-val">{totalMeterCount}</span></div>
                </div>
              </div>

              {/* Sankey Energieart → Gebäude */}
              {siteFlows.length > 0 && sankeyBuildingTargets.length > 0 && (
                <div className="panel-card">
                  <div className="panel-card-head">
                    <div>
                      <h3>Energiefluss · Standort-Übersicht</h3>
                      <div className="panel-card-sub">Zähler nach Energieart und Gebäude</div>
                    </div>
                  </div>
                  <div className="sankey-wrap">
                    <Sankey
                      sources={activeDefs.map(d => ({ id: d.key, label: d.label, color: d.color }))}
                      targets={sankeyBuildingTargets}
                      flows={siteFlows}
                      height={Math.max(160, sankeyBuildingTargets.length * 42 + 60)}
                      width={560} labelLeft={100} labelRight={120}
                    />
                    <div className="sankey-foot">
                      <span className="lhs">Energieart</span>
                      <span className="rhs">Gebäude</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Gebäude-Karten */}
              {siteBuildings.length > 0 && (
                <div className="panel-card">
                  <div className="panel-card-head">
                    <div><h3>Gebäude</h3></div>
                    <button className="btn-primary" style={{ fontSize: 12, padding: '5px 10px' }}
                      onClick={() => { setEditingId(null); setBuildingForm(emptyBuildingForm); setFormError(null); setShowBuildingModal(true); }}>
                      <Plus size={12} /> Neu
                    </button>
                  </div>
                  <div className="building-grid">
                    {siteBuildings.map(b => {
                      const bMeters = flatMeters.filter(m => m.building_id === b.id);
                      return (
                        <div key={b.id} className="building-card" onClick={() => handleBuildingNodeClick(b)}>
                          <div className="building-name">{b.name}</div>
                          <div className="building-attrs">
                            {b.building_type && <div className="row"><span className="l">Typ</span><span>{BUILDING_TYPES[b.building_type] || b.building_type}</span></div>}
                            {b.total_area_m2 && <div className="row"><span className="l">Fläche</span><span>{Number(b.total_area_m2).toLocaleString('de-DE')} m²</span></div>}
                            {b.building_year && <div className="row"><span className="l">Baujahr</span><span>{b.building_year}</span></div>}
                          </div>
                          <div className="building-foot">
                            <span>{b.usage_unit_count} NE</span>
                            <span className="ne-count">{bMeters.length} Zähler</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : selectedNode.type === 'unit' ? (() => {
            const unit = allSiteUnits.find((u) => u.id === selectedNode.id);
            const parentBuilding = siteBuildings.find((b) => b.id === selectedNode.buildingId);
            if (!unit) return null;
            return (
              <div className="entity-head">
                <div className="entity-crumb">
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--ink-3)', padding: 0 }}
                    onClick={() => setSelectedNode({ type: 'site' })}>{selectedSite.name}</button>
                  {parentBuilding && (
                    <>
                      <span style={{ color: 'var(--ink-4)' }}>›</span>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--ink-3)', padding: 0 }}
                        onClick={() => setSelectedNode({ type: 'building', id: parentBuilding.id })}>{parentBuilding.name}</button>
                    </>
                  )}
                  <span style={{ color: 'var(--ink-4)' }}>›</span>
                  <span style={{ color: 'var(--ink)' }}>{unit.name}</span>
                </div>
                <div className="entity-title-row">
                  <h2>{unit.name}</h2>
                  <span className="entity-kind">Nutzungseinheit</span>
                </div>
                <div className="entity-meta">
                  {unit.usage_type && <div className="item"><span className="item-label">Typ</span><span className="item-val">{unit.usage_type}</span></div>}
                  {unit.area_m2 != null && <div className="item"><span className="item-label">Fläche</span><span className="item-val">{Number(unit.area_m2).toLocaleString('de-DE')} m²</span></div>}
                  {unit.floor != null && <div className="item"><span className="item-label">Etage</span><span className="item-val">{unit.floor}</span></div>}
                  <div className="item"><span className="item-label">Zähler</span><span className="item-val">{panelMeters.length}</span></div>
                </div>
              </div>
            );
          })() : panelBuilding ? (
            <>
              {/* Gebäude Entity-Head */}
              <div className="entity-head">
                <div className="entity-crumb">
                  <button style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'var(--ink-3)', padding: 0 }}
                    onClick={() => setSelectedNode({ type: 'site' })}>{selectedSite.name}</button>
                  <span style={{ color: 'var(--ink-4)' }}>›</span>
                  <span style={{ color: 'var(--ink)' }}>{panelBuilding.name}</span>
                </div>
                <div className="entity-title-row">
                  <h2>{panelBuilding.name}</h2>
                  <span className="entity-kind">Gebäude</span>
                </div>
                <div className="entity-meta">
                  {panelBuilding.building_type && <div className="item"><span className="item-label">Typ</span><span className="item-val">{BUILDING_TYPES[panelBuilding.building_type] || panelBuilding.building_type}</span></div>}
                  {panelBuilding.total_area_m2 && <div className="item"><span className="item-label">Fläche</span><span className="item-val">{Number(panelBuilding.total_area_m2).toLocaleString('de-DE')} m²</span></div>}
                  {panelBuilding.building_year && <div className="item"><span className="item-label">Baujahr</span><span className="item-val">{panelBuilding.building_year}</span></div>}
                  <div className="item"><span className="item-label">NE</span><span className="item-val">{panelBuilding.usage_unit_count}</span></div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button className="btn-primary" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', fontSize: 11, padding: '4px 10px' }}
                    onClick={() => { setEditingId(panelBuilding.id); setBuildingForm({ name: panelBuilding.name, building_type: panelBuilding.building_type || '', building_year: panelBuilding.building_year?.toString() || '', total_area_m2: panelBuilding.total_area_m2?.toString() || '', heated_area_m2: panelBuilding.heated_area_m2?.toString() || '', cooled_area_m2: panelBuilding.cooled_area_m2?.toString() || '', floors: panelBuilding.floors?.toString() || '', energy_certificate_class: panelBuilding.energy_certificate_class || '' }); setFormError(null); setShowBuildingModal(true); }}>
                    Bearbeiten
                  </button>
                  {panelBuildingUnits.length > 0 && (
                    <button className="btn-primary" style={{ background: 'var(--surface)', color: 'var(--ink)', border: '1px solid var(--line)', fontSize: 11, padding: '4px 10px' }}
                      onClick={() => { setEditingId(null); setUnitForm(emptyUnitForm); setFormError(null); setShowUnitModal(true); }}>
                      + NE
                    </button>
                  )}
                  <button className="btn-primary" style={{ background: 'var(--surface)', color: 'var(--alert)', border: '1px solid var(--line)', fontSize: 11, padding: '4px 10px' }}
                    onClick={() => handleDeleteBuilding(panelBuilding)}>Löschen</button>
                </div>
              </div>

              {/* Sankey Energieart → NE (wenn geladen) */}
              {bldgFlows.length > 0 && panelBuildingUnits.length > 0 && (
                <div className="panel-card">
                  <div className="panel-card-head">
                    <div>
                      <h3>Energiefluss · {panelBuilding.name}</h3>
                      <div className="panel-card-sub">Zähler nach Energieart und Nutzungseinheit</div>
                    </div>
                  </div>
                  <div className="sankey-wrap">
                    <Sankey
                      sources={activeDefs.filter(d => bldgFlows.some(f => f.source === d.key)).map(d => ({ id: d.key, label: d.label, color: d.color }))}
                      targets={panelBuildingUnits.map(u => ({ id: u.id, label: u.name }))}
                      flows={bldgFlows}
                      height={Math.max(140, panelBuildingUnits.length * 36 + 60)}
                      width={560} labelLeft={100} labelRight={120}
                    />
                    <div className="sankey-foot">
                      <span className="lhs">Energieart</span>
                      <span className="rhs">Nutzungseinheit</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}

          {/* Zähler-Liste (gemeinsam für Standort- und Gebäude-Panel) */}
          <div className="panel-card">
            <div className="panel-card-head">
              <div>
                <h3>Zähler</h3>
                <div className="panel-card-sub">
                  {filteredPanelMeters.length} von {panelMeters.length}
                  {selectedNode.type === 'building' && panelBuilding ? ` · ${panelBuilding.name}` : ''}
                  {selectedNode.type === 'unit' ? (() => {
                    const u = allSiteUnits.find((x) => x.id === selectedNode.id);
                    return u ? ` · ${u.name}` : '';
                  })() : ''}
                </div>
              </div>
              <button className="btn-primary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={openNewMeter}>
                <Plus size={12} /> Neu
              </button>
            </div>

            {filterDefs.length > 1 && (
              <div className="meter-filter-bar">
                <button className={`filter-pill${meterEnergyFilter === '' ? ' active' : ''}`}
                  onClick={() => setMeterEnergyFilter('')}>
                  Alle <span className="count">{panelMeters.length}</span>
                </button>
                {filterDefs.map(d => {
                  const cnt = panelMeters.filter(m => m.energy_type === d.key).length;
                  if (cnt === 0) return null;
                  return (
                    <button key={d.key} className={`filter-pill${meterEnergyFilter === d.key ? ' active' : ''}`}
                      onClick={() => setMeterEnergyFilter(meterEnergyFilter === d.key ? '' : d.key)}>
                      {meterEnergyFilter !== d.key && <span className="dot" style={{ background: d.color }} />}
                      {d.label} <span className="count">{cnt}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="banner" style={{ margin: '12px 18px 0' }}>
              <span>Zähler-Hierarchie unter</span>
              <a href="/meters" onClick={e => { e.preventDefault(); navigate('/meters'); }}>
                Zähler → Physikalisches Netzwerk
              </a>
            </div>

            {detailLoading ? (
              <div style={{ padding: 24 }}><LoadingSpinner text="Zähler werden geladen" /></div>
            ) : filteredPanelMeters.length === 0 ? (
              <div className="empty">
                <strong>Keine Zähler</strong>
                {meterEnergyFilter ? 'Keine Zähler für diese Energieart.' : 'Diesem Standort sind noch keine Zähler zugewiesen.'}
              </div>
            ) : (
              <div className="meter-list">
                {filteredPanelMeters.map(m => {
                  const color = getEnergyColor(m.energy_type);
                  const label = ENERGY_TYPE_LABELS[m.energy_type as keyof typeof ENERGY_TYPE_LABELS] || m.energy_type;
                  return (
                    <div key={m.id} className={`meter-row${m.cross_site_boundary ? ' foreign' : ''}`}>
                      <div className="stripe" style={{ background: color }} />
                      <div className="meter-main">
                        <span className="meter-name" title={m.display_name ? `${m.name} · ${m.display_name}` : m.name}>{m.name}</span>
                        {m.cross_site_boundary && <span className="meter-belongs">↗ gehört zu: {m.owner_site_name ?? 'Anderer Standort'}</span>}
                        {m.meter_number && <span className="meter-num">{m.meter_number}</span>}
                      </div>
                      <div className="meter-energy" style={{ background: color + '22', color: 'var(--ink-2)', border: `1px solid ${color}55` }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
                        {label}
                      </div>
                      <span className="meter-source">{DATA_SOURCE_LABELS[m.data_source] || m.data_source}</span>
                      <div className="meter-row-actions">
                        {!m.cross_site_boundary && (
                          <>
                            <button onClick={() => openEditMeter(m)} title="Bearbeiten"><Settings size={12} /></button>
                            <button onClick={() => handlePollMeter(m)} title="Abfragen"><Activity size={12} /></button>
                            {m.data_source === 'shelly' && <button onClick={() => handleTestConnection(m)} title="Verbindung testen"><Wifi size={12} /></button>}
                            <button onClick={() => handleDeleteMeter(m)} title="Löschen" style={{ color: 'var(--alert)' }}><Trash2 size={12} /></button>
                          </>
                        )}
                        <a href={`/readings?meter_id=${m.id}`}
                          onClick={e => { e.preventDefault(); navigate(`/readings?meter_id=${m.id}`); }}
                          style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'underline', paddingLeft: 2 }}>
                          Werte
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
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
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowBuildingModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showUnitModal && selectedBuilding && (
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
                <div><label className="label">Etage</label><input type="text" className="input" value={unitForm.floor} onChange={e => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="EG, 1. OG…" /></div>
                <div><label className="label">Fläche (m²)</label><input type="number" step="0.01" className="input" value={unitForm.area_m2} onChange={e => setUnitForm({ ...unitForm, area_m2: e.target.value })} /></div>
                <div><label className="label">Personen</label><input type="number" className="input" value={unitForm.occupants} onChange={e => setUnitForm({ ...unitForm, occupants: e.target.value })} /></div>
              </div>
              <div><label className="label">Mieter</label><input type="text" className="input" value={unitForm.tenant_name} onChange={e => setUnitForm({ ...unitForm, tenant_name: e.target.value })} /></div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowUnitModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMeterModal && (
        <MeterModal form={meterForm} setForm={setMeterForm} editingId={editingMeterId}
          onSubmit={handleSubmitMeter} onClose={() => setShowMeterModal(false)}
          error={meterFormError} saving={meterSaving}
          siteBuildings={siteBuildings} siteUnits={allSiteUnits} />
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
  onSubmit: (e: React.FormEvent) => void; onClose: () => void; error: string | null; saving: boolean;
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

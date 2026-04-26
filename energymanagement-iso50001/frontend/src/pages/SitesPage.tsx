import { useEffect, useState, useCallback } from 'react';
import { ChevronRight, Zap, Building2, Home } from 'lucide-react';
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

interface Meter {
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

const emptySiteForm: SiteForm = { name: '', street: '', zip_code: '', city: '', country: 'DE', latitude: '', longitude: '' };
const emptyBuildingForm: BuildingForm = { name: '', building_type: '', building_year: '', total_area_m2: '', heated_area_m2: '', cooled_area_m2: '', floors: '', energy_certificate_class: '' };
const emptyUnitForm: UnitForm = { name: '', usage_type: 'office', floor: '', area_m2: '', occupants: '', tenant_name: '' };

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
  knx: 'KNX', homeassistant: 'Home Assistant', spie: 'SPIE',
};

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

// ── Zähler-Baum ──

interface MeterTreeNode extends Meter { children: MeterTreeNode[]; }

function buildTree(meters: Meter[]): MeterTreeNode[] {
  const map = new Map<string, MeterTreeNode>();
  for (const m of meters) map.set(m.id, { ...m, children: [] });
  const roots: MeterTreeNode[] = [];
  for (const node of map.values()) {
    if (node.parent_meter_id && map.has(node.parent_meter_id))
      map.get(node.parent_meter_id)!.children.push(node);
    else roots.push(node);
  }
  const sort = (ns: MeterTreeNode[]) => { ns.sort((a, b) => a.name.localeCompare(b.name)); ns.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

function MeterTreeRow({ node, depth = 0 }: { node: MeterTreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 1);
  const hasChildren = node.children.length > 0;
  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren
              ? <button onClick={() => setOpen(!open)} className="mr-1.5 text-gray-400 hover:text-gray-600 flex-shrink-0">
                  <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
                </button>
              : <span className="mr-1.5 w-4 inline-block flex-shrink-0" />}
            <span className="font-medium text-gray-900 truncate max-w-xs" title={node.name}>{node.name}</span>
            {node.meter_number && <span className="ml-2 text-xs text-gray-400 font-mono">{node.meter_number}</span>}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ENERGY_COLORS[node.energy_type] || 'bg-gray-100 text-gray-700'}`}>
            {ENERGY_TYPE_LABELS[node.energy_type as keyof typeof ENERGY_TYPE_LABELS] || node.energy_type}
          </span>
        </td>
        <td className="px-4 py-2.5 text-sm text-gray-500">
          {DATA_SOURCE_LABELS[node.data_source] || node.data_source}
          {node.is_virtual && <span className="ml-1 text-xs text-purple-600">(Virtuell)</span>}
          {node.is_feed_in && <span className="ml-1 text-xs text-green-600">(Einspeisung)</span>}
        </td>
        <td className="px-4 py-2.5 text-xs text-gray-400 text-right">
          {hasChildren && `${node.children.length} Unterzähler`}
        </td>
        <td className="px-4 py-2.5 text-right">
          <a href={`/readings?meter_id=${node.id}`}
            onClick={e => { e.preventDefault(); window.location.href = `/readings?meter_id=${node.id}`; }}
            className="text-xs text-primary-600 hover:text-primary-800">Messwerte</a>
        </td>
      </tr>
      {open && node.children.map(child => <MeterTreeRow key={child.id} node={child} depth={depth + 1} />)}
    </>
  );
}

// ── Hauptkomponente ──

export default function SitesPage() {
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
  const [siteMeters, setSiteMeters] = useState<Meter[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'meters' | 'buildings'>('meters');
  const [meterEnergyFilter, setMeterEnergyFilter] = useState<string>('');

  // Modals
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [showBuildingModal, setShowBuildingModal] = useState(false);
  const [showUnitModal, setShowUnitModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<SiteForm>(emptySiteForm);
  const [buildingForm, setBuildingForm] = useState<BuildingForm>(emptyBuildingForm);
  const [unitForm, setUnitForm] = useState<UnitForm>(emptyUnitForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  const loadSiteDetail = async (site: Site) => {
    setSelectedSite(site);
    setSelectedBuilding(null);
    setDetailLoading(true);
    setSiteBuildings([]);
    setSiteMeters([]);
    setMeterEnergyFilter('');
    try {
      const [buildingsRes, metersRes] = await Promise.all([
        apiClient.get<Building[]>(`/api/v1/sites/${site.id}/buildings`),
        apiClient.get<PaginatedResponse<Meter>>(`/api/v1/meters?site_id=${site.id}&page_size=500`),
      ]);
      setSiteBuildings(buildingsRes.data);
      setSiteMeters(metersRes.data.items);
    } catch { /* Interceptor */ } finally { setDetailLoading(false); }
  };

  const loadBuildingDetail = async (siteId: string, buildingId: string) => {
    try {
      const res = await apiClient.get(`/api/v1/sites/${siteId}/buildings/${buildingId}`);
      setSelectedBuilding(res.data);
    } catch { /* Interceptor */ }
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
      if (editingId) {
        await apiClient.put(`/api/v1/sites/${selectedSite.id}/buildings/${editingId}`, data);
      } else {
        data.site_id = selectedSite.id;
        await apiClient.post(`/api/v1/sites/${selectedSite.id}/buildings`, data);
      }
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
      if (editingId) {
        await apiClient.put(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units/${editingId}`, data);
      } else {
        data.building_id = selectedBuilding.id;
        await apiClient.post(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units`, data);
      }
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

  // ── Breadcrumb ──

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
      <button className={`hover:text-primary-600 ${!selectedSite ? 'font-semibold text-gray-900' : ''}`}
        onClick={() => { setSelectedSite(null); setSelectedBuilding(null); }}>Standorte</button>
      {selectedSite && (
        <>
          <span>/</span>
          <button className={`hover:text-primary-600 ${!selectedBuilding ? 'font-semibold text-gray-900' : ''}`}
            onClick={() => setSelectedBuilding(null)}>{selectedSite.name}</button>
        </>
      )}
      {selectedBuilding && (
        <>
          <span>/</span>
          <span className="font-semibold text-gray-900">{selectedBuilding.name}</span>
        </>
      )}
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
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
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
                {sites.map((site) => (
                  <tr key={site.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadSiteDetail(site)}>
                    <td className="px-4 py-3 font-medium text-primary-600">{site.name}</td>
                    <td className="px-4 py-3 text-gray-500">{site.city || '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{site.zip_code || '–'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        {site.building_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                        {site.meter_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      <button onClick={() => { setEditingId(site.id); setSiteForm({ name: site.name, street: site.street || '', zip_code: site.zip_code || '', city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '', longitude: site.longitude?.toString() || '' }); setFormError(null); setShowSiteModal(true); }}
                        className="mr-2 text-primary-600 hover:text-primary-800">Bearbeiten</button>
                      <button onClick={(e) => handleDeleteSite(site, e)} className="text-red-500 hover:text-red-700">Löschen</button>
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

        {/* Kacheln */}
        <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
          <div className="card p-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Zähler</p>
            <p className="text-2xl font-bold text-primary-700 mt-1">{siteMeters.length || selectedSite.meter_count}</p>
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
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 mb-4 gap-1">
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'meters' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('meters')}
          >
            <Zap className="w-4 h-4" /> Zähler ({siteMeters.length || selectedSite.meter_count})
          </button>
          <button
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${activeTab === 'buildings' ? 'border-primary-600 text-primary-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('buildings')}
          >
            <Building2 className="w-4 h-4" /> Gebäude ({siteBuildings.length})
          </button>
        </div>

        {/* Tab: Zähler */}
        {activeTab === 'meters' && (() => {
          const energyTypes = [...new Set(siteMeters.map(m => m.energy_type))].sort();
          const filtered = meterEnergyFilter
            ? siteMeters.filter(m => m.energy_type === meterEnergyFilter)
            : siteMeters;
          const tree = buildTree(filtered);
          return (
            <div>
              {/* Energieart-Filter */}
              {!detailLoading && siteMeters.length > 0 && energyTypes.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  <button
                    onClick={() => setMeterEnergyFilter('')}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      meterEnergyFilter === ''
                        ? 'bg-primary-600 text-white border-primary-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-primary-400'
                    }`}
                  >
                    Alle ({siteMeters.length})
                  </button>
                  {energyTypes.map(et => {
                    const count = siteMeters.filter(m => m.energy_type === et).length;
                    return (
                      <button
                        key={et}
                        onClick={() => setMeterEnergyFilter(et === meterEnergyFilter ? '' : et)}
                        className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                          meterEnergyFilter === et
                            ? 'bg-primary-600 text-white border-primary-600'
                            : 'bg-white border-gray-300 hover:border-primary-400 ' + (ENERGY_COLORS[et] || 'text-gray-600')
                        }`}
                      >
                        {ENERGY_TYPE_LABELS[et as keyof typeof ENERGY_TYPE_LABELS] || et} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="card overflow-hidden p-0">
                {detailLoading ? (
                  <div className="p-8 text-center text-gray-400">Zähler werden geladen...</div>
                ) : filtered.length === 0 ? (
                  <div className="p-8 text-center text-gray-400">
                    {siteMeters.length === 0
                      ? 'Diesem Standort sind keine aktiven Zähler zugewiesen.'
                      : 'Keine Zähler für diese Energieart.'}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                        <tr>
                          <th className="px-4 py-3 text-left">Name / Zählernummer</th>
                          <th className="px-4 py-3 text-left">Energieart</th>
                          <th className="px-4 py-3 text-left">Datenquelle</th>
                          <th className="px-4 py-3 text-right">Info</th>
                          <th className="px-4 py-3 text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {tree.map(node => <MeterTreeRow key={node.id} node={node} depth={0} />)}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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
              <div className="card p-8 text-center text-gray-400">
                Keine Gebäude vorhanden. Legen Sie das erste Gebäude an.
              </div>
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
                <div>
                  <label className="label">Name *</label>
                  <input type="text" className="input" value={buildingForm.name} onChange={e => setBuildingForm({ ...buildingForm, name: e.target.value })} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Gebäudetyp</label>
                    <select className="input" value={buildingForm.building_type} onChange={e => setBuildingForm({ ...buildingForm, building_type: e.target.value })}>
                      <option value="">– Wählen –</option>
                      {Object.entries(BUILDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Baujahr</label>
                    <input type="number" className="input" value={buildingForm.building_year} onChange={e => setBuildingForm({ ...buildingForm, building_year: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div><label className="label">Bruttofläche (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.total_area_m2} onChange={e => setBuildingForm({ ...buildingForm, total_area_m2: e.target.value })} /></div>
                  <div><label className="label">Beheizt (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.heated_area_m2} onChange={e => setBuildingForm({ ...buildingForm, heated_area_m2: e.target.value })} /></div>
                  <div><label className="label">Gekühlt (m²)</label><input type="number" step="0.01" className="input" value={buildingForm.cooled_area_m2} onChange={e => setBuildingForm({ ...buildingForm, cooled_area_m2: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">Stockwerke</label><input type="number" className="input" value={buildingForm.floors} onChange={e => setBuildingForm({ ...buildingForm, floors: e.target.value })} /></div>
                  <div>
                    <label className="label">Energieausweis-Klasse</label>
                    <select className="input" value={buildingForm.energy_certificate_class} onChange={e => setBuildingForm({ ...buildingForm, energy_certificate_class: e.target.value })}>
                      <option value="">– Keine –</option>
                      {['A+','A','B','C','D','E','F','G','H'].map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowBuildingModal(false)} className="btn-secondary">Abbrechen</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Gebäude-Detail (Nutzungseinheiten) ──

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
        <button onClick={() => { setEditingId(null); setUnitForm(emptyUnitForm); setFormError(null); setShowUnitModal(true); }}
          className="btn-primary">+ Neue Nutzungseinheit</button>
      </div>

      <div className="card mt-4 overflow-hidden p-0">
        {selectedBuilding.usage_units.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            <Home className="w-8 h-8 mx-auto mb-2 opacity-30" />
            Keine Nutzungseinheiten vorhanden.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Nutzungsart</th>
                <th className="px-4 py-3">Etage</th>
                <th className="px-4 py-3 text-right">Fläche (m²)</th>
                <th className="px-4 py-3 text-right">Personen</th>
                <th className="px-4 py-3">Mieter</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {selectedBuilding.usage_units.map(u => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{u.name}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {USAGE_TYPES[u.usage_type] || u.usage_type}
                    </span>
                  </td>
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

      {showUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'Nutzungseinheit bearbeiten' : 'Neue Nutzungseinheit'}</h2>
            <form onSubmit={handleSubmitUnit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div><label className="label">Name *</label><input type="text" className="input" value={unitForm.name} onChange={e => setUnitForm({ ...unitForm, name: e.target.value })} required autoFocus /></div>
                <div>
                  <label className="label">Nutzungsart *</label>
                  <select className="input" value={unitForm.usage_type} onChange={e => setUnitForm({ ...unitForm, usage_type: e.target.value })}>
                    {Object.entries(USAGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div><label className="label">Etage</label><input type="text" className="input" value={unitForm.floor} onChange={e => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="z.B. EG, 1. OG" /></div>
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
    </div>
  );
}

// ── Standort-Modal (ausgelagert) ──

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
          <div>
            <label className="label">Name *</label>
            <input type="text" className="input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2"><label className="label">Straße</label><input type="text" className="input" value={form.street} onChange={e => setForm({ ...form, street: e.target.value })} /></div>
            <div><label className="label">Land</label><input type="text" className="input" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label className="label">PLZ</label><input type="text" className="input" value={form.zip_code} onChange={e => setForm({ ...form, zip_code: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Stadt</label><input type="text" className="input" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Breitengrad</label><input type="number" step="any" className="input" value={form.latitude} onChange={e => setForm({ ...form, latitude: e.target.value })} placeholder="z.B. 53.5511" /></div>
            <div><label className="label">Längengrad</label><input type="number" step="any" className="input" value={form.longitude} onChange={e => setForm({ ...form, longitude: e.target.value })} placeholder="z.B. 9.9937" /></div>
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

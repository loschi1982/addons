import { useEffect, useState, useCallback } from 'react';
import { ChevronRight, Zap } from 'lucide-react';
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

interface SiteForm {
  name: string;
  street: string;
  zip_code: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
}

// Energietyp-Farben
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

const emptySiteForm: SiteForm = {
  name: '', street: '', zip_code: '', city: '', country: 'DE',
  latitude: '', longitude: '',
};

function cleanFormData(data: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    if (['latitude', 'longitude'].includes(key)) result[key] = parseFloat(value);
    else result[key] = value;
  }
  return result;
}

// ── Zähler-Baum-Hilfsfunktion ──

interface MeterTreeNode extends Meter {
  children: MeterTreeNode[];
}

function buildTree(meters: Meter[]): MeterTreeNode[] {
  const nodeMap = new Map<string, MeterTreeNode>();
  for (const m of meters) nodeMap.set(m.id, { ...m, children: [] });
  const roots: MeterTreeNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parent_meter_id && nodeMap.has(node.parent_meter_id)) {
      nodeMap.get(node.parent_meter_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  // Alphabetisch sortieren
  const sort = (nodes: MeterTreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

// ── Zähler-Baum-Komponente ──

function MeterTreeRow({ node, depth = 0 }: { node: MeterTreeNode; depth?: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;

  return (
    <>
      <tr className="hover:bg-gray-50">
        <td className="px-4 py-2.5">
          <div className="flex items-center" style={{ paddingLeft: `${depth * 20}px` }}>
            {hasChildren ? (
              <button
                onClick={() => setOpen(!open)}
                className="mr-1.5 text-gray-400 hover:text-gray-600 flex-shrink-0"
              >
                <ChevronRight className={`w-4 h-4 transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            ) : (
              <span className="mr-1.5 w-4 inline-block flex-shrink-0" />
            )}
            <span className="font-medium text-gray-900 truncate max-w-xs" title={node.name}>
              {node.name}
            </span>
            {node.meter_number && (
              <span className="ml-2 text-xs text-gray-400 font-mono">{node.meter_number}</span>
            )}
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
        <td className="px-4 py-2.5 text-sm text-gray-500 text-right">
          {hasChildren && (
            <span className="text-xs text-gray-400">{node.children.length} Unterzähler</span>
          )}
        </td>
        <td className="px-4 py-2.5 text-right">
          <a
            href={`/readings?meter_id=${node.id}`}
            onClick={(e) => { e.preventDefault(); window.location.href = `/readings?meter_id=${node.id}`; }}
            className="text-xs text-primary-600 hover:text-primary-800"
          >
            Messwerte
          </a>
        </td>
      </tr>
      {open && node.children.map((child) => (
        <MeterTreeRow key={child.id} node={child} depth={depth + 1} />
      ))}
    </>
  );
}

// ── Hauptkomponente ──

export default function SitesPage() {
  // Daten
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Detail-Ansicht
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [siteMeters, setSiteMeters] = useState<Meter[]>([]);
  const [metersLoading, setMetersLoading] = useState(false);

  // Modals
  const [showSiteModal, setShowSiteModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [siteForm, setSiteForm] = useState<SiteForm>(emptySiteForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

  // ── Daten laden ──

  const loadSites = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), page_size: pageSize.toString() });
      if (search) params.append('search', search);
      const response = await apiClient.get<PaginatedResponse<Site>>(`/api/v1/sites?${params}`);
      setSites(response.data.items);
      setTotal(response.data.total);
    } catch { /* Interceptor */ } finally { setLoading(false); }
  }, [page, search]);

  useEffect(() => { loadSites(); }, [loadSites]);

  const loadSiteDetail = async (site: Site) => {
    setSelectedSite(site);
    setMetersLoading(true);
    setSiteMeters([]);
    try {
      const res = await apiClient.get<PaginatedResponse<Meter>>(
        `/api/v1/meters?site_id=${site.id}&page_size=500&is_active=true`
      );
      setSiteMeters(res.data.items);
    } catch { /* Interceptor */ } finally { setMetersLoading(false); }
  };

  // ── Standort CRUD ──

  const handleCreateSite = () => {
    setEditingId(null); setSiteForm(emptySiteForm); setFormError(null); setShowSiteModal(true);
  };

  const handleEditSite = (site: Site, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(site.id);
    setSiteForm({
      name: site.name, street: site.street || '', zip_code: site.zip_code || '',
      city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '',
      longitude: site.longitude?.toString() || '',
    });
    setFormError(null); setShowSiteModal(true);
  };

  const handleDeleteSite = async (site: Site, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Standort "${site.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${site.id}`);
      loadSites();
      if (selectedSite?.id === site.id) setSelectedSite(null);
    } catch { /* Interceptor */ }
  };

  const handleSubmitSite = async (e: React.FormEvent) => {
    e.preventDefault(); setFormError(null); setSaving(true);
    try {
      const data = cleanFormData(siteForm as unknown as Record<string, string>);
      if (editingId) {
        await apiClient.put(`/api/v1/sites/${editingId}`, data);
      } else {
        await apiClient.post('/api/v1/sites', data);
      }
      setShowSiteModal(false);
      loadSites();
      if (selectedSite && editingId === selectedSite.id) {
        const refreshed = await apiClient.get<Site>(`/api/v1/sites/${editingId}`);
        setSelectedSite(refreshed.data);
      }
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const totalPages = Math.ceil(total / pageSize);
  const meterTree = buildTree(siteMeters);

  // ── Breadcrumb ──

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
      <button
        className={`hover:text-primary-600 ${!selectedSite ? 'font-semibold text-gray-900' : ''}`}
        onClick={() => setSelectedSite(null)}
      >
        Standorte
      </button>
      {selectedSite && (
        <>
          <span>/</span>
          <span className="font-semibold text-gray-900">{selectedSite.name}</span>
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
          <button onClick={handleCreateSite} className="btn-primary">+ Neuer Standort</button>
        </div>

        <div className="card mt-4">
          <input
            type="text" className="input w-full" placeholder="Suche nach Name, Stadt..."
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        <div className="card mt-4 overflow-hidden p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-400">Laden...</div>
          ) : sites.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              Keine Standorte gefunden. Legen Sie den ersten Standort an.
            </div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Stadt</th>
                  <th className="px-4 py-3">PLZ</th>
                  <th className="px-4 py-3 text-center">Zähler</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sites.map((site) => (
                  <tr
                    key={site.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => loadSiteDetail(site)}
                  >
                    <td className="px-4 py-3 font-medium text-primary-600">{site.name}</td>
                    <td className="px-4 py-3 text-gray-500">{site.city || '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{site.zip_code || '–'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                        {site.meter_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => handleEditSite(site, e)}
                        className="mr-2 text-primary-600 hover:text-primary-800"
                      >Bearbeiten</button>
                      <button
                        onClick={(e) => handleDeleteSite(site, e)}
                        className="text-red-500 hover:text-red-700"
                      >Löschen</button>
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

        {/* Modal: Standort */}
        {showSiteModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-bold">{editingId ? 'Standort bearbeiten' : 'Neuer Standort'}</h2>
              <form onSubmit={handleSubmitSite} className="space-y-4">
                {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
                <div>
                  <label className="label">Name *</label>
                  <input type="text" className="input" value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} required autoFocus />
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="label">Straße</label>
                    <input type="text" className="input" value={siteForm.street} onChange={(e) => setSiteForm({ ...siteForm, street: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Land</label>
                    <input type="text" className="input" value={siteForm.country} onChange={(e) => setSiteForm({ ...siteForm, country: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">PLZ</label>
                    <input type="text" className="input" value={siteForm.zip_code} onChange={(e) => setSiteForm({ ...siteForm, zip_code: e.target.value })} />
                  </div>
                  <div className="col-span-2">
                    <label className="label">Stadt</label>
                    <input type="text" className="input" value={siteForm.city} onChange={(e) => setSiteForm({ ...siteForm, city: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Breitengrad</label>
                    <input type="number" step="any" className="input" value={siteForm.latitude} onChange={(e) => setSiteForm({ ...siteForm, latitude: e.target.value })} placeholder="z.B. 53.5511" />
                  </div>
                  <div>
                    <label className="label">Längengrad</label>
                    <input type="number" step="any" className="input" value={siteForm.longitude} onChange={(e) => setSiteForm({ ...siteForm, longitude: e.target.value })} placeholder="z.B. 9.9937" />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowSiteModal(false)} className="btn-secondary">Abbrechen</button>
                  <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : editingId ? 'Speichern' : 'Anlegen'}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Render: Standort-Detail mit Zähler-Baum ──

  return (
    <div>
      {breadcrumb}

      {/* Kopfzeile */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="page-title">{selectedSite.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {[selectedSite.zip_code, selectedSite.city].filter(Boolean).join(' ')}
            {selectedSite.street && ` · ${selectedSite.street}`}
          </p>
        </div>
        <button onClick={(e) => handleEditSite(selectedSite, e)} className="btn-secondary">
          Standort bearbeiten
        </button>
      </div>

      {/* Info-Karten */}
      <div className="grid grid-cols-2 gap-4 mb-6 sm:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Zähler</p>
          <p className="text-2xl font-bold text-primary-700 mt-1">{selectedSite.meter_count}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">CO₂-Region</p>
          <p className="text-lg font-semibold text-gray-700 mt-1">{selectedSite.co2_region || '–'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Zeitzone</p>
          <p className="text-sm font-semibold text-gray-700 mt-1">{selectedSite.timezone}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Land</p>
          <p className="text-lg font-semibold text-gray-700 mt-1">{selectedSite.country}</p>
        </div>
      </div>

      {/* Zähler-Baum */}
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-5 h-5 text-primary-600" />
        <h2 className="text-base font-semibold text-gray-800">
          Zähler ({siteMeters.length})
        </h2>
      </div>

      <div className="card overflow-hidden p-0">
        {metersLoading ? (
          <div className="p-8 text-center text-gray-400">Zähler werden geladen...</div>
        ) : siteMeters.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Diesem Standort sind keine aktiven Zähler zugewiesen.
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
                  <th className="px-4 py-3 text-right">Link</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {meterTree.map((node) => (
                  <MeterTreeRow key={node.id} node={node} depth={0} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Standort bearbeiten */}
      {showSiteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Standort bearbeiten</h2>
            <form onSubmit={handleSubmitSite} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div>
                <label className="label">Name *</label>
                <input type="text" className="input" value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} required autoFocus />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="label">Straße</label>
                  <input type="text" className="input" value={siteForm.street} onChange={(e) => setSiteForm({ ...siteForm, street: e.target.value })} />
                </div>
                <div>
                  <label className="label">Land</label>
                  <input type="text" className="input" value={siteForm.country} onChange={(e) => setSiteForm({ ...siteForm, country: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">PLZ</label>
                  <input type="text" className="input" value={siteForm.zip_code} onChange={(e) => setSiteForm({ ...siteForm, zip_code: e.target.value })} />
                </div>
                <div className="col-span-2">
                  <label className="label">Stadt</label>
                  <input type="text" className="input" value={siteForm.city} onChange={(e) => setSiteForm({ ...siteForm, city: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Breitengrad</label>
                  <input type="number" step="any" className="input" value={siteForm.latitude} onChange={(e) => setSiteForm({ ...siteForm, latitude: e.target.value })} />
                </div>
                <div>
                  <label className="label">Längengrad</label>
                  <input type="number" step="any" className="input" value={siteForm.longitude} onChange={(e) => setSiteForm({ ...siteForm, longitude: e.target.value })} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowSiteModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Speichern...' : 'Speichern'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

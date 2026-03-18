import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';

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

interface SiteForm {
  name: string;
  street: string;
  zip_code: string;
  city: string;
  country: string;
  latitude: string;
  longitude: string;
}

interface BuildingForm {
  name: string;
  building_type: string;
  building_year: string;
  total_area_m2: string;
  heated_area_m2: string;
  cooled_area_m2: string;
  floors: string;
  energy_certificate_class: string;
}

interface UnitForm {
  name: string;
  usage_type: string;
  floor: string;
  area_m2: string;
  occupants: string;
  tenant_name: string;
}

const emptySiteForm: SiteForm = {
  name: '', street: '', zip_code: '', city: '', country: 'DE',
  latitude: '', longitude: '',
};

const emptyBuildingForm: BuildingForm = {
  name: '', building_type: '', building_year: '', total_area_m2: '',
  heated_area_m2: '', cooled_area_m2: '', floors: '', energy_certificate_class: '',
};

const emptyUnitForm: UnitForm = {
  name: '', usage_type: 'office', floor: '', area_m2: '', occupants: '', tenant_name: '',
};

const BUILDING_TYPES: Record<string, string> = {
  office: 'Buero', residential: 'Wohnen', production: 'Produktion',
  retail: 'Einzelhandel', warehouse: 'Lager', school: 'Schule',
  hospital: 'Krankenhaus', hotel: 'Hotel', other: 'Sonstige',
};

const USAGE_TYPES: Record<string, string> = {
  office: 'Buero', server_room: 'Serverraum', workshop: 'Werkstatt',
  apartment: 'Wohnung', retail: 'Verkaufsflaeche', storage: 'Lager',
  common_area: 'Allgemeinflaeche', parking: 'Parkhaus/TG', other: 'Sonstige',
};

// ── Hilfsfunktionen ──

function cleanFormData(data: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === '') continue;
    if (['latitude', 'longitude', 'total_area_m2', 'heated_area_m2', 'cooled_area_m2', 'area_m2'].includes(key)) {
      result[key] = parseFloat(value);
    } else if (['building_year', 'floors', 'occupants'].includes(key)) {
      result[key] = parseInt(value, 10);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Komponente ──

export default function SitesPage() {
  // Daten
  const [sites, setSites] = useState<Site[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Detail-Ansicht
  const [selectedSite, setSelectedSite] = useState<(Site & { buildings: Building[] }) | null>(null);
  const [selectedBuilding, setSelectedBuilding] = useState<(Building & { usage_units: UsageUnit[] }) | null>(null);

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

  const loadSiteDetail = async (siteId: string) => {
    try {
      const response = await apiClient.get(`/api/v1/sites/${siteId}`);
      setSelectedSite(response.data);
      setSelectedBuilding(null);
    } catch { /* Interceptor */ }
  };

  const loadBuildingDetail = async (siteId: string, buildingId: string) => {
    try {
      const response = await apiClient.get(`/api/v1/sites/${siteId}/buildings/${buildingId}`);
      setSelectedBuilding(response.data);
    } catch { /* Interceptor */ }
  };

  // ── Standort CRUD ──

  const handleCreateSite = () => {
    setEditingId(null); setSiteForm(emptySiteForm); setFormError(null); setShowSiteModal(true);
  };

  const handleEditSite = (site: Site) => {
    setEditingId(site.id);
    setSiteForm({
      name: site.name, street: site.street || '', zip_code: site.zip_code || '',
      city: site.city || '', country: site.country, latitude: site.latitude?.toString() || '',
      longitude: site.longitude?.toString() || '',
    });
    setFormError(null); setShowSiteModal(true);
  };

  const handleDeleteSite = async (site: Site) => {
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
      setShowSiteModal(false); loadSites();
      if (selectedSite && editingId === selectedSite.id) loadSiteDetail(editingId);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  // ── Gebaeude CRUD ──

  const handleCreateBuilding = () => {
    setEditingId(null); setBuildingForm(emptyBuildingForm); setFormError(null); setShowBuildingModal(true);
  };

  const handleEditBuilding = (b: Building) => {
    setEditingId(b.id);
    setBuildingForm({
      name: b.name, building_type: b.building_type || '', building_year: b.building_year?.toString() || '',
      total_area_m2: b.total_area_m2?.toString() || '', heated_area_m2: b.heated_area_m2?.toString() || '',
      cooled_area_m2: b.cooled_area_m2?.toString() || '', floors: b.floors?.toString() || '',
      energy_certificate_class: b.energy_certificate_class || '',
    });
    setFormError(null); setShowBuildingModal(true);
  };

  const handleDeleteBuilding = async (b: Building) => {
    if (!selectedSite || !confirm(`Gebaeude "${b.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${selectedSite.id}/buildings/${b.id}`);
      loadSiteDetail(selectedSite.id);
      if (selectedBuilding?.id === b.id) setSelectedBuilding(null);
    } catch { /* Interceptor */ }
  };

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
      setShowBuildingModal(false); loadSiteDetail(selectedSite.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  // ── Nutzungseinheit CRUD ──

  const handleCreateUnit = () => {
    setEditingId(null); setUnitForm(emptyUnitForm); setFormError(null); setShowUnitModal(true);
  };

  const handleDeleteUnit = async (u: UsageUnit) => {
    if (!selectedSite || !selectedBuilding || !confirm(`Nutzungseinheit "${u.name}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units/${u.id}`);
      loadBuildingDetail(selectedSite.id, selectedBuilding.id);
    } catch { /* Interceptor */ }
  };

  const handleSubmitUnit = async (e: React.FormEvent) => {
    e.preventDefault(); if (!selectedSite || !selectedBuilding) return;
    setFormError(null); setSaving(true);
    try {
      const data = cleanFormData(unitForm as unknown as Record<string, string>);
      if (editingId) {
        await apiClient.put(
          `/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units/${editingId}`, data
        );
      } else {
        data.building_id = selectedBuilding.id;
        await apiClient.post(
          `/api/v1/sites/${selectedSite.id}/buildings/${selectedBuilding.id}/units`, data
        );
      }
      setShowUnitModal(false); loadBuildingDetail(selectedSite.id, selectedBuilding.id);
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Speichern');
    } finally { setSaving(false); }
  };

  const totalPages = Math.ceil(total / pageSize);

  // ── Breadcrumb-Navigation ──

  const breadcrumb = (
    <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
      <button
        className={`hover:text-primary-600 ${!selectedSite ? 'font-semibold text-gray-900' : ''}`}
        onClick={() => { setSelectedSite(null); setSelectedBuilding(null); }}
      >
        Standorte
      </button>
      {selectedSite && (
        <>
          <span>/</span>
          <button
            className={`hover:text-primary-600 ${!selectedBuilding ? 'font-semibold text-gray-900' : ''}`}
            onClick={() => setSelectedBuilding(null)}
          >
            {selectedSite.name}
          </button>
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
                  <th className="px-4 py-3 text-center">Gebaeude</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {sites.map((site) => (
                  <tr key={site.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => loadSiteDetail(site.id)}>
                    <td className="px-4 py-3 font-medium text-primary-600">{site.name}</td>
                    <td className="px-4 py-3 text-gray-500">{site.city || '–'}</td>
                    <td className="px-4 py-3 text-gray-500">{site.zip_code || '–'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                        {site.building_count}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => handleEditSite(site)} className="mr-2 text-primary-600 hover:text-primary-800">Bearbeiten</button>
                      <button onClick={() => handleDeleteSite(site)} className="text-red-500 hover:text-red-700">Loeschen</button>
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
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurueck</button>
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
                    <label className="label">Strasse</label>
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
                    <input type="number" step="any" className="input" value={siteForm.latitude} onChange={(e) => setSiteForm({ ...siteForm, latitude: e.target.value })} placeholder="z.B. 48.1351" />
                  </div>
                  <div>
                    <label className="label">Laengengrad</label>
                    <input type="number" step="any" className="input" value={siteForm.longitude} onChange={(e) => setSiteForm({ ...siteForm, longitude: e.target.value })} placeholder="z.B. 11.5820" />
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

  // ── Render: Standort-Detail (Gebaeude-Liste) ──

  if (!selectedBuilding) {
    return (
      <div>
        {breadcrumb}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{selectedSite.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {selectedSite.city && `${selectedSite.zip_code} ${selectedSite.city}`}
              {selectedSite.street && ` · ${selectedSite.street}`}
            </p>
          </div>
          <button onClick={handleCreateBuilding} className="btn-primary">+ Neues Gebaeude</button>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {selectedSite.buildings.length === 0 ? (
            <div className="card col-span-full text-center text-gray-400 py-8">
              Keine Gebaeude vorhanden. Legen Sie das erste Gebaeude an.
            </div>
          ) : (
            selectedSite.buildings.map((b) => (
              <div
                key={b.id}
                className="card cursor-pointer hover:border-primary-300 transition-colors"
                onClick={() => loadBuildingDetail(selectedSite.id, b.id)}
              >
                <h3 className="font-semibold text-primary-700">{b.name}</h3>
                <div className="mt-2 space-y-1 text-sm text-gray-500">
                  {b.building_type && <p>Typ: {BUILDING_TYPES[b.building_type] || b.building_type}</p>}
                  {b.total_area_m2 && <p>Flaeche: {Number(b.total_area_m2).toLocaleString('de-DE')} m²</p>}
                  {b.building_year && <p>Baujahr: {b.building_year}</p>}
                  <p className="text-xs">{b.usage_unit_count} Nutzungseinheit(en)</p>
                </div>
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => handleEditBuilding(b)} className="text-xs text-primary-600 hover:text-primary-800">Bearbeiten</button>
                  <button onClick={() => handleDeleteBuilding(b)} className="text-xs text-red-500 hover:text-red-700">Loeschen</button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal: Gebaeude */}
        {showBuildingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
              <h2 className="mb-4 text-lg font-bold">{editingId ? 'Gebaeude bearbeiten' : 'Neues Gebaeude'}</h2>
              <form onSubmit={handleSubmitBuilding} className="space-y-4">
                {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
                <div>
                  <label className="label">Name *</label>
                  <input type="text" className="input" value={buildingForm.name} onChange={(e) => setBuildingForm({ ...buildingForm, name: e.target.value })} required autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Gebaeudetyp</label>
                    <select className="input" value={buildingForm.building_type} onChange={(e) => setBuildingForm({ ...buildingForm, building_type: e.target.value })}>
                      <option value="">-- Waehlen --</option>
                      {Object.entries(BUILDING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">Baujahr</label>
                    <input type="number" className="input" value={buildingForm.building_year} onChange={(e) => setBuildingForm({ ...buildingForm, building_year: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">Bruttoflaeche (m²)</label>
                    <input type="number" step="0.01" className="input" value={buildingForm.total_area_m2} onChange={(e) => setBuildingForm({ ...buildingForm, total_area_m2: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Beheizt (m²)</label>
                    <input type="number" step="0.01" className="input" value={buildingForm.heated_area_m2} onChange={(e) => setBuildingForm({ ...buildingForm, heated_area_m2: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Gekuehlt (m²)</label>
                    <input type="number" step="0.01" className="input" value={buildingForm.cooled_area_m2} onChange={(e) => setBuildingForm({ ...buildingForm, cooled_area_m2: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">Stockwerke</label>
                    <input type="number" className="input" value={buildingForm.floors} onChange={(e) => setBuildingForm({ ...buildingForm, floors: e.target.value })} />
                  </div>
                  <div>
                    <label className="label">Energieausweis-Klasse</label>
                    <select className="input" value={buildingForm.energy_certificate_class} onChange={(e) => setBuildingForm({ ...buildingForm, energy_certificate_class: e.target.value })}>
                      <option value="">-- Keine --</option>
                      {['A+', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((c) => <option key={c} value={c}>{c}</option>)}
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

  // ── Render: Gebaeude-Detail (Nutzungseinheiten) ──

  return (
    <div>
      {breadcrumb}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">{selectedBuilding.name}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {selectedBuilding.building_type && (BUILDING_TYPES[selectedBuilding.building_type] || selectedBuilding.building_type)}
            {selectedBuilding.total_area_m2 && ` · ${Number(selectedBuilding.total_area_m2).toLocaleString('de-DE')} m²`}
            {selectedBuilding.building_year && ` · Baujahr ${selectedBuilding.building_year}`}
          </p>
        </div>
        <button onClick={handleCreateUnit} className="btn-primary">+ Neue Nutzungseinheit</button>
      </div>

      <div className="card mt-4 overflow-hidden p-0">
        {selectedBuilding.usage_units.length === 0 ? (
          <div className="p-8 text-center text-gray-400">
            Keine Nutzungseinheiten vorhanden. Legen Sie die erste Einheit an.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Nutzungsart</th>
                <th className="px-4 py-3">Etage</th>
                <th className="px-4 py-3 text-right">Flaeche (m²)</th>
                <th className="px-4 py-3 text-right">Personen</th>
                <th className="px-4 py-3">Mieter</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {selectedBuilding.usage_units.map((u) => (
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
                    <button
                      onClick={() => {
                        setEditingId(u.id);
                        setUnitForm({
                          name: u.name, usage_type: u.usage_type, floor: u.floor || '',
                          area_m2: u.area_m2?.toString() || '', occupants: u.occupants?.toString() || '',
                          tenant_name: u.tenant_name || '',
                        });
                        setFormError(null); setShowUnitModal(true);
                      }}
                      className="mr-2 text-primary-600 hover:text-primary-800"
                    >Bearbeiten</button>
                    <button onClick={() => handleDeleteUnit(u)} className="text-red-500 hover:text-red-700">Loeschen</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal: Nutzungseinheit */}
      {showUnitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">{editingId ? 'Nutzungseinheit bearbeiten' : 'Neue Nutzungseinheit'}</h2>
            <form onSubmit={handleSubmitUnit} className="space-y-4">
              {formError && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Name *</label>
                  <input type="text" className="input" value={unitForm.name} onChange={(e) => setUnitForm({ ...unitForm, name: e.target.value })} required autoFocus />
                </div>
                <div>
                  <label className="label">Nutzungsart *</label>
                  <select className="input" value={unitForm.usage_type} onChange={(e) => setUnitForm({ ...unitForm, usage_type: e.target.value })}>
                    {Object.entries(USAGE_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="label">Etage</label>
                  <input type="text" className="input" value={unitForm.floor} onChange={(e) => setUnitForm({ ...unitForm, floor: e.target.value })} placeholder="z.B. EG, 1. OG" />
                </div>
                <div>
                  <label className="label">Flaeche (m²)</label>
                  <input type="number" step="0.01" className="input" value={unitForm.area_m2} onChange={(e) => setUnitForm({ ...unitForm, area_m2: e.target.value })} />
                </div>
                <div>
                  <label className="label">Personen</label>
                  <input type="number" className="input" value={unitForm.occupants} onChange={(e) => setUnitForm({ ...unitForm, occupants: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">Mieter</label>
                <input type="text" className="input" value={unitForm.tenant_name} onChange={(e) => setUnitForm({ ...unitForm, tenant_name: e.target.value })} />
              </div>
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

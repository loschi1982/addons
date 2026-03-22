/**
 * useSiteHierarchy – Hook für kaskadierende Standort/Gebäude/Nutzungseinheit-Auswahl.
 *
 * Lädt Standorte, Gebäude (gefiltert nach Standort) und Nutzungseinheiten
 * (gefiltert nach Gebäude) automatisch nach.
 *
 * Unterstützt Initialisierung auf jeder Ebene:
 * - initialUnitId → löst Standort + Gebäude + Einheit auf
 * - initialBuildingId → löst Standort + Gebäude auf
 * - initialSiteId → setzt nur den Standort
 */

import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';

interface SiteOption {
  id: string;
  name: string;
}

interface BuildingOption {
  id: string;
  name: string;
  site_id: string;
}

interface UnitOption {
  id: string;
  name: string;
  building_id: string;
  usage_type: string;
}

interface InitialIds {
  siteId?: string | null;
  buildingId?: string | null;
  unitId?: string | null;
}

interface SiteHierarchyState {
  sites: SiteOption[];
  buildings: BuildingOption[];
  units: UnitOption[];
  selectedSiteId: string;
  selectedBuildingId: string;
  selectedUnitId: string;
  setSelectedSiteId: (id: string) => void;
  setSelectedBuildingId: (id: string) => void;
  setSelectedUnitId: (id: string) => void;
  loading: boolean;
}

export function useSiteHierarchy(initial?: InitialIds | string | null): SiteHierarchyState {
  // Rückwärtskompatibilität: wenn ein String übergeben wird, ist es eine unitId
  const initialIds: InitialIds = typeof initial === 'string'
    ? { unitId: initial }
    : (initial || {});

  const [sites, setSites] = useState<SiteOption[]>([]);
  const [buildings, setBuildings] = useState<BuildingOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [selectedSiteId, setSelectedSiteId] = useState('');
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState('');
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Standorte laden
  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get('/api/v1/sites?page_size=100');
        const items = (res.data.items || []).map((s: Record<string, unknown>) => ({
          id: s.id as string,
          name: s.name as string,
        }));
        setSites(items);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Gebäude laden wenn Standort gewählt
  useEffect(() => {
    if (!selectedSiteId) {
      setBuildings([]);
      return;
    }
    (async () => {
      try {
        const res = await apiClient.get(`/api/v1/sites/${selectedSiteId}`);
        const blds = (res.data.buildings || []).map((b: Record<string, unknown>) => ({
          id: b.id as string,
          name: b.name as string,
          site_id: selectedSiteId,
        }));
        setBuildings(blds);
      } catch {
        setBuildings([]);
      }
    })();
  }, [selectedSiteId]);

  // Nutzungseinheiten laden wenn Gebäude gewählt
  useEffect(() => {
    if (!selectedBuildingId || !selectedSiteId) {
      setUnits([]);
      return;
    }
    (async () => {
      try {
        const res = await apiClient.get(`/api/v1/sites/${selectedSiteId}/buildings/${selectedBuildingId}`);
        const u = (res.data.usage_units || []).map((unit: Record<string, unknown>) => ({
          id: unit.id as string,
          name: unit.name as string,
          building_id: selectedBuildingId,
          usage_type: (unit.usage_type as string) || '',
        }));
        setUnits(u);
      } catch {
        setUnits([]);
      }
    })();
  }, [selectedSiteId, selectedBuildingId]);

  // Kaskade: Gebäude zurücksetzen wenn Standort wechselt
  const handleSiteChange = useCallback((id: string) => {
    setSelectedSiteId(id);
    setSelectedBuildingId('');
    setSelectedUnitId('');
  }, []);

  const handleBuildingChange = useCallback((id: string) => {
    setSelectedBuildingId(id);
    setSelectedUnitId('');
  }, []);

  // Initialisierung: Hierarchie aus den initialen IDs auflösen
  useEffect(() => {
    if (initialized || sites.length === 0) return;
    const { siteId, buildingId, unitId } = initialIds;

    // Nichts zu initialisieren
    if (!siteId && !buildingId && !unitId) {
      setInitialized(true);
      return;
    }

    (async () => {
      try {
        // Fall 1: unitId gegeben → Standort + Gebäude + Einheit auflösen
        if (unitId) {
          for (const site of sites) {
            const siteRes = await apiClient.get(`/api/v1/sites/${site.id}`);
            const siteBuildings = siteRes.data.buildings || [];
            for (const building of siteBuildings) {
              const bldRes = await apiClient.get(`/api/v1/sites/${site.id}/buildings/${building.id}`);
              const bldUnits = bldRes.data.usage_units || [];
              const found = bldUnits.find((u: Record<string, unknown>) => u.id === unitId);
              if (found) {
                setSelectedSiteId(site.id);
                setBuildings(siteBuildings.map((b: Record<string, unknown>) => ({
                  id: b.id as string, name: b.name as string, site_id: site.id,
                })));
                setSelectedBuildingId(building.id as string);
                setUnits(bldUnits.map((u: Record<string, unknown>) => ({
                  id: u.id as string, name: u.name as string,
                  building_id: building.id as string,
                  usage_type: (u.usage_type as string) || '',
                })));
                setSelectedUnitId(unitId);
                setInitialized(true);
                return;
              }
            }
          }
        }

        // Fall 2: buildingId gegeben → Standort + Gebäude auflösen
        if (buildingId) {
          for (const site of sites) {
            const siteRes = await apiClient.get(`/api/v1/sites/${site.id}`);
            const siteBuildings = siteRes.data.buildings || [];
            const found = siteBuildings.find((b: Record<string, unknown>) => b.id === buildingId);
            if (found) {
              setSelectedSiteId(site.id);
              setBuildings(siteBuildings.map((b: Record<string, unknown>) => ({
                id: b.id as string, name: b.name as string, site_id: site.id,
              })));
              setSelectedBuildingId(buildingId);
              setInitialized(true);
              return;
            }
          }
        }

        // Fall 3: nur siteId gegeben → Standort setzen
        if (siteId) {
          const found = sites.find((s) => s.id === siteId);
          if (found) {
            setSelectedSiteId(siteId);
          }
        }
      } catch {
        // ignore
      }
      setInitialized(true);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, initialized]);

  return {
    sites,
    buildings,
    units,
    selectedSiteId,
    selectedBuildingId,
    selectedUnitId,
    setSelectedSiteId: handleSiteChange,
    setSelectedBuildingId: handleBuildingChange,
    setSelectedUnitId,
    loading,
  };
}

/**
 * useSiteHierarchy – Hook für kaskadierende Standort/Gebäude/Nutzungseinheit-Auswahl.
 *
 * Lädt Standorte, Gebäude (gefiltert nach Standort) und Nutzungseinheiten
 * (gefiltert nach Gebäude) automatisch nach.
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

export function useSiteHierarchy(initialUnitId?: string | null): SiteHierarchyState {
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
    if (!selectedBuildingId) {
      setUnits([]);
      return;
    }
    (async () => {
      try {
        const res = await apiClient.get(`/api/v1/sites/buildings/${selectedBuildingId}`);
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
  }, [selectedBuildingId]);

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

  // Initialisierung: wenn initialUnitId gesetzt ist, die Hierarchie auflösen
  useEffect(() => {
    if (!initialUnitId || initialized || sites.length === 0) return;

    (async () => {
      try {
        // Alle Standorte durchsuchen um die Unit zu finden
        for (const site of sites) {
          const siteRes = await apiClient.get(`/api/v1/sites/${site.id}`);
          const siteBuildings = siteRes.data.buildings || [];
          for (const building of siteBuildings) {
            const bldRes = await apiClient.get(`/api/v1/sites/buildings/${building.id}`);
            const bldUnits = bldRes.data.usage_units || [];
            const found = bldUnits.find((u: Record<string, unknown>) => u.id === initialUnitId);
            if (found) {
              setSelectedSiteId(site.id);
              setBuildings(siteBuildings.map((b: Record<string, unknown>) => ({
                id: b.id as string,
                name: b.name as string,
                site_id: site.id,
              })));
              setSelectedBuildingId(building.id as string);
              setUnits(bldUnits.map((u: Record<string, unknown>) => ({
                id: u.id as string,
                name: u.name as string,
                building_id: building.id as string,
                usage_type: (u.usage_type as string) || '',
              })));
              setSelectedUnitId(initialUnitId);
              setInitialized(true);
              return;
            }
          }
        }
      } catch {
        // ignore
      }
      setInitialized(true);
    })();
  }, [initialUnitId, sites, initialized]);

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

/**
 * useMeterMapData – Lädt die komplette Standort-Hierarchie inkl. Zähler
 * und transformiert sie in ReactFlow Nodes + Edges.
 */

import { useEffect, useState, useCallback } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { apiClient } from '@/utils/api';
import { layoutHierarchy } from '@/utils/meterMapLayout';

const STORAGE_KEY = 'meter-map-positions';

interface Site {
  id: string;
  name: string;
  city?: string;
}

interface Building {
  id: string;
  name: string;
  site_id: string;
  building_type?: string;
  total_area_m2?: number;
}

interface UsageUnit {
  id: string;
  name: string;
  building_id: string;
  usage_type?: string;
}

interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  data_source: string;
  site_id: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  is_virtual: boolean;
  is_feed_in: boolean;
  is_active: boolean;
}

/** Gespeicherte Positionen aus localStorage laden */
function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** Positionen in localStorage speichern */
export function savePositions(nodes: Node[]) {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    positions[node.id] = node.position;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
}

export function useMeterMapData() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (useAutoLayout = true) => {
    setLoading(true);
    setError(null);

    try {
      // 1. Alle Standorte laden
      const sitesRes = await apiClient.get('/api/v1/sites?page_size=100');
      const sites: Site[] = (sitesRes.data.items || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        city: (s.city as string) || '',
      }));

      const allNodes: Node[] = [];
      const allEdges: Edge[] = [];

      // 2. Für jeden Standort: Gebäude + Nutzungseinheiten laden
      const siteDetails = await Promise.all(
        sites.map((site) => apiClient.get(`/api/v1/sites/${site.id}`))
      );

      for (let i = 0; i < sites.length; i++) {
        const site = sites[i];
        const siteData = siteDetails[i].data;

        // Site-Node
        allNodes.push({
          id: `site-${site.id}`,
          type: 'siteNode',
          position: { x: 0, y: 0 },
          data: { label: site.name, city: site.city, siteId: site.id },
        });

        const buildings: Building[] = (siteData.buildings || []).map((b: Record<string, unknown>) => ({
          id: b.id as string,
          name: b.name as string,
          site_id: site.id,
          building_type: (b.building_type as string) || '',
          total_area_m2: b.total_area_m2 as number | undefined,
        }));

        for (const building of buildings) {
          // Building-Node
          allNodes.push({
            id: `building-${building.id}`,
            type: 'buildingNode',
            position: { x: 0, y: 0 },
            data: { label: building.name, buildingType: building.building_type, area: building.total_area_m2 },
          });

          // Edge: Site → Building
          allEdges.push({
            id: `e-site-${site.id}-building-${building.id}`,
            source: `site-${site.id}`,
            target: `building-${building.id}`,
            type: 'smoothstep',
          });

          // Nutzungseinheiten aus der Building-Detail-Response laden
          let units: UsageUnit[] = [];
          try {
            const bldRes = await apiClient.get(`/api/v1/sites/${site.id}/buildings/${building.id}`);
            units = (bldRes.data.usage_units || []).map((u: Record<string, unknown>) => ({
              id: u.id as string,
              name: u.name as string,
              building_id: building.id,
              usage_type: (u.usage_type as string) || '',
            }));
          } catch {
            // Gebäude ohne Einheiten ignorieren
          }

          for (const unit of units) {
            // Unit-Node
            allNodes.push({
              id: `unit-${unit.id}`,
              type: 'unitNode',
              position: { x: 0, y: 0 },
              data: { label: unit.name, usageType: unit.usage_type, unitId: unit.id },
            });

            // Edge: Building → Unit
            allEdges.push({
              id: `e-building-${building.id}-unit-${unit.id}`,
              source: `building-${building.id}`,
              target: `unit-${unit.id}`,
              type: 'smoothstep',
            });
          }
        }
      }

      // 3. Alle aktiven Zähler laden (paginiert, da page_size max 100)
      const allMeters: Meter[] = [];
      let meterPage = 1;
      let meterTotal = 0;
      do {
        const res = await apiClient.get(`/api/v1/meters?page=${meterPage}&page_size=100&is_active=true`);
        allMeters.push(...(res.data.items || []));
        meterTotal = res.data.total || 0;
        meterPage++;
      } while (allMeters.length < meterTotal);

      // Zähler bereits verarbeiteter IDs tracken (Duplikate vermeiden)
      const addedMeterIds = new Set<string>();

      for (const m of allMeters) {
        if (addedMeterIds.has(m.id)) continue;
        addedMeterIds.add(m.id);

        const meterNodeId = `meter-${m.id}`;
        const meterNode: Node = {
          id: meterNodeId,
          type: 'meterNode',
          position: { x: 0, y: 0 },
          data: {
            label: m.name,
            meterId: m.id,
            meterNumber: m.meter_number,
            energyType: m.energy_type,
            dataSource: m.data_source,
            isVirtual: m.is_virtual,
            isFeedIn: m.is_feed_in,
            unitId: m.usage_unit_id,
          },
        };

        // Zähler an die tiefste zugeordnete Ebene anhängen
        if (m.usage_unit_id && allNodes.some((n) => n.id === `unit-${m.usage_unit_id}`)) {
          allNodes.push(meterNode);
          allEdges.push({
            id: `e-unit-${m.usage_unit_id}-meter-${m.id}`,
            source: `unit-${m.usage_unit_id}`,
            target: meterNodeId,
            type: 'smoothstep',
          });
        } else if (m.building_id && allNodes.some((n) => n.id === `building-${m.building_id}`)) {
          allNodes.push(meterNode);
          allEdges.push({
            id: `e-building-${m.building_id}-meter-${m.id}`,
            source: `building-${m.building_id}`,
            target: meterNodeId,
            type: 'smoothstep',
          });
        } else if (m.site_id && allNodes.some((n) => n.id === `site-${m.site_id}`)) {
          allNodes.push(meterNode);
          allEdges.push({
            id: `e-site-${m.site_id}-meter-${m.id}`,
            source: `site-${m.site_id}`,
            target: meterNodeId,
            type: 'smoothstep',
          });
        }
        // Zähler ohne Zuordnung werden nicht in der Map angezeigt
      }

      // 4. Layout berechnen
      const layoutedNodes = layoutHierarchy(allNodes, allEdges);

      // 5. Gespeicherte Positionen anwenden (wenn vorhanden und gewünscht)
      if (useAutoLayout) {
        const saved = loadPositions();
        const finalNodes = layoutedNodes.map((node) => {
          if (saved[node.id]) {
            return { ...node, position: saved[node.id] };
          }
          return node;
        });
        setNodes(finalNodes);
      } else {
        setNodes(layoutedNodes);
      }

      setEdges(allEdges);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Daten');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => fetchData(true), [fetchData]);
  const resetLayout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    fetchData(false);
  }, [fetchData]);

  return { nodes, edges, setNodes, setEdges, loading, error, refetch, resetLayout };
}

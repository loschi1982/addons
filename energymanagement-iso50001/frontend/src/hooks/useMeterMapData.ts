/**
 * useMeterMapData – Lädt Zähler und baut die Messtopologie als Graph auf.
 *
 * Zeigt die elektrische Hierarchie: Site → Root-Meter → Sub-Meter → ...
 * Gebäude/Einheiten werden als Kontext-Badges auf den Zähler-Nodes angezeigt,
 * nicht als eigene Graph-Knoten.
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


interface Meter {
  id: string;
  name: string;
  meter_number: string | null;
  energy_type: string;
  data_source: string;
  site_id: string | null;
  building_id: string | null;
  usage_unit_id: string | null;
  parent_meter_id: string | null;
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
      // 1. Standorte laden
      const sitesRes = await apiClient.get('/api/v1/sites?page_size=100');
      const sites: Site[] = (sitesRes.data.items || []).map((s: Record<string, unknown>) => ({
        id: s.id as string,
        name: s.name as string,
        city: (s.city as string) || '',
      }));

      // 2. Gebäude + Einheiten als Lookup-Maps laden (für Badges, nicht als Nodes)
      const buildingMap = new Map<string, string>(); // id → name
      const unitMap = new Map<string, { name: string; buildingId: string }>(); // id → {name, buildingId}

      const siteDetails = await Promise.all(
        sites.map((site) => apiClient.get(`/api/v1/sites/${site.id}`))
      );

      for (let i = 0; i < sites.length; i++) {
        const siteData = siteDetails[i].data;
        const buildings = (siteData.buildings || []) as Record<string, unknown>[];

        for (const b of buildings) {
          buildingMap.set(b.id as string, b.name as string);

          // Einheiten laden
          try {
            const bldRes = await apiClient.get(`/api/v1/sites/${sites[i].id}/buildings/${b.id}`);
            const units = (bldRes.data.usage_units || []) as Record<string, unknown>[];
            for (const u of units) {
              unitMap.set(u.id as string, {
                name: u.name as string,
                buildingId: b.id as string,
              });
            }
          } catch {
            // Gebäude ohne Einheiten ignorieren
          }
        }
      }

      // 3. Alle aktiven Zähler laden
      const allMeters: Meter[] = [];
      let meterPage = 1;
      let meterTotal = 0;
      do {
        const res = await apiClient.get(`/api/v1/meters?page=${meterPage}&page_size=100&is_active=true`);
        allMeters.push(...(res.data.items || []));
        meterTotal = res.data.total || 0;
        meterPage++;
      } while (allMeters.length < meterTotal);

      const meterIds = new Set(allMeters.map((m) => m.id));
      const allNodes: Node[] = [];
      const allEdges: Edge[] = [];

      // 4. Site-Nodes erstellen (als Wurzel)
      for (const site of sites) {
        allNodes.push({
          id: `site-${site.id}`,
          type: 'siteNode',
          position: { x: 0, y: 0 },
          data: { label: site.name, city: site.city, siteId: site.id },
        });
      }

      // 5. Meter-Nodes + Edges nach Messtopologie erstellen
      for (const m of allMeters) {
        // Gebäude-/Einheiten-Name für Badge ermitteln
        let buildingName: string | undefined;
        if (m.usage_unit_id && unitMap.has(m.usage_unit_id)) {
          const unit = unitMap.get(m.usage_unit_id)!;
          buildingName = buildingMap.get(unit.buildingId);
        } else if (m.building_id) {
          buildingName = buildingMap.get(m.building_id);
        }

        const meterNodeId = `meter-${m.id}`;
        allNodes.push({
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
            buildingName,
            parentMeterId: m.parent_meter_id,
          },
        });

        // Edge-Logik: Messtopologie
        if (m.parent_meter_id && meterIds.has(m.parent_meter_id)) {
          // Sub-Meter: Kante zum Elternzähler
          allEdges.push({
            id: `e-meter-${m.parent_meter_id}-meter-${m.id}`,
            source: `meter-${m.parent_meter_id}`,
            target: meterNodeId,
            type: 'smoothstep',
            animated: m.is_feed_in,
            style: m.is_feed_in ? { stroke: '#22c55e' } : undefined,
          });
        } else if (m.site_id) {
          // Root-Meter: Kante zum Standort
          allEdges.push({
            id: `e-site-${m.site_id}-meter-${m.id}`,
            source: `site-${m.site_id}`,
            target: meterNodeId,
            type: 'smoothstep',
          });
        }
        // Zähler ohne site_id und ohne parent_meter_id sind verwaist → nicht verbunden
      }

      // 6. Layout berechnen
      const layoutedNodes = layoutHierarchy(allNodes, allEdges);

      // 7. Gespeicherte Positionen anwenden (wenn vorhanden)
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

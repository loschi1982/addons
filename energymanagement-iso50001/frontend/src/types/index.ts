/**
 * Gemeinsame TypeScript-Typen für das Frontend.
 */

// Pagination
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// Energietypen
export type EnergyType =
  | 'electricity'
  | 'natural_gas'
  | 'heating_oil'
  | 'district_heating'
  | 'water'
  | 'solar'
  | 'lpg'
  | 'wood_pellets';

export const ENERGY_TYPE_LABELS: Record<EnergyType, string> = {
  electricity: 'Strom',
  natural_gas: 'Erdgas',
  heating_oil: 'Heizöl',
  district_heating: 'Fernwärme',
  water: 'Wasser',
  solar: 'Solar',
  lpg: 'Flüssiggas',
  wood_pellets: 'Holzpellets',
};

export const ENERGY_TYPE_COLORS: Record<EnergyType, string> = {
  electricity: '#F59E0B',
  natural_gas: '#3B82F6',
  heating_oil: '#8B5CF6',
  district_heating: '#F97316',
  water: '#06B6D4',
  solar: '#10B981',
  lpg: '#EC4899',
  wood_pellets: '#84CC16',
};

// Status
export type Status = 'draft' | 'active' | 'completed' | 'cancelled';

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Entwurf',
  active: 'Aktiv',
  completed: 'Abgeschlossen',
  cancelled: 'Abgebrochen',
  planned: 'Geplant',
  in_progress: 'In Bearbeitung',
  open: 'Offen',
  closed: 'Geschlossen',
};

// API-Response
export interface ApiError {
  detail: string;
  status_code: number;
}

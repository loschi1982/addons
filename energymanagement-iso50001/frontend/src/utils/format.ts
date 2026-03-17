/**
 * Formatierungs-Hilfsfunktionen für Zahlen, Daten und Einheiten.
 */

/**
 * Zahl mit deutschem Zahlenformat (Komma als Dezimaltrenner).
 */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Energieverbrauch mit passender Einheit (kWh, MWh, GWh).
 */
export function formatEnergy(kwh: number): string {
  if (kwh >= 1_000_000) return `${formatNumber(kwh / 1_000_000)} GWh`;
  if (kwh >= 1_000) return `${formatNumber(kwh / 1_000)} MWh`;
  return `${formatNumber(kwh)} kWh`;
}

/**
 * CO₂-Wert mit passender Einheit (kg, t).
 */
export function formatCO2(kg: number): string {
  if (kg >= 1_000) return `${formatNumber(kg / 1_000)} t CO₂`;
  return `${formatNumber(kg)} kg CO₂`;
}

/**
 * Datum im deutschen Format (TT.MM.JJJJ).
 */
export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('de-DE');
}

/**
 * Datum mit Uhrzeit.
 */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('de-DE');
}

/**
 * Prozent-Wert formatieren.
 */
export function formatPercent(value: number, decimals = 1): string {
  return `${formatNumber(value, decimals)} %`;
}

/**
 * Währung (EUR) formatieren.
 */
export function formatCurrency(value: number): string {
  return value.toLocaleString('de-DE', {
    style: 'currency',
    currency: 'EUR',
  });
}

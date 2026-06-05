/**
 * Kanonische Energiefarben-Marke aus dem Claude-Design-Handoff.
 *
 * EINZIGE Quelle der Wahrheit für Energie-Träger-Farben in der App. Werte sind
 * **identisch in Hell- und Dunkel-Theme** (siehe CLAUDE.md des Handoffs:
 * lesbare Farb-Inseln, nicht pro Theme umtönen).
 *
 * Die hexadezimalen Werte spiegeln die CSS-Variablen `--fw-*` in
 * `src/styles/globals.css` wider. Wenn JS/TS-Code Farben braucht
 * (Recharts-Fills, SVG-Strokes), kann er sie hier direkt importieren —
 * ein `getComputedStyle()`-Roundtrip ist nicht nötig.
 */

export type EnergyKey = 'fernwaerme' | 'strom' | 'kaelte' | 'wasser';

export interface EnergyTone {
  /** Anzeigename (Deutsch). */
  label: string;
  /** Voll-Sättigung (Linien, Balken, Stripe-Accents). */
  color: string;
  /** Pastell-BG für Chips. */
  bg: string;
  /** Dunkler Text auf Chip-BG. */
  text: string;
  /** Glyphen-Name (Map auf Lucide-Icons o. ä. in Verbrauchern). */
  icon: 'flame' | 'bolt' | 'snowflake' | 'droplet';
}

export const EM_ENERGY: Record<EnergyKey, EnergyTone> = {
  fernwaerme: { label: 'Fernwärme', color: '#E89A3C', bg: '#FCE7C3', text: '#7B3F0C', icon: 'flame' },
  strom:      { label: 'Strom',     color: '#F2C94C', bg: '#FBEFC1', text: '#7A5800', icon: 'bolt' },
  kaelte:     { label: 'Kälte',     color: '#4FC3F7', bg: '#D5EFFB', text: '#0B4A6E', icon: 'snowflake' },
  wasser:     { label: 'Wasser',    color: '#2A6FDB', bg: '#D6E4F8', text: '#1E3A8A', icon: 'droplet' },
};

/**
 * Map gängige Energie-Typ-Strings (engl./dt./Slug-Varianten) auf den
 * kanonischen `EnergyKey`. Robust gegen Groß-/Kleinschreibung.
 *
 * Rückgabe `null`, wenn kein Match — Aufrufer entscheidet, ob er einen
 * Default verwendet oder den unbekannten Träger neutral darstellt.
 */
export function resolveEnergyKey(raw: string | null | undefined): EnergyKey | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (s.includes('strom') || s === 'electricity' || s === 'elektro' || s === 'el') return 'strom';
  if (s.includes('fernw') || s === 'district_heating' || s === 'districtheating' || s === 'heating' || s === 'gas' || s === 'wärme' || s === 'waerme') return 'fernwaerme';
  if (s.includes('kält') || s.includes('kaelt') || s === 'cooling' || s === 'district_cooling' || s === 'kühlung' || s === 'kuehlung') return 'kaelte';
  if (s.includes('wasser') || s === 'water') return 'wasser';
  return null;
}

/** Hilfsfunktion: Energietyp → Voll-Farbe (mit Fallback auf Ink). */
export function energyColor(raw: string | null | undefined, fallback = 'var(--ink-3)'): string {
  const key = resolveEnergyKey(raw);
  return key ? EM_ENERGY[key].color : fallback;
}

/** Hilfsfunktion: Energietyp → Chip-BG (Pastell). */
export function energyChipBg(raw: string | null | undefined, fallback = 'var(--surface-2)'): string {
  const key = resolveEnergyKey(raw);
  return key ? EM_ENERGY[key].bg : fallback;
}

/** Hilfsfunktion: Energietyp → Chip-Text-Farbe. */
export function energyChipText(raw: string | null | undefined, fallback = 'var(--ink-2)'): string {
  const key = resolveEnergyKey(raw);
  return key ? EM_ENERGY[key].text : fallback;
}

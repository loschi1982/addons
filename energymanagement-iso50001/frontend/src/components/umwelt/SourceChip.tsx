/**
 * Datenquellen-Chip (BAFA, UBA, Electricity Maps, DWD, Hamburger Energiewerke …).
 * Gemeinsamer Baustein der Umwelt-Screens. Portiert aus umwelt-ui.jsx.
 */

export const SOURCE_META: Record<string, { label: string; color: string }> = {
  bafa: { label: 'BAFA', color: '#6B6B6B' },
  electricity: { label: 'Electricity Maps', color: '#10B981' },
  electricity_maps: { label: 'Electricity Maps', color: '#10B981' },
  uba: { label: 'UBA', color: '#2A6FDB' },
  dwd: { label: 'DWD', color: '#4FC3F7' },
  brightsky: { label: 'BrightSky / DWD', color: '#4FC3F7' },
  hew: { label: 'Hamburger Energiewerke', color: '#E89A3C' },
  homeassistant: { label: 'Home Assistant', color: '#41BDF5' },
  manuell: { label: 'Manuell', color: '#9A968B' },
  manual: { label: 'Manuell', color: '#9A968B' },
};

interface SourceChipProps {
  /** Quellen-Schlüssel oder freier Name. */
  source?: string | null;
  /** Anzeige-Label überschreiben. */
  label?: string;
}

export default function SourceChip({ source, label }: SourceChipProps) {
  const key = (source || '').toLowerCase().trim();
  const meta = SOURCE_META[key] || { label: label || source || '–', color: '#9A968B' };
  return (
    <span className="src-chip">
      <span className="dot" style={{ background: meta.color }} />
      {label || meta.label}
    </span>
  );
}

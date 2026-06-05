import { Droplet, Flame, Snowflake, Zap } from 'lucide-react';
import { EM_ENERGY, resolveEnergyKey, type EnergyKey } from '@/utils/energyPalette';

interface EnergyChipProps {
  /** Energie-Träger (engl./dt./Slug) – wird auf `EnergyKey` aufgelöst. */
  type: string | EnergyKey | null | undefined;
  /** Optional eigenes Label überschreiben (sonst Marken-Label). */
  label?: string;
  /** Optionaler Wert nach dem Label, z. B. Anzahl Zähler. */
  count?: number;
  /** Größenvariante. */
  size?: 'sm' | 'md';
  className?: string;
}

const ICONS: Record<EnergyKey, typeof Flame> = {
  fernwaerme: Flame,
  strom: Zap,
  kaelte: Snowflake,
  wasser: Droplet,
};

/**
 * Marken-Energie-Chip im Pastell-Look. Identisch in Hell/Dunkel –
 * lesbare Farb-Insel auf Surface.
 */
export default function EnergyChip({ type, label, count, size = 'md', className = '' }: EnergyChipProps) {
  const key = typeof type === 'string' ? resolveEnergyKey(type) : type ?? null;
  const tone = key ? EM_ENERGY[key] : null;
  const Icon = key ? ICONS[key] : null;

  const styles = tone
    ? { background: tone.bg, color: tone.text }
    : { background: 'var(--surface-2)', color: 'var(--ink-3)', border: '1px solid var(--line)' };

  const sizePadding = size === 'sm' ? '2px 7px' : '3px 9px';
  const iconSize = size === 'sm' ? 10 : 12;
  const fontSize = size === 'sm' ? 10.5 : 11;

  return (
    <span
      className={`inline-flex items-center ${className}`}
      style={{
        gap: 6,
        padding: sizePadding,
        borderRadius: 999,
        fontSize,
        fontWeight: 500,
        ...styles,
      }}
    >
      {Icon && <Icon size={iconSize} aria-hidden="true" />}
      <span>{label ?? tone?.label ?? '—'}</span>
      {typeof count === 'number' && (
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: fontSize - 0.5,
            opacity: 0.7,
            fontFeatureSettings: '"tnum"',
          }}
        >
          {count}
        </span>
      )}
    </span>
  );
}

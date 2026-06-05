import type { ReactNode } from 'react';

interface PillProps {
  children: ReactNode;
  /** Aktiv = Ink-BG, Surface-Text. */
  active?: boolean;
  /** Tonalität für nicht-aktive Pills (Default: neutral). */
  tone?: 'neutral' | 'good' | 'warn' | 'alert' | 'info';
  onClick?: () => void;
  /** Optionaler Mono-Counter rechts ("· 12"). */
  count?: number | string;
  /** Optionaler Punkt links. */
  dotColor?: string;
  className?: string;
}

/**
 * Filter-/Status-Pill, wie auf Standorte/Zähler/Outliers verwendet.
 * Tonalität ändert nur Border + Text-Farbe, das Pill bleibt clean auf Surface.
 */
export default function Pill({ children, active = false, tone = 'neutral', onClick, count, dotColor, className = '' }: PillProps) {
  const toneVar =
    tone === 'good' ? 'var(--good)' :
    tone === 'warn' ? 'var(--warn)' :
    tone === 'alert' ? 'var(--alert)' :
    tone === 'info' ? 'var(--info)' :
    null;

  const style = active
    ? {
        background: 'var(--ink)',
        color: 'var(--surface)',
        borderColor: 'var(--ink)',
      }
    : toneVar
    ? {
        background: 'var(--surface)',
        color: toneVar,
        borderColor: `color-mix(in srgb, ${toneVar} 40%, transparent)`,
      }
    : {
        background: 'var(--surface)',
        color: 'var(--ink-2)',
        borderColor: 'var(--line)',
      };

  const countColor = active ? 'color-mix(in srgb, var(--surface) 70%, transparent)' : 'var(--ink-3)';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center transition-colors ${className}`}
      style={{
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: '1px solid',
        fontSize: 12,
        fontWeight: 500,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {dotColor && <span style={{ width: 7, height: 7, borderRadius: 999, background: dotColor }} />}
      <span>{children}</span>
      {count !== undefined && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: countColor, fontFeatureSettings: '"tnum"' }}>
          {count}
        </span>
      )}
    </button>
  );
}

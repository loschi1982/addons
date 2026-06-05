import type { ReactNode } from 'react';

interface StatusBandProps {
  /** Text der Status-Pill (z. B. "Auf Kurs"). */
  pillLabel: string;
  /** Tonalität – steuert Farbe der Pill. Default "good". */
  pillTone?: 'good' | 'warn' | 'alert' | 'info';
  /** Fette Headline (z. B. "ISO 50001 – Zielpfad CO₂-Reduktion"). */
  headline: string;
  /** Erklärtext unter der Headline. */
  sub?: string;
  /** Aktuelle Position auf der Progress-Bar in Prozent (0–100). */
  progress: number;
  /** Optionaler Marker (Pfad-Ziel) als Prozent (0–100). */
  marker?: number;
  /** Marker-Label (z. B. "Soll 27.05."). */
  markerLabel?: string;
  /** Optionale Statistik-Zeile unter der Progress-Bar. */
  stats?: ReactNode;
  /** Aktion rechts (z. B. "Bericht generieren"). */
  action?: ReactNode;
}

/**
 * Dashboard-Status-Band — 3-Spalten-Grid:
 *  Pill+Headline · Progress · Action.
 */
export default function StatusBand({
  pillLabel,
  pillTone = 'good',
  headline,
  sub,
  progress,
  marker,
  markerLabel,
  stats,
  action,
}: StatusBandProps) {
  const toneColor =
    pillTone === 'warn' ? 'var(--warn)' :
    pillTone === 'alert' ? 'var(--alert)' :
    pillTone === 'info' ? 'var(--info)' :
    'var(--good)';

  const clamp = (n: number) => Math.max(0, Math.min(100, n));
  const pct = clamp(progress);

  return (
    <div className="dv-status-band">
      <div className="status-meta">
        <span
          className="status-pill"
          style={{
            background: `color-mix(in srgb, ${toneColor} 14%, transparent)`,
            color: toneColor,
            borderColor: `color-mix(in srgb, ${toneColor} 38%, transparent)`,
          }}
        >
          <span
            className="dot"
            style={{
              background: toneColor,
              boxShadow: `0 0 0 3px color-mix(in srgb, ${toneColor} 22%, transparent)`,
            }}
          />
          {pillLabel}
        </span>
        <div>
          <span className="status-headline">{headline}</span>
          {sub && <span className="status-sub">{sub}</span>}
        </div>
      </div>

      <div className="status-progress">
        <div className="dv-progress-track">
          <div className="dv-progress-fill" style={{ width: `${pct}%` }} />
          {typeof marker === 'number' && (
            <div className="dv-progress-marker" style={{ left: `${clamp(marker)}%` }}>
              <div className="dv-marker-dot" />
              {markerLabel && <div className="dv-marker-label">{markerLabel}</div>}
            </div>
          )}
        </div>
        {stats && <div className="progress-stats">{stats}</div>}
      </div>

      <div>{action}</div>
    </div>
  );
}

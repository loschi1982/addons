import type { ReactNode } from 'react';

interface PageHeadProps {
  /** Kleine Überschrift in Großbuchstaben über dem Titel ("Energiebericht ISO 50001"). */
  eyebrow?: string;
  /** H1 (26 px / 600 / -0.025em). */
  title: string;
  /** Zeitraum als Mono-Text rechts neben dem Titel ("01.01.2026 – 27.05.2026"). */
  period?: string;
  /** Chip neben dem Zeitraum ("YTD"). */
  periodChip?: string;
  /** Optionale Aktionen (Selects, Segmented Controls, Buttons) rechts. */
  actions?: ReactNode;
}

/**
 * Einheitlicher Seitenkopf nach Claude-Design-Spec.
 * Wird pro Page einmal direkt unter dem Layout-Header gerendert.
 */
export default function PageHead({ eyebrow, title, period, periodChip, actions }: PageHeadProps) {
  return (
    <div
      className="flex flex-wrap items-end justify-between"
      style={{ gap: 24, paddingTop: 6, paddingBottom: 8 }}
    >
      <div className="flex items-end" style={{ gap: 28 }}>
        <div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="page-title-h1">{title}</h1>
        </div>
        {(period || periodChip) && (
          <div className="flex items-baseline" style={{ gap: 8, paddingBottom: 4 }}>
            <span className="period-label">Zeitraum</span>
            {period && <span className="period-value">{period}</span>}
            {periodChip && <span className="app-chip">{periodChip}</span>}
          </div>
        )}
      </div>
      {actions && <div className="flex items-center" style={{ gap: 12 }}>{actions}</div>}
    </div>
  );
}

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

export interface HeroCardData {
  /** Label / Eyebrow ("Gesamtenergie", "CO₂-Emissionen", "Energiekosten"). */
  label: string;
  /** Großer Wert (formatiert, in Mono). */
  value: string;
  /** Einheit hinter dem Wert ("kWh", "kg", "EUR"). */
  unit?: string;
  /** Delta vs. Vorjahr ("−12 %", "+3 %"). */
  delta?: string;
  /** Tonalität des Deltas: bei Verbrauch ist down=good, up=bad. */
  deltaTone?: 'good' | 'bad';
  /** Zusatzkontext ("vs. Vorjahr"). */
  deltaMeta?: string;
  /** Optionale Sparkline (SVG). */
  sparkline?: ReactNode;
  /** Optionales Info-Icon (Tooltip-Trigger). */
  info?: ReactNode;
}

interface HeroTrioProps {
  cards: [HeroCardData, HeroCardData, HeroCardData];
}

/**
 * Dashboard-Hero: 3 KPI-Karten in einer einzigen umrandeten Fläche.
 */
export default function HeroTrio({ cards }: HeroTrioProps) {
  return (
    <div className="dv-hero-trio">
      {cards.map((c, i) => (
        <HeroCard key={i} data={c} />
      ))}
    </div>
  );
}

function HeroCard({ data }: { data: HeroCardData }) {
  const ArrowIco = data.deltaTone === 'good' ? ArrowDown : ArrowUp;
  return (
    <div className="dv-hero-card">
      <div className="hero-row1">
        <span>{data.label}</span>
        {data.info}
      </div>
      <div className="hero-row2">
        <span className="hero-value">{data.value}</span>
        {data.unit && <span className="hero-unit">{data.unit}</span>}
      </div>
      <div className="hero-row3">
        {data.delta && (
          <span className={`hero-delta ${data.deltaTone === 'good' ? 'good' : 'bad'}`}>
            <ArrowIco size={12} aria-hidden="true" />
            {data.delta}
          </span>
        )}
        {data.deltaMeta && <span className="hero-delta-meta">{data.deltaMeta}</span>}
      </div>
      {data.sparkline && <div className="type-spark">{data.sparkline}</div>}
    </div>
  );
}

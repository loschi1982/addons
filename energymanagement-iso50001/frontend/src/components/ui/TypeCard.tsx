import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Droplet, Flame, Snowflake, Zap } from 'lucide-react';
import { EM_ENERGY, type EnergyKey } from '@/utils/energyPalette';

interface TypeCardProps {
  type: EnergyKey;
  /** Marken-Label überschreiben (Standard: EM_ENERGY[type].label). */
  label?: string;
  /** Anteil Kosten ("38 %"). Optional. */
  share?: string;
  /** Großer Wert (Mono). */
  value: string;
  unit?: string;
  /** Delta vs. Vorjahr. */
  delta?: string;
  deltaTone?: 'good' | 'bad';
  deltaMeta?: string;
  /** Optionale Sparkline (SVG). */
  sparkline?: ReactNode;
  /** Optionaler Footer (Jahresvergleich-Strip o. Ä.). */
  footer?: ReactNode;
}

const ICONS = { fernwaerme: Flame, strom: Zap, kaelte: Snowflake, wasser: Droplet };

/**
 * Energie-Typ-Karte mit Top-Akzent in Marken-Farbe, Mono-KPI und Delta.
 */
export default function TypeCard({
  type,
  label,
  share,
  value,
  unit,
  delta,
  deltaTone = 'good',
  deltaMeta,
  sparkline,
  footer,
}: TypeCardProps) {
  const tone = EM_ENERGY[type];
  const Ico = ICONS[type];
  const ArrowIco = deltaTone === 'good' ? ArrowDown : ArrowUp;

  return (
    <div className={`dv-type-card dv-type-${type}`}>
      <div className="type-header">
        <span className="type-icon" style={{ background: tone.bg, color: tone.text }}>
          <Ico size={14} aria-hidden="true" />
        </span>
        <span className="type-label">{label ?? tone.label}</span>
        {share && <span className="type-share">{share}</span>}
      </div>

      <div className="type-value">
        <span className="value-num">{value}</span>
        {unit && <span className="value-unit">{unit}</span>}
      </div>

      {(delta || deltaMeta) && (
        <div className="type-row">
          {delta && (
            <span className={`delta ${deltaTone === 'good' ? 'good' : 'bad'}`}>
              <ArrowIco size={12} aria-hidden="true" />
              {delta}
            </span>
          )}
          {deltaMeta && <span className="delta-meta">{deltaMeta}</span>}
        </div>
      )}

      {sparkline && <div className="type-spark">{sparkline}</div>}
      {footer && (
        <div className="type-foot">
          <div className="type-foot-item">
            <span className="foot-label">Jahresvergleich</span>
            {footer}
          </div>
        </div>
      )}
    </div>
  );
}

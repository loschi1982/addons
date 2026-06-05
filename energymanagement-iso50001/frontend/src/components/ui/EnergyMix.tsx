import { EM_ENERGY, type EnergyKey } from '@/utils/energyPalette';

export interface EnergyMixSlice {
  key: EnergyKey;
  /** Anteil 0–1. */
  share: number;
  /** Anzeige-Wert ("12 345 kWh") für Legende. Optional. */
  amount?: string;
}

interface EnergyMixProps {
  /** Aggregat-Wert oben rechts. */
  total: string;
  totalUnit?: string;
  slices: EnergyMixSlice[];
}

/**
 * Energiemix-Karte: einzelner horizontaler Stacked-Bar + Legende.
 */
export default function EnergyMix({ total, totalUnit, slices }: EnergyMixProps) {
  // sum auf max 1.0 normalisieren
  const sum = slices.reduce((a, b) => a + Math.max(0, b.share), 0) || 1;
  const norm = slices.map((s) => ({ ...s, share: Math.max(0, s.share) / sum }));

  return (
    <div className="energy-mix">
      <div className="mix-head">
        <div className="mix-title">Energiemix YTD</div>
        <div className="mix-total">
          <strong>{total}</strong>
          {totalUnit && <span style={{ marginLeft: 4 }}>{totalUnit}</span>}
        </div>
      </div>

      {/* Stacked Bar */}
      <div
        style={{
          display: 'flex',
          height: 12,
          width: '100%',
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--surface-2)',
          border: '1px solid var(--line)',
        }}
        aria-label="Energie-Anteile gestapelt"
      >
        {norm.map((s) => (
          <div
            key={s.key}
            style={{
              flex: `${s.share * 100} 0 0`,
              background: EM_ENERGY[s.key].color,
            }}
            title={`${EM_ENERGY[s.key].label}: ${(s.share * 100).toFixed(1)}%`}
          />
        ))}
      </div>

      {/* Legende */}
      <ul className="mix-legend" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {norm.map((s) => (
          <li key={s.key} className="mix-legend-item">
            <span className="dot" style={{ background: EM_ENERGY[s.key].color }} />
            <span className="mix-l-name">{EM_ENERGY[s.key].label}</span>
            <span className="mix-l-pct">
              {(s.share * 100).toFixed(1).replace('.', ',')}%
              {s.amount && (
                <span style={{ marginLeft: 8, color: 'var(--ink-4)' }}>{s.amount}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

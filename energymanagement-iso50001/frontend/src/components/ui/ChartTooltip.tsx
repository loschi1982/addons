import type { TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';

interface Extra {
  /** Optionales Eyebrow/Badge oben rechts ("Prognose"). */
  badge?: string;
  /** Einheit, die hinter jedem Wert erscheint ("kWh"). */
  unit?: string;
  /** Anzeigeformat für Zahl. Default: deutsche Tausendertrennzeichen. */
  formatValue?: (v: number | string) => string;
}

function fmtDe(v: number | string) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!isFinite(n)) return String(v ?? '');
  return new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 }).format(n);
}

/**
 * Dunkler Glas-Tooltip im Designsystem-Look. Direkt als
 * `<Tooltip content={<ChartTooltip badge="Prognose" unit="kWh"/>}/>` an
 * Recharts hängen.
 */
export default function ChartTooltip(props: TooltipProps<ValueType, NameType> & Extra) {
  const { active, payload, label, badge, unit, formatValue } = props;
  if (!active || !payload || payload.length === 0) return null;
  const fmt = formatValue ?? fmtDe;

  return (
    <div className="chart-tip" style={{ position: 'static', transform: 'none' }}>
      <div className="chart-tip-head">
        <span className="chart-tip-month">{label}</span>
        {badge && <span className="chart-tip-badge">{badge}</span>}
      </div>
      <div className="chart-tip-rows">
        {payload.map((row, i) => (
          <div className="chart-tip-row" key={i}>
            <span className="chart-tip-dot" style={{ background: String(row.color || row.fill || '#fff') }} />
            <span className="chart-tip-label">{String(row.name ?? '')}</span>
            <span className="chart-tip-val">
              {fmt(row.value as number | string)}
              {unit && <span className="chart-tip-unit"> {unit}</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

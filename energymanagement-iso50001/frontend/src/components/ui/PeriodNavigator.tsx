/**
 * PeriodNavigator – einheitliches Zeitraum-Control.
 *
 * Granularitäts-Umschalter (Tag · Woche · Monat · Quartal · Jahr · Frei) plus
 * zwei Pfeile ◀ ▶, die den gewählten Zeitraum eine Einheit vor/zurück springen.
 * Bei „Frei" werden von/bis-Felder gezeigt; die Pfeile verschieben dann um die
 * Bereichslänge. Controlled component: value + onChange.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type Granularity, type PeriodValue,
  periodRange, shiftPeriod, periodLabel, parseISO,
} from '@/utils/period';

const GRAN_OPTIONS: Array<{ key: Granularity; label: string }> = [
  { key: 'day', label: 'Tag' },
  { key: 'week', label: 'Woche' },
  { key: 'month', label: 'Monat' },
  { key: 'quarter', label: 'Quartal' },
  { key: 'year', label: 'Jahr' },
  { key: 'custom', label: 'Frei' },
];

interface Props {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  /** Optionale Teilmenge der Granularitäten (Default: alle inkl. „Frei"). */
  granularities?: Granularity[];
  className?: string;
}

export default function PeriodNavigator({ value, onChange, granularities, className }: Props) {
  const opts = GRAN_OPTIONS.filter(o => !granularities || granularities.includes(o.key));

  const setGran = (g: Granularity) => {
    if (g === value.granularity) return;
    if (g === 'custom') {
      onChange({ ...value, granularity: 'custom' });
      return;
    }
    // Anker = aktueller Start → volle Einheit der neuen Granularität.
    onChange({ granularity: g, ...periodRange(g, parseISO(value.start)) });
  };

  const step = (dir: -1 | 1) =>
    onChange({ ...value, ...shiftPeriod(value.granularity, value.start, value.end, dir) });

  const arrowBtn =
    'flex items-center justify-center h-8 w-8 rounded-md border border-gray-200 ' +
    'text-gray-600 hover:bg-gray-50 active:scale-95 transition';

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className ?? ''}`}>
      {/* Granularitäts-Umschalter */}
      <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
        {opts.map(o => (
          <button
            key={o.key}
            type="button"
            onClick={() => setGran(o.key)}
            className={`px-2.5 py-1.5 text-xs font-medium transition ${
              value.granularity === o.key
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Navigation / Frei-Bereich */}
      {value.granularity === 'custom' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input
            type="date"
            className="input"
            value={value.start}
            onChange={e => onChange({ ...value, start: e.target.value })}
          />
          <span className="text-gray-400">–</span>
          <input
            type="date"
            className="input"
            value={value.end}
            onChange={e => onChange({ ...value, end: e.target.value })}
          />
          <button type="button" className={arrowBtn} onClick={() => step(-1)} title="Zeitraum zurück" aria-label="Zeitraum zurück">
            <ChevronLeft size={16} />
          </button>
          <button type="button" className={arrowBtn} onClick={() => step(1)} title="Zeitraum vor" aria-label="Zeitraum vor">
            <ChevronRight size={16} />
          </button>
        </div>
      ) : (
        <div className="inline-flex items-center gap-1">
          <button type="button" className={arrowBtn} onClick={() => step(-1)} title="Zeitraum zurück" aria-label="Zeitraum zurück">
            <ChevronLeft size={16} />
          </button>
          <span className="min-w-[130px] text-center text-sm font-medium text-gray-700">
            {periodLabel(value.granularity, value.start, value.end)}
          </span>
          <button type="button" className={arrowBtn} onClick={() => step(1)} title="Zeitraum vor" aria-label="Zeitraum vor">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

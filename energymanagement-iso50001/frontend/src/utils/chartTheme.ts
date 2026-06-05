/**
 * Recharts-Theme-Brücke: liest die globalen CSS-Variablen, damit Charts
 * auf Hell/Dunkel reagieren, ohne dass jede Chart-Datei eigene Tokens kennt.
 *
 * SSR-fest: greift nur per `getComputedStyle` zu, wenn `document` existiert.
 * Sonst fallback auf die Hell-Mode-Hex-Werte aus dem Designsystem.
 */

const FALLBACK = {
  bg:        '#F6F4EF',
  surface:   '#FFFFFF',
  surface2:  '#FAF8F2',
  line:      '#E8E3D8',
  lineStrong:'#D9D2C3',
  ink:       '#0F1115',
  ink2:      '#3D3D3D',
  ink3:      '#6B6B6B',
  ink4:      '#9A968B',
  good:      '#10B981',
  warn:      '#B45309',
  alert:     '#B91C1C',
  info:      '#1E40AF',
  chartGrid: '#EDEAE3',
  chartAxis: '#8A8A8A',
  chartInk:  '#0A0A0B',
  chartMuted:'#525252',
};

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function chartTokens() {
  return {
    bg:         readVar('--bg',          FALLBACK.bg),
    surface:    readVar('--surface',     FALLBACK.surface),
    surface2:   readVar('--surface-2',   FALLBACK.surface2),
    line:       readVar('--line',        FALLBACK.line),
    lineStrong: readVar('--line-strong', FALLBACK.lineStrong),
    ink:        readVar('--ink',         FALLBACK.ink),
    ink2:       readVar('--ink-2',       FALLBACK.ink2),
    ink3:       readVar('--ink-3',       FALLBACK.ink3),
    ink4:       readVar('--ink-4',       FALLBACK.ink4),
    good:       readVar('--good',        FALLBACK.good),
    warn:       readVar('--warn',        FALLBACK.warn),
    alert:      readVar('--alert',       FALLBACK.alert),
    info:       readVar('--info',        FALLBACK.info),
    chartGrid:  readVar('--chart-grid',  FALLBACK.chartGrid),
    chartAxis:  readVar('--chart-axis',  FALLBACK.chartAxis),
    chartInk:   readVar('--chart-ink',   FALLBACK.chartInk),
    chartMuted: readVar('--chart-muted', FALLBACK.chartMuted),
  };
}

/**
 * Hook-ähnlich (ohne Hook-API): liefert die aktuell aufgelösten Token-Werte.
 * Da das Theme via View Transition crossfaded wird, reicht es, beim Mount
 * und beim Theme-Change neu zu lesen — die meisten Recharts-Charts re-rendern
 * ohnehin, wenn der Theme-State im Redux-Store wechselt.
 */
export type ChartTokens = ReturnType<typeof chartTokens>;

/** Standard-Props für Recharts-XAxis/YAxis im neuen Designsystem. */
export function axisProps(t: ChartTokens) {
  return {
    stroke: t.chartAxis,
    tick: {
      fill: t.ink3,
      fontSize: 11,
      fontFamily: 'var(--font-mono)',
    },
    tickLine: { stroke: t.line },
    axisLine: { stroke: t.line },
  } as const;
}

/** Standard-Props für Recharts CartesianGrid. */
export function gridProps(t: ChartTokens) {
  return {
    stroke: t.chartGrid,
    strokeDasharray: '3 4',
    vertical: false,
  } as const;
}

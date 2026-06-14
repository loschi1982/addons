/**
 * period.ts – Zeitraum-Helfer für das einheitliche Zeitraum-Control (PeriodNavigator).
 *
 * Reine, testbare Funktionen: Bereich einer Granularitätseinheit, Vor/Zurück-Springen,
 * Beschriftung und sinnvolle Chart-Auflösung. Alle Datumswerte als lokales `YYYY-MM-DD`
 * (kein UTC-Versatz wie bei toISOString()).
 */

export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface PeriodValue {
  granularity: Granularity;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

const MONTHS_DE = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

/** Lokales Datum → YYYY-MM-DD (ohne Zeitzonen-Verschiebung). */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** YYYY-MM-DD → lokales Date (Mitternacht lokal). */
export function parseISO(s: string): Date {
  const [y, m, d] = (s || '').split('-').map(Number);
  return new Date(y || new Date().getFullYear(), (m || 1) - 1, d || 1);
}

function fmtDE(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** ISO-Kalenderwoche (1–53). */
function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = (t.getUTCDay() + 6) % 7; // Mo=0 … So=6
  t.setUTCDate(t.getUTCDate() - day + 3); // Donnerstag dieser Woche
  const firstThu = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const fday = (firstThu.getUTCDay() + 6) % 7;
  firstThu.setUTCDate(firstThu.getUTCDate() - fday + 3);
  const week = 1 + Math.round((t.getTime() - firstThu.getTime()) / (7 * 86400000));
  return { week, year: t.getUTCFullYear() };
}

/** Bereich der Granularitätseinheit, die `anchor` enthält. */
export function periodRange(gran: Granularity, anchor: Date): { start: string; end: string } {
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  switch (gran) {
    case 'day':
      return { start: isoDate(anchor), end: isoDate(anchor) };
    case 'week': {
      const dow = (anchor.getDay() + 6) % 7; // Mo=0 … So=6
      const mon = new Date(y, m, anchor.getDate() - dow);
      const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
      return { start: isoDate(mon), end: isoDate(sun) };
    }
    case 'month':
      return { start: isoDate(new Date(y, m, 1)), end: isoDate(new Date(y, m + 1, 0)) };
    case 'quarter': {
      const q = Math.floor(m / 3);
      return { start: isoDate(new Date(y, q * 3, 1)), end: isoDate(new Date(y, q * 3 + 3, 0)) };
    }
    case 'year':
      return { start: isoDate(new Date(y, 0, 1)), end: isoDate(new Date(y, 11, 31)) };
    case 'custom':
    default:
      return { start: isoDate(anchor), end: isoDate(anchor) };
  }
}

/** Zeitraum eine Einheit vor (+1) / zurück (−1). Bei custom um die Bereichslänge. */
export function shiftPeriod(
  gran: Granularity, start: string, end: string, dir: -1 | 1,
): { start: string; end: string } {
  const s = parseISO(start);
  switch (gran) {
    case 'day': {
      const d = new Date(s); d.setDate(d.getDate() + dir);
      return periodRange('day', d);
    }
    case 'week': {
      const d = new Date(s); d.setDate(d.getDate() + 7 * dir);
      return periodRange('week', d);
    }
    case 'month':
      return periodRange('month', new Date(s.getFullYear(), s.getMonth() + dir, 1));
    case 'quarter':
      return periodRange('quarter', new Date(s.getFullYear(), s.getMonth() + 3 * dir, 1));
    case 'year':
      return periodRange('year', new Date(s.getFullYear() + dir, 0, 1));
    case 'custom':
    default: {
      const e = parseISO(end);
      const lenDays = Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
      const ns = new Date(s); ns.setDate(ns.getDate() + dir * lenDays);
      const ne = new Date(e); ne.setDate(ne.getDate() + dir * lenDays);
      return { start: isoDate(ns), end: isoDate(ne) };
    }
  }
}

/** Beschriftung des Zeitraums (z. B. „November 2025", „Q4 2025", „KW 24 · 2026"). */
export function periodLabel(gran: Granularity, start: string, end: string): string {
  const s = parseISO(start);
  switch (gran) {
    case 'day':
      return fmtDE(s);
    case 'week': {
      const { week, year } = isoWeek(s);
      return `KW ${week} · ${year}`;
    }
    case 'month':
      return `${MONTHS_DE[s.getMonth()]} ${s.getFullYear()}`;
    case 'quarter':
      return `Q${Math.floor(s.getMonth() / 3) + 1} ${s.getFullYear()}`;
    case 'year':
      return `${s.getFullYear()}`;
    case 'custom':
    default:
      return `${fmtDE(s)} – ${fmtDE(parseISO(end))}`;
  }
}

/** Sinnvolle Chart-Auflösung je Zeitraum-Granularität. */
export function defaultAggregation(gran: Granularity): 'hourly' | 'daily' | 'weekly' | 'monthly' {
  switch (gran) {
    case 'day': return 'hourly';
    case 'week': return 'daily';
    case 'month': return 'daily';
    case 'quarter': return 'monthly';
    case 'year': return 'monthly';
    case 'custom':
    default: return 'monthly';
  }
}

/** Anfangswert: volle Einheit `gran` um `anchor` (Default: aktuelles Jahr). */
export function initialPeriod(gran: Granularity = 'year', anchor: Date = new Date()): PeriodValue {
  const base: Granularity = gran === 'custom' ? 'year' : gran;
  return { granularity: gran, ...periodRange(base, anchor) };
}

import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { setTheme, type ThemeMode } from '@/store/slices/uiSlice';

const THEME_KEY = 'em_theme';

function readStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'dark' || v === 'light') return v;
  } catch {
    /* ignore */
  }
  return null;
}

function applyTheme(v: ThemeMode) {
  document.documentElement.dataset.theme = v;
  try {
    localStorage.setItem(THEME_KEY, v);
  } catch {
    /* ignore */
  }
}

/**
 * Synchronisiert das Redux-UI-Theme mit dem `data-theme`-Attribut auf <html>
 * plus localStorage. Beim ersten Mount übernimmt der Hook ein zuvor (auf
 * einem anderen Tab) gewähltes Theme aus localStorage. Theme-Wechsel werden
 * als sanfter Crossfade via View Transition gespielt — der umgeht den
 * "hängenden Hintergrund"-Chromium-Bug, weil VT Snapshots überblendet statt
 * `background` zu animieren.
 */
export default function useAppTheme(): void {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((state) => state.ui.theme);
  const ready = useRef(false);

  // Beim ersten Mount: gespeichertes Theme aus localStorage übernehmen.
  useEffect(() => {
    const saved = readStoredTheme();
    if (saved && saved !== theme) dispatch(setTheme(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme anwenden + speichern. Erster Lauf: ohne View-Transition (deckungsgleich
  // mit dem Pre-Paint-Script in index.html). Folgewechsel: Crossfade.
  useEffect(() => {
    const v: ThemeMode = theme === 'dark' ? 'dark' : 'light';

    if (!ready.current) {
      ready.current = true;
      const saved = readStoredTheme();
      const initial = saved ?? v;
      applyTheme(initial);
      return;
    }

    if (document.documentElement.dataset.theme === v) return;

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const docStart = (document as Document & {
      startViewTransition?: (cb: () => void) => {
        finished?: Promise<void>;
        ready?: Promise<void>;
        updateCallbackDone?: Promise<void>;
      };
    }).startViewTransition;

    if (reduce || !docStart) {
      applyTheme(v);
      return;
    }

    const vt = docStart.call(document, () => applyTheme(v));
    // Rejections schlucken (bei schneller Mehrfach-Umschaltung möglich).
    vt?.finished && vt.finished.catch(() => {});
    vt?.ready && vt.ready.catch(() => {});
    vt?.updateCallbackDone && vt.updateCallbackDone.catch(() => {});
  }, [theme]);
}

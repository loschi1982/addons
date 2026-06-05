/** @type {import('tailwindcss').Config} */
//
// Tailwind-Token-Brücke zum globalen Designsystem aus `src/styles/globals.css`.
// Tokens zeigen auf CSS-Variablen, damit Hell/Dunkel über `data-theme="dark"`
// automatisch greift. Bestehende `bg-primary-*` / `bg-energy-*` Klassen
// bleiben funktionsfähig, ziehen aber die neuen Marken-Werte.
//
// Marken-Quelle: Claude-Design Handoff (EM_ENERGY, --fw-*, --ink/--surface).
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // App-Primärfarbe = Ink (Schwarzton) im neuen System.
        // Die Stufen bleiben verfügbar, lösen sich aber auf semantische Tokens auf.
        primary: {
          50:  'var(--surface)',
          100: 'var(--surface-2)',
          200: 'var(--line)',
          300: 'var(--line-strong)',
          400: 'var(--ink-3)',
          500: 'var(--ink)',
          600: 'var(--ink)',
          700: 'var(--ink)',
          800: 'var(--ink)',
          900: 'var(--ink)',
          DEFAULT: 'var(--ink)',
        },
        // Marken-Energiefarben (identisch in beiden Themes).
        energy: {
          electricity: 'var(--fw-strom)',
          strom:       'var(--fw-strom)',
          gas:         'var(--fw-fernwaerme)',
          heating:     'var(--fw-fernwaerme)',
          fernwaerme:  'var(--fw-fernwaerme)',
          district:    'var(--fw-fernwaerme)',
          water:       'var(--fw-wasser)',
          wasser:      'var(--fw-wasser)',
          cooling:     'var(--fw-kaelte)',
          kaelte:      'var(--fw-kaelte)',
          // Diese drei waren im Bestand für Sonderträger gesetzt – auf
          // semantisch passende Marken-Werte gemappt (Strom-Gelb / Ink).
          solar:   'var(--good)',
          oil:     'var(--ink-3)',
          pellets: 'var(--good)',
        },
        status: {
          success: 'var(--good)',
          warning: 'var(--warn)',
          error:   'var(--alert)',
          info:    'var(--info)',
        },
        // Gray-Palette zeigt auf die theme-aware Tokens, sodass bestehende
        // `bg-gray-50` / `text-gray-900` / `border-gray-200` etc. automatisch
        // im Dark-Mode dunkle Surfaces / helle Text-Töne verwenden.
        // Die Treppe wird so abgebildet: 50=bg, 100/200=line, 300=line-strong,
        // 400/500=ink-4..ink-2, 600/700=ink-2..ink, 800/900=ink (Hell).
        // Im Dark-Mode flippt das automatisch über die CSS-Vars.
        gray: {
          50:  'var(--bg)',
          100: 'var(--surface-2)',
          150: 'var(--surface-2)',
          200: 'var(--line)',
          300: 'var(--line-strong)',
          400: 'var(--ink-4)',
          500: 'var(--ink-3)',
          600: 'var(--ink-2)',
          700: 'var(--ink-2)',
          800: 'var(--ink)',
          900: 'var(--ink)',
          950: 'var(--ink)',
        },
        white: 'var(--surface)',
        black: 'var(--ink)',
        // Semantische Tokens als direkte Klassen (z. B. `bg-surface`).
        bg:           'var(--bg)',
        surface:      'var(--surface)',
        'surface-2':  'var(--surface-2)',
        line:         'var(--line)',
        'line-strong':'var(--line-strong)',
        ink:          'var(--ink)',
        'ink-2':      'var(--ink-2)',
        'ink-3':      'var(--ink-3)',
        'ink-4':      'var(--ink-4)',
        good:         'var(--good)',
        warn:         'var(--warn)',
        alert:        'var(--alert)',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
      },
    },
  },
  plugins: [],
};

interface SegOption<T extends string = string> {
  value: T;
  label: string;
}

interface SegControlProps<T extends string = string> {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<SegOption<T>>;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Segmented Control im Designsystem-Look (1 px `--line`, Radius `--r-sm`,
 * aktiv = Ink-BG / Surface-Text). Schmal & ruhig, für Auflösungs-Switches,
 * Karten/Tabelle-Toggles, Werkstatt/Tabelle-Modus etc.
 */
export default function SegControl<T extends string = string>({
  value,
  onChange,
  options,
  size = 'md',
  className = '',
}: SegControlProps<T>) {
  const padY = size === 'sm' ? 4 : 5;
  const padX = size === 'sm' ? 8 : 10;
  const fontSize = size === 'sm' ? 11 : 12;
  return (
    <div
      className={`inline-flex overflow-hidden ${className}`}
      style={{
        border: '1px solid var(--line)',
        background: 'var(--surface)',
        borderRadius: 'var(--r-sm)',
      }}
      role="tablist"
    >
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            style={{
              padding: `${padY}px ${padX}px`,
              fontSize,
              fontWeight: active ? 500 : 400,
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--surface)' : 'var(--ink-3)',
              borderRight: i < options.length - 1 ? '1px solid var(--line)' : 'none',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

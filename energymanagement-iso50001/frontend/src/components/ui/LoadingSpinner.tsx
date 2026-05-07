/**
 * LoadingSpinner – Einheitliche Ladeanimation für alle Seiten.
 *
 * Varianten:
 *  - "page"    → Ganzseitiger Spinner (zentriert, volle Höhe)
 *  - "section" → Innerhalb einer Karte/Box (h-48)
 *  - "inline"  → Kompakt, z.B. neben einem Button
 */

interface LoadingSpinnerProps {
  variant?: 'page' | 'section' | 'inline';
  text?: string;
}

export default function LoadingSpinner({ variant = 'section', text }: LoadingSpinnerProps) {
  const sizeClass = variant === 'inline' ? 'h-4 w-4' : 'h-8 w-8';
  const wrapperClass =
    variant === 'page'
      ? 'flex min-h-[60vh] items-center justify-center'
      : variant === 'section'
        ? 'flex h-48 items-center justify-center'
        : 'inline-flex items-center gap-2';

  return (
    <div className={wrapperClass}>
      <div className="flex flex-col items-center gap-3">
        <div
          className={`${sizeClass} animate-spin rounded-full border-4 border-primary-200 border-t-primary-600`}
        />
        {text && variant !== 'inline' && (
          <p className="text-sm text-gray-500">{text}</p>
        )}
      </div>
    </div>
  );
}

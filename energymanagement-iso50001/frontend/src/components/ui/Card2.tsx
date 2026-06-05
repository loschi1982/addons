import type { HTMLAttributes, ReactNode } from 'react';

interface Card2Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optionaler Card-Head (Title + Sub + Controls). */
  title?: ReactNode;
  sub?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
}

/**
 * Designsystem-Card: weiße Fläche, 1 px `--line`, Radius `--r-lg` (16 px),
 * 18 px Padding. Hover-Lift via globaler CSS. Heißt `Card2`, damit die
 * bestehende Tailwind-`.card`-Klasse nicht kollidiert.
 */
export default function Card2({ title, sub, controls, children, className, ...rest }: Card2Props) {
  const hasHead = Boolean(title || sub || controls);
  return (
    <div className={`dv-card ${className ?? ''}`} {...rest}>
      {hasHead && (
        <div className="card-head">
          <div>
            {title && <div className="card-title">{title}</div>}
            {sub && <div className="card-sub">{sub}</div>}
          </div>
          {controls && <div className="card-controls">{controls}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

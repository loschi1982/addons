import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';

interface InfoTipProps {
  title: string;
  formula?: string;
  children: React.ReactNode;
}

/**
 * InfoTip – Kleines ℹ-Icon das bei Klick ein Popover mit Formel + Erklärung zeigt.
 *
 * Verwendung:
 *   <InfoTip title="CO₂-Emissionen" formula="CO₂ = Verbrauch × Faktor ÷ 1000">
 *     Emissionsfaktor je Energieträger (BAFA/UBA).
 *   </InfoTip>
 */
export default function InfoTip({ title, formula, children }: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <span className="relative inline-flex items-center" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="ml-1 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none"
        aria-label={`Info: ${title}`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg text-left">
          <div className="text-xs font-semibold text-gray-900 mb-1">{title}</div>
          {formula && (
            <div className="mb-1.5 rounded bg-gray-50 px-2 py-1 font-mono text-xs text-primary-700 border border-gray-100">
              {formula}
            </div>
          )}
          <div className="text-xs text-gray-600 leading-relaxed">{children}</div>
        </div>
      )}
    </span>
  );
}

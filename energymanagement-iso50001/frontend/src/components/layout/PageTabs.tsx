import { useNavigate, useLocation } from 'react-router-dom';

interface TabItem {
  path: string;
  label: string;
}

export const COST_TABS: TabItem[] = [
  { path: '/economics', label: 'Wirtschaftlichkeit' },
  { path: '/cost-allocation', label: 'Kostenumlage' },
  { path: '/contracts', label: 'Verträge' },
];

export const ANALYSIS_TABS: TabItem[] = [
  { path: '/energy-review', label: 'Energiebewertung' },
  { path: '/analytics', label: 'Auswertungen' },
  { path: '/load-profile', label: 'Lastprofil' },
  { path: '/data-quality', label: 'Datenqualität' },
];

/**
 * Page-Tab-Bar im Designsystem-Look — Ink-aktiv, neutraler Hover,
 * Underline über Token-Border. Bündelt mehrere Routen unter einer
 * Sidebar-Kategorie (z. B. Kosten & Wirtschaft).
 */
export default function PageTabs({ tabs }: { tabs: TabItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname;

  return (
    <div style={{ marginBottom: 16, borderBottom: '1px solid var(--line)' }}>
      <nav className="flex" style={{ gap: 4, marginBottom: -1 }}>
        {tabs.map((t) => {
          const active = current === t.path;
          return (
            <button
              key={t.path}
              type="button"
              onClick={() => navigate(t.path)}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--ink)' : 'var(--ink-3)',
                background: 'transparent',
                border: 'none',
                borderBottom: active ? '2px solid var(--ink)' : '2px solid transparent',
                cursor: 'pointer',
                transition: 'color 160ms ease, border-color 200ms cubic-bezier(0.22, 1, 0.36, 1)',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--ink)';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--ink-3)';
              }}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

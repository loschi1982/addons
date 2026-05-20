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

export default function PageTabs({ tabs }: { tabs: TabItem[] }) {
  const navigate = useNavigate();
  const location = useLocation();
  const current = location.pathname;

  return (
    <div className="mb-4 border-b border-gray-200">
      <nav className="-mb-px flex gap-1">
        {tabs.map((t) => {
          const active = current === t.path;
          return (
            <button
              key={t.path}
              onClick={() => navigate(t.path)}
              className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BarChart3,
  Building2,
  Gauge,
  ClipboardList,
  Zap,
  Activity,
  Cloud,
  Thermometer,
  FileText,
  Shield,
  Users,
  Upload,
  LayoutDashboard,
  ChevronLeft,
  ChevronRight,
  Leaf,
  TrendingUp,
  Settings,
  Globe,
  Network,
  Euro,
  GitCompare,
  Table2,
  PieChart,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { toggleSidebar } from '@/store/slices/uiSlice';

const navItems = [
  { path: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
  { path: '/sites', labelKey: 'nav.sites', icon: Building2 },
  { path: '/meters', labelKey: 'nav.meters', icon: Gauge },
  { path: '/meter-map', labelKey: 'nav.meterMap', icon: Network },
  { path: '/readings', labelKey: 'nav.readings', icon: ClipboardList },
  { path: '/consumers', labelKey: 'nav.consumers', icon: Zap },
  { path: '/energy-review', labelKey: 'nav.energyReview', icon: Activity },
  { path: '/schemas', labelKey: 'nav.schema', icon: BarChart3 },
  { path: '/analytics', labelKey: 'nav.analytics', icon: TrendingUp },
  { path: '/monthly-comparison', labelKey: 'nav.monthlyComparison', icon: GitCompare },
  { path: '/energy-balance', labelKey: 'nav.energyBalance', icon: Table2 },
  { path: '/cost-allocation', labelKey: 'nav.costAllocation', icon: PieChart },
  { path: '/economics', labelKey: 'nav.economics', icon: Euro },
  { path: '/emissions', labelKey: 'nav.emissions', icon: Leaf },
  { path: '/weather', labelKey: 'nav.weather', icon: Cloud },
  { path: '/climate', labelKey: 'nav.climate', icon: Thermometer },
  { path: '/reports', labelKey: 'nav.reports', icon: FileText },
  { path: '/import', labelKey: 'nav.import', icon: Upload },
  { path: '/iso', labelKey: 'nav.iso', icon: Shield },
  { path: '/users', labelKey: 'nav.users', icon: Users },
  { path: '/settings', labelKey: 'nav.settings', icon: Settings },
];

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const { sidebarOpen } = useAppSelector((state) => state.ui);
  const { t, i18n } = useTranslation();

  const toggleLanguage = () => {
    const next = i18n.language === 'de' ? 'en' : 'de';
    i18n.changeLanguage(next);
  };

  return (
    <aside
      role="navigation"
      aria-label={t('nav.dashboard')}
      className={`fixed inset-y-0 left-0 z-30 flex flex-col bg-primary-800 text-white transition-all duration-300 ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}
    >
      {/* Logo */}
      <div className="flex h-16 items-center justify-between px-4">
        {sidebarOpen && (
          <span className="text-lg font-semibold tracking-tight">EnergieManager</span>
        )}
        <button
          onClick={() => dispatch(toggleSidebar())}
          className="rounded p-1 hover:bg-primary-700"
          aria-label={sidebarOpen ? 'Sidebar einklappen' : 'Sidebar ausklappen'}
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4" aria-label="Hauptnavigation">
        {navItems.map(({ path, labelKey, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            aria-label={t(labelKey)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-primary-700 text-white font-medium'
                  : 'text-primary-200 hover:bg-primary-700 hover:text-white'
              }`
            }
          >
            <Icon size={20} aria-hidden="true" />
            {sidebarOpen && <span>{t(labelKey)}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Sprachumschalter + Version */}
      <div className="border-t border-primary-700 px-4 py-3">
        <button
          onClick={toggleLanguage}
          className="flex items-center gap-2 text-xs text-primary-300 hover:text-white transition-colors w-full"
          aria-label={`Sprache wechseln zu ${i18n.language === 'de' ? 'English' : 'Deutsch'}`}
        >
          <Globe size={14} aria-hidden="true" />
          {sidebarOpen && (
            <span>{i18n.language === 'de' ? 'DE' : 'EN'} / {i18n.language === 'de' ? 'English' : 'Deutsch'}</span>
          )}
        </button>
        {sidebarOpen && (
          <div className="mt-2 text-xs text-primary-400">
            v1.0.0 &middot; ISO 50001
          </div>
        )}
      </div>
    </aside>
  );
}

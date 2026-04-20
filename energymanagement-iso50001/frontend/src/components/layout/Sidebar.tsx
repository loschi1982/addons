import { useState } from 'react';
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
  ChevronDown,
  Leaf,
  TrendingUp,
  Settings,
  Globe,
  Network,
  Euro,
  PieChart,
  Handshake,
  BookOpen,
  GraduationCap,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { toggleSidebar } from '@/store/slices/uiSlice';

/* ── Navigationsstruktur mit Gruppen ── */

interface NavItem {
  path: string;
  labelKey: string;
  icon: LucideIcon;
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: 'nav.group.overview',
    items: [
      { path: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard },
    ],
  },
  {
    labelKey: 'nav.group.master_data',
    items: [
      { path: '/sites', labelKey: 'nav.sites', icon: Building2 },
      { path: '/meters', labelKey: 'nav.meters', icon: Gauge },
      { path: '/readings', labelKey: 'nav.readings', icon: ClipboardList },
      { path: '/consumers', labelKey: 'nav.consumers', icon: Zap },
    ],
  },
  {
    labelKey: 'nav.group.analysis',
    items: [
      { path: '/energy-review', labelKey: 'nav.energyReview', icon: Activity },
      { path: '/schemas', labelKey: 'nav.schema', icon: Network },
      { path: '/analytics', labelKey: 'nav.analytics', icon: TrendingUp },
      { path: '/load-profile', labelKey: 'nav.loadProfile', icon: BarChart3 },
    ],
  },
  {
    labelKey: 'nav.group.costs',
    items: [
      { path: '/cost-allocation', labelKey: 'nav.costAllocation', icon: PieChart },
      { path: '/contracts', labelKey: 'nav.contracts', icon: Handshake },
      { path: '/economics', labelKey: 'nav.economics', icon: Euro },
    ],
  },
  {
    labelKey: 'nav.group.environment',
    items: [
      { path: '/emissions', labelKey: 'nav.emissions', icon: Leaf },
      { path: '/weather', labelKey: 'nav.weather', icon: Cloud },
      { path: '/climate', labelKey: 'nav.climate', icon: Thermometer },
    ],
  },
  {
    labelKey: 'nav.group.iso',
    items: [
      { path: '/iso', labelKey: 'nav.iso', icon: Shield },
      { path: '/benchmarking', labelKey: 'nav.benchmarking', icon: BookOpen },
      { path: '/trainings', labelKey: 'nav.trainings', icon: GraduationCap },
      { path: '/control-strategies', labelKey: 'nav.controlStrategies', icon: SlidersHorizontal },
    ],
  },
  {
    labelKey: 'nav.group.system',
    items: [
      { path: '/reports', labelKey: 'nav.reports', icon: FileText },
      { path: '/import', labelKey: 'nav.import', icon: Upload },
      { path: '/users', labelKey: 'nav.users', icon: Users },
      { path: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const { sidebarOpen } = useAppSelector((state) => state.ui);
  const { t, i18n } = useTranslation();

  // Gruppen auf-/zuklappen – standardmäßig alle offen
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
      <nav className="flex-1 overflow-y-auto py-2" aria-label="Hauptnavigation">
        {navGroups.map((group) => {
          const isCollapsed = collapsed.has(group.labelKey);
          return (
            <div key={group.labelKey} className="mb-1">
              {/* Gruppenüberschrift – nur bei offener Sidebar */}
              {sidebarOpen ? (
                <button
                  onClick={() => toggleGroup(group.labelKey)}
                  className="flex w-full items-center justify-between px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary-400 hover:text-primary-200 transition-colors"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              ) : (
                <div className="mx-3 my-2 border-t border-primary-700" />
              )}

              {/* Einträge */}
              {(!isCollapsed || !sidebarOpen) && group.items.map(({ path, labelKey, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  aria-label={t(labelKey)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                      isActive
                        ? 'bg-primary-700 text-white font-medium'
                        : 'text-primary-200 hover:bg-primary-700 hover:text-white'
                    }`
                  }
                >
                  <Icon size={18} aria-hidden="true" />
                  {sidebarOpen && <span>{t(labelKey)}</span>}
                </NavLink>
              ))}
            </div>
          );
        })}
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

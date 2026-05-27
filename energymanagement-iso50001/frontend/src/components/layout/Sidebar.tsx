import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
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
  Settings,
  Globe,
  Network,
  Euro,
  BookOpen,
  GraduationCap,
  SlidersHorizontal,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { toggleSidebar } from '@/store/slices/uiSlice';

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
      { path: '/schemas', labelKey: 'nav.schema', icon: Network },
      { path: '/readings', labelKey: 'nav.readings', icon: ClipboardList },
      { path: '/outliers', labelKey: 'nav.outliers', icon: AlertTriangle },
      { path: '/consumers', labelKey: 'nav.consumers', icon: Zap },
    ],
  },
  {
    labelKey: 'nav.group.analysis',
    items: [
      { path: '/energy-review', labelKey: 'nav.analysis', icon: Activity },
      { path: '/reports', labelKey: 'nav.reports', icon: FileText },
    ],
  },
  {
    labelKey: 'nav.group.costs',
    items: [
      { path: '/economics', labelKey: 'nav.costsEconomy', icon: Euro },
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
      { path: '/import', labelKey: 'nav.import', icon: Upload },
      { path: '/users', labelKey: 'nav.users', icon: Users },
      { path: '/settings', labelKey: 'nav.settings', icon: Settings },
    ],
  },
];

const SIDEBAR_BG     = '#0E1419';
const SIDEBAR_LINE   = '#1E252D';
const SIDEBAR_DIM    = '#8C9097';
const SIDEBAR_INK    = '#FAFAF7';
const ACCENT_COLOR   = '#E89A3C';

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const { sidebarOpen, backupLocked } = useAppSelector((state) => state.ui);
  const { t, i18n } = useTranslation();

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
      style={{ background: SIDEBAR_BG, borderRight: `1px solid #060A0E` }}
      className={`fixed inset-y-0 left-0 z-30 flex flex-col text-white transition-all duration-300 ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}
    >
      {/* Brand */}
      <div
        style={{ borderBottom: `1px solid ${SIDEBAR_LINE}` }}
        className="flex h-16 items-center justify-between px-4"
      >
        {sidebarOpen && (
          <div className="flex items-center gap-2.5">
            <div
              style={{
                width: 22, height: 22,
                background: 'linear-gradient(135deg, #E89A3C, #F2C94C)',
                borderRadius: 5,
                display: 'grid', placeItems: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1L10.33 9H1.67L6 1Z" fill="white" fillOpacity="0.9"/>
              </svg>
            </div>
            <span style={{ color: SIDEBAR_INK, fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>
              EnergieManager
            </span>
          </div>
        )}
        <button
          onClick={() => dispatch(toggleSidebar())}
          style={{ color: SIDEBAR_DIM }}
          className="rounded p-1 hover:opacity-100 transition-opacity"
          aria-label={sidebarOpen ? 'Sidebar einklappen' : 'Sidebar ausklappen'}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 relative" aria-label="Hauptnavigation">
        {backupLocked && (
          <div
            style={{ background: 'rgba(14,20,25,0.85)' }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center cursor-not-allowed select-none"
          >
            <AlertTriangle size={20} className="text-amber-400 mb-2" />
            {sidebarOpen && (
              <p className="text-xs text-amber-300 text-center px-4 leading-snug">
                Datensicherung läuft –<br />Navigation gesperrt
              </p>
            )}
          </div>
        )}

        {navGroups.map((group) => {
          const isCollapsed = collapsed.has(group.labelKey);
          return (
            <div key={group.labelKey} className="mb-1">
              {sidebarOpen ? (
                <button
                  onClick={() => !backupLocked && toggleGroup(group.labelKey)}
                  style={{ color: SIDEBAR_DIM, fontSize: 10, letterSpacing: '0.08em' }}
                  className="flex w-full items-center justify-between px-4 py-1.5 font-semibold uppercase hover:opacity-100 transition-opacity"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              ) : (
                <div style={{ borderTop: `1px solid ${SIDEBAR_LINE}` }} className="mx-3 my-2" />
              )}

              {(!isCollapsed || !sidebarOpen) &&
                group.items.map(({ path, labelKey, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    aria-label={t(labelKey)}
                    aria-disabled={backupLocked}
                    onClick={(e) => { if (backupLocked) e.preventDefault(); }}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-[7px] text-sm transition-all ${
                        isActive ? 'font-medium' : ''
                      }`
                    }
                    style={({ isActive }) => isActive
                      ? {
                          color: '#FFFFFF',
                          background: `rgba(232, 154, 60, 0.08)`,
                          borderLeft: `2px solid ${ACCENT_COLOR}`,
                          paddingLeft: 14,
                        }
                      : {
                          color: SIDEBAR_INK,
                          opacity: 0.82,
                          borderLeft: '2px solid transparent',
                        }
                    }
                  >
                    <Icon size={16} aria-hidden="true" />
                    {sidebarOpen && <span style={{ fontSize: 13 }}>{t(labelKey)}</span>}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: `1px solid ${SIDEBAR_LINE}` }} className="px-4 py-3">
        <button
          onClick={toggleLanguage}
          style={{ color: SIDEBAR_DIM, fontSize: 12 }}
          className="flex items-center gap-2 hover:opacity-100 transition-opacity w-full"
          aria-label={`Sprache wechseln zu ${i18n.language === 'de' ? 'English' : 'Deutsch'}`}
        >
          <Globe size={14} aria-hidden="true" />
          {sidebarOpen && (
            <span>{i18n.language === 'de' ? 'DE' : 'EN'} / {i18n.language === 'de' ? 'English' : 'Deutsch'}</span>
          )}
        </button>
        {sidebarOpen && (
          <div style={{ color: SIDEBAR_DIM, fontSize: 11, marginTop: 8 }}>
            v1.0.0 · ISO 50001
          </div>
        )}
      </div>
    </aside>
  );
}

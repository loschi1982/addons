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
  /** Zusatzpfade, die diesen Eintrag als aktiv markieren (Sub-Tabs). */
  alsoActiveFor?: string[];
}

interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    labelKey: 'nav.group.overview',
    items: [{ path: '/dashboard', labelKey: 'nav.dashboard', icon: LayoutDashboard }],
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
      {
        path: '/energy-review',
        labelKey: 'nav.analysis',
        icon: Activity,
        alsoActiveFor: ['/analytics', '/load-profile', '/data-quality', '/monthly-comparison', '/energy-balance'],
      },
      { path: '/reports', labelKey: 'nav.reports', icon: FileText },
    ],
  },
  {
    labelKey: 'nav.group.costs',
    items: [
      {
        path: '/economics',
        labelKey: 'nav.costsEconomy',
        icon: Euro,
        alsoActiveFor: ['/cost-allocation', '/contracts'],
      },
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

const ACCENT_COLOR = 'var(--fw-fernwaerme)';

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
      className={`fixed inset-y-0 left-0 z-30 flex flex-col text-white transition-all duration-300 ${
        sidebarOpen ? 'w-64' : 'w-16'
      }`}
      style={{
        background: 'var(--sidebar-bg)',
        color: 'var(--sidebar-ink)',
        borderRight: '1px solid var(--sidebar-line)',
        fontSize: 13,
      }}
    >
      {/* Brand */}
      <div
        style={{ borderBottom: '1px solid var(--sidebar-line)' }}
        className="flex h-16 items-center justify-between px-4"
      >
        {sidebarOpen && (
          <div className="flex items-center gap-2.5">
            <div
              style={{
                width: 22,
                height: 22,
                background: 'linear-gradient(135deg, #E89A3C, #F2C94C)',
                borderRadius: 5,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1L10.33 9H1.67L6 1Z" fill="#FAFAF7" />
              </svg>
            </div>
            <span style={{ color: 'var(--sidebar-ink)', fontWeight: 600, fontSize: 14, letterSpacing: '-0.01em' }}>
              EnergieManager
            </span>
          </div>
        )}
        <button
          onClick={() => dispatch(toggleSidebar())}
          style={{ color: 'var(--sidebar-dim)' }}
          className="rounded p-1 transition-opacity hover:opacity-100"
          aria-label={sidebarOpen ? 'Sidebar einklappen' : 'Sidebar ausklappen'}
        >
          {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="relative flex-1 overflow-y-auto py-2" aria-label="Hauptnavigation">
        {backupLocked && (
          <div
            style={{ background: 'rgba(14,20,25,0.85)' }}
            className="absolute inset-0 z-10 flex cursor-not-allowed select-none flex-col items-center justify-center"
          >
            <AlertTriangle size={20} style={{ color: 'var(--fw-strom)' }} className="mb-2" />
            {sidebarOpen && (
              <p style={{ color: 'var(--fw-strom)' }} className="px-4 text-center text-xs leading-snug">
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
                  style={{
                    color: 'var(--sidebar-dim)',
                    fontSize: 10,
                    letterSpacing: '0.08em',
                  }}
                  className="flex w-full items-center justify-between px-[18px] py-1.5 font-semibold uppercase transition-opacity hover:opacity-100"
                >
                  <span>{t(group.labelKey)}</span>
                  <ChevronDown
                    size={12}
                    className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                  />
                </button>
              ) : (
                <div style={{ borderTop: '1px solid var(--sidebar-line)' }} className="mx-3 my-2" />
              )}

              {(!isCollapsed || !sidebarOpen) &&
                group.items.map(({ path, labelKey, icon: Icon, alsoActiveFor }) => (
                  <NavLink
                    key={path}
                    to={path}
                    aria-label={t(labelKey)}
                    aria-disabled={backupLocked}
                    onClick={(e) => {
                      if (backupLocked) e.preventDefault();
                    }}
                    className="flex items-center gap-[10px] px-[18px] transition-all"
                    style={({ isActive }) => {
                      const subActive = alsoActiveFor?.some((p) =>
                        window.location.hash.startsWith(`#${p}`)
                      ) ?? false;
                      return (isActive || subActive)
                        ? {
                            color: '#FFFFFF',
                            background: 'rgba(232, 154, 60, 0.08)',
                            borderLeft: `2px solid ${ACCENT_COLOR}`,
                            paddingLeft: 16,
                            paddingTop: 7,
                            paddingBottom: 7,
                            fontWeight: 500,
                          }
                        : {
                            color: 'var(--sidebar-ink)',
                            opacity: 0.82,
                            borderLeft: '2px solid transparent',
                            paddingTop: 7,
                            paddingBottom: 7,
                          };
                    }}
                  >
                    <Icon size={15} aria-hidden="true" />
                    {sidebarOpen && <span style={{ fontSize: 13 }}>{t(labelKey)}</span>}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{ borderTop: '1px solid var(--sidebar-line)' }} className="px-4 py-3">
        <button
          onClick={toggleLanguage}
          style={{ color: 'var(--sidebar-dim)', fontSize: 12 }}
          className="flex w-full items-center gap-2 transition-opacity hover:opacity-100"
          aria-label={`Sprache wechseln zu ${i18n.language === 'de' ? 'English' : 'Deutsch'}`}
        >
          <Globe size={14} aria-hidden="true" />
          {sidebarOpen && (
            <span>
              {i18n.language === 'de' ? 'DE' : 'EN'} / {i18n.language === 'de' ? 'English' : 'Deutsch'}
            </span>
          )}
        </button>
        {sidebarOpen && (
          <div style={{ color: 'var(--sidebar-dim)', fontSize: 11, marginTop: 8 }}>v1.0.0 · ISO 50001</div>
        )}
      </div>
    </aside>
  );
}

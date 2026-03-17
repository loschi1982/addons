import { NavLink } from 'react-router-dom';
import {
  BarChart3,
  Building2,
  Gauge,
  ClipboardList,
  Zap,
  Cloud,
  Thermometer,
  FileText,
  Shield,
  Users,
  Upload,
  LayoutDashboard,
  Plug,
  ChevronLeft,
  ChevronRight,
  Leaf,
} from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { toggleSidebar } from '@/store/slices/uiSlice';

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/sites', label: 'Standorte', icon: Building2 },
  { path: '/meters', label: 'Zähler', icon: Gauge },
  { path: '/readings', label: 'Zählerstände', icon: ClipboardList },
  { path: '/consumers', label: 'Verbraucher', icon: Zap },
  { path: '/schemas', label: 'Energieschema', icon: BarChart3 },
  { path: '/emissions', label: 'CO₂-Emissionen', icon: Leaf },
  { path: '/weather', label: 'Wetterdaten', icon: Cloud },
  { path: '/climate', label: 'Klimasensoren', icon: Thermometer },
  { path: '/reports', label: 'Berichte', icon: FileText },
  { path: '/import', label: 'Datenimport', icon: Upload },
  { path: '/integrations', label: 'Integrationen', icon: Plug },
  { path: '/iso', label: 'ISO 50001', icon: Shield },
  { path: '/users', label: 'Benutzer', icon: Users },
];

export default function Sidebar() {
  const dispatch = useAppDispatch();
  const { sidebarOpen } = useAppSelector((state) => state.ui);

  return (
    <aside
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
        >
          {sidebarOpen ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4">
        {navItems.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                isActive
                  ? 'bg-primary-700 text-white font-medium'
                  : 'text-primary-200 hover:bg-primary-700 hover:text-white'
              }`
            }
          >
            <Icon size={20} />
            {sidebarOpen && <span>{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Version */}
      {sidebarOpen && (
        <div className="border-t border-primary-700 px-4 py-3 text-xs text-primary-400">
          v1.0.0 &middot; ISO 50001
        </div>
      )}
    </aside>
  );
}

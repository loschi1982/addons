import { useEffect, useRef, useState } from 'react';
import { LogOut, Moon, Sun, KeyRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { logout } from '@/store/slices/authSlice';
import { toggleTheme } from '@/store/slices/uiSlice';

/**
 * Globaler App-Header.
 *
 * Rechter Cluster: Theme-Toggle (Sonne/Mond, 34 px rund) + User-Chip mit
 * Initial-Avatar (AD/…) und Pop-Over (Passwort ändern / Abmelden).
 * Linker Cluster: leer – jede Page setzt ihren eigenen `.eyebrow` + `.page-title`
 * über die normale Content-Area. So bleibt der Header schlicht und
 * page-spezifische Controls können bei Bedarf direkt im Content gerendert werden.
 */
export default function Header() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { user } = useAppSelector((state) => state.auth);
  const theme = useAppSelector((state) => state.ui.theme);

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(ev: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [menuOpen]);

  const name = user?.displayName || user?.username || 'Benutzer';
  const role = user?.roleName || 'Energiemanager';
  const initials = (user?.displayName || user?.username || 'AD')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'AD';

  const dark = theme === 'dark';

  return (
    <header
      className="flex items-center justify-between"
      style={{
        padding: '18px 24px 12px',
        gap: 24,
        background: 'var(--bg)',
      }}
    >
      <div />

      <div className="flex items-center" style={{ gap: 18 }}>
        {/* Theme Toggle */}
        <button
          className="theme-toggle"
          onClick={() => dispatch(toggleTheme())}
          aria-label={dark ? 'Zu hellem Modus wechseln' : 'Zu dunklem Modus wechseln'}
          title={dark ? 'Heller Modus' : 'Dunkler Modus'}
        >
          <span className={`theme-thumb ${dark ? 'dark' : 'light'}`}>
            {dark ? <Moon size={14} /> : <Sun size={14} />}
          </span>
        </button>

        {/* User-Chip mit Pop-Over */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            className="user-chip"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <div className="user-chip-avatar">{initials}</div>
            <div>
              <div className="user-chip-name">{name}</div>
              <div className="user-chip-role">{role}</div>
            </div>
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-40 mt-2 min-w-[200px] overflow-hidden"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--r-md)',
                boxShadow: '0 12px 32px -8px rgba(0,0,0,0.18)',
              }}
            >
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  navigate('/change-password');
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--ink)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <KeyRound size={14} aria-hidden="true" />
                <span>Passwort ändern</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  dispatch(logout());
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors"
                style={{ color: 'var(--alert)' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <LogOut size={14} aria-hidden="true" />
                <span>Abmelden</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

import { LogOut, User } from 'lucide-react';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { logout } from '@/store/slices/authSlice';

export default function Header() {
  const dispatch = useAppDispatch();
  const { user } = useAppSelector((state) => state.auth);

  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div />

      <div className="flex items-center gap-4">
        {/* Benutzerinfo */}
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <User size={18} />
          <span>{user?.displayName || user?.username || 'Benutzer'}</span>
          {user?.roleName && (
            <span className="rounded bg-primary-100 px-2 py-0.5 text-xs text-primary-700">
              {user.roleName}
            </span>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={() => dispatch(logout())}
          className="flex items-center gap-1 rounded px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700"
        >
          <LogOut size={16} />
          <span>Abmelden</span>
        </button>
      </div>
    </header>
  );
}

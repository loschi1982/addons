import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAppSelector } from '@/hooks/useRedux';
import useAppTheme from '@/hooks/useAppTheme';

export default function MainLayout() {
  const { sidebarOpen } = useAppSelector((state) => state.ui);
  useAppTheme();

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--ink)' }}>
      <Sidebar />
      <div
        className={`flex flex-1 flex-col overflow-hidden transition-[margin] duration-300 ${
          sidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        <Header />
        <main
          className="flex-1 overflow-y-auto"
          role="main"
          aria-label="Hauptinhalt"
          style={{ background: 'var(--bg)' }}
        >
          <div className="content" style={{ padding: '0 24px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAppSelector } from '@/hooks/useRedux';

export default function MainLayout() {
  const { sidebarOpen } = useAppSelector((state) => state.ui);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div
        className={`flex flex-1 flex-col overflow-hidden transition-all duration-300 ${
          sidebarOpen ? 'ml-64' : 'ml-16'
        }`}
      >
        <Header />
        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

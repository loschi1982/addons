import { Routes, Route, Navigate } from 'react-router-dom';

import { useAppSelector } from '@/hooks/useRedux';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import SitesPage from '@/pages/SitesPage';
import MetersPage from '@/pages/MetersPage';
import ReadingsPage from '@/pages/ReadingsPage';
import ConsumersPage from '@/pages/ConsumersPage';
import SchemasPage from '@/pages/SchemasPage';
import EmissionsPage from '@/pages/EmissionsPage';
import WeatherPage from '@/pages/WeatherPage';
import ClimatePage from '@/pages/ClimatePage';
import ReportsPage from '@/pages/ReportsPage';
import ISOPage from '@/pages/ISOPage';
import UsersPage from '@/pages/UsersPage';
import ImportPage from '@/pages/ImportPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAppSelector((state) => state.auth);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sites/*" element={<SitesPage />} />
        <Route path="meters/*" element={<MetersPage />} />
        <Route path="readings" element={<ReadingsPage />} />
        <Route path="consumers" element={<ConsumersPage />} />
        <Route path="schemas/*" element={<SchemasPage />} />
        <Route path="emissions" element={<EmissionsPage />} />
        <Route path="weather" element={<WeatherPage />} />
        <Route path="climate" element={<ClimatePage />} />
        <Route path="reports/*" element={<ReportsPage />} />
        <Route path="iso/*" element={<ISOPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="import" element={<ImportPage />} />
      </Route>
    </Routes>
  );
}

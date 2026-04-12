import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';

import { useAppSelector, useAppDispatch } from '@/hooks/useRedux';
import { fetchProfile } from '@/store/slices/authSlice';
import MainLayout from '@/components/layout/MainLayout';
import LoginPage from '@/pages/LoginPage';
import SetupPage from '@/pages/SetupPage';
import ChangePasswordPage from '@/pages/ChangePasswordPage';
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
import AnalyticsPage from '@/pages/AnalyticsPage';
import SettingsPage from '@/pages/SettingsPage';
import MeterMapPage from '@/pages/MeterMapPage';
import EnergyReviewPage from '@/pages/EnergyReviewPage';
import EconomicsPage from '@/pages/EconomicsPage';
import MonthlyComparisonPage from '@/pages/MonthlyComparisonPage';
import EnergyBalancePage from '@/pages/EnergyBalancePage';

/**
 * Geschützte Route – leitet auf /login um wenn nicht authentifiziert.
 * Erzwingt Passwortänderung wenn must_change_password gesetzt ist.
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAppSelector((state) => state.auth);

  if (!isAuthenticated) return <Navigate to="/login" replace />;

  // Passwortänderung erzwingen
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const dispatch = useAppDispatch();
  const { isAuthenticated, user } = useAppSelector((state) => state.auth);

  // Beim Start: Profil laden wenn Token vorhanden
  useEffect(() => {
    if (isAuthenticated && !user) {
      dispatch(fetchProfile());
    }
  }, [isAuthenticated, user, dispatch]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />
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
        <Route path="meter-map" element={<MeterMapPage />} />
        <Route path="readings" element={<ReadingsPage />} />
        <Route path="consumers" element={<ConsumersPage />} />
        <Route path="energy-review" element={<EnergyReviewPage />} />
        <Route path="schemas/*" element={<SchemasPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="emissions" element={<EmissionsPage />} />
        <Route path="weather" element={<WeatherPage />} />
        <Route path="climate" element={<ClimatePage />} />
        <Route path="reports/*" element={<ReportsPage />} />
        <Route path="iso/*" element={<ISOPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="economics" element={<EconomicsPage />} />
        <Route path="monthly-comparison" element={<MonthlyComparisonPage />} />
        <Route path="energy-balance" element={<EnergyBalancePage />} />
        <Route path="import" element={<ImportPage />} />
        <Route path="integrations" element={<Navigate to="/settings" replace />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  );
}

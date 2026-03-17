import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '@/utils/api';
import { useAppDispatch } from '@/hooks/useRedux';
import { fetchProfile } from '@/store/slices/authSlice';

/**
 * Erzwungene Passwortänderung – wird angezeigt wenn der Benutzer
 * sein Passwort beim ersten Login ändern muss.
 */
export default function ChangePasswordPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError('Passwörter stimmen nicht überein');
      return;
    }

    if (newPassword.length < 8) {
      setError('Neues Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }

    if (currentPassword === newPassword) {
      setError('Neues Passwort muss sich vom alten unterscheiden');
      return;
    }

    setLoading(true);
    try {
      await apiClient.put('/api/v1/auth/me/password', {
        current_password: currentPassword,
        new_password: newPassword,
      });

      // Profil neu laden (must_change_password ist jetzt false)
      await dispatch(fetchProfile());
      navigate('/dashboard');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || 'Passwortänderung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary-600">Passwort ändern</h1>
          <p className="mt-2 text-sm text-gray-500">
            Bitte ändern Sie Ihr Passwort, um fortzufahren.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="label">Aktuelles Passwort</label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Neues Passwort</label>
            <input
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
            />
            <p className="mt-1 text-xs text-gray-400">Mindestens 8 Zeichen</p>
          </div>

          <div>
            <label className="label">Neues Passwort bestätigen</label>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Wird geändert...' : 'Passwort ändern'}
          </button>
        </form>
      </div>
    </div>
  );
}

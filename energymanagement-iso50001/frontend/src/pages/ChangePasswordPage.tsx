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
    <div
      className="flex min-h-screen items-center justify-center"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-md p-8"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 12px 32px -8px rgba(0,0,0,0.08)',
        }}
      >
        <div className="mb-8 text-center">
          <h1 className="page-title-h1" style={{ fontSize: 22 }}>Passwort ändern</h1>
          <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6 }}>
            Bitte ändern Sie Ihr Passwort, um fortzufahren.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              style={{
                padding: '10px 12px',
                fontSize: 13,
                borderRadius: 'var(--r-sm)',
                background: 'color-mix(in srgb, var(--alert) 12%, var(--surface))',
                border: '1px solid color-mix(in srgb, var(--alert) 38%, transparent)',
                color: 'var(--alert)',
              }}
            >
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
            <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>Mindestens 8 Zeichen</p>
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

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/hooks/useRedux';
import { setTokens } from '@/store/slices/authSlice';
import { apiClient } from '@/utils/api';

/**
 * Ersteinrichtung – wird nur angezeigt wenn noch keine
 * Benutzer im System existieren. Legt den ersten Admin an.
 */
export default function SetupPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    passwordConfirm: '',
    display_name: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (form.password !== form.passwordConfirm) {
      setError('Passwörter stimmen nicht überein');
      return;
    }

    if (form.password.length < 8) {
      setError('Passwort muss mindestens 8 Zeichen lang sein');
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.post('/api/v1/auth/setup', {
        username: form.username,
        email: form.email,
        password: form.password,
        display_name: form.display_name || form.username,
      });

      dispatch(setTokens({
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token,
      }));

      navigate('/dashboard');
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || 'Setup fehlgeschlagen');
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
        className="w-full max-w-lg p-8"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          boxShadow: '0 12px 32px -8px rgba(0,0,0,0.08)',
        }}
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div
            style={{
              width: 32,
              height: 32,
              background: 'linear-gradient(135deg, #E89A3C, #F2C94C)',
              borderRadius: 6,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 14 14">
              <path d="M3 11 L7 3 L11 11 Z" fill="#FAFAF7" />
            </svg>
          </div>
          <div>
            <h1 className="page-title-h1" style={{ fontSize: 22 }}>Ersteinrichtung</h1>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 6, maxWidth: 360 }}>
              Willkommen beim EnergieManager. Legen Sie den ersten Administrator-Account an,
              um das System einzurichten.
            </p>
          </div>
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
            <label className="label">Benutzername *</label>
            <input
              type="text"
              name="username"
              className="input"
              value={form.username}
              onChange={handleChange}
              required
              minLength={3}
              autoFocus
            />
          </div>

          <div>
            <label className="label">Anzeigename</label>
            <input
              type="text"
              name="display_name"
              className="input"
              value={form.display_name}
              onChange={handleChange}
              placeholder="Optional – wird im System angezeigt"
            />
          </div>

          <div>
            <label className="label">E-Mail *</label>
            <input
              type="email"
              name="email"
              className="input"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>

          <div>
            <label className="label">Passwort *</label>
            <input
              type="password"
              name="password"
              className="input"
              value={form.password}
              onChange={handleChange}
              required
              minLength={8}
            />
            <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>Mindestens 8 Zeichen</p>
          </div>

          <div>
            <label className="label">Passwort bestätigen *</label>
            <input
              type="password"
              name="passwordConfirm"
              className="input"
              value={form.passwordConfirm}
              onChange={handleChange}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Wird eingerichtet...' : 'System einrichten'}
          </button>
        </form>
      </div>
    </div>
  );
}

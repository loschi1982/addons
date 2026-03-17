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
    <div className="flex min-h-screen items-center justify-center bg-gray-100">
      <div className="w-full max-w-lg rounded-xl bg-white p-8 shadow-lg">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-primary-600">Ersteinrichtung</h1>
          <p className="mt-2 text-sm text-gray-500">
            Willkommen beim EnergieManager. Legen Sie den ersten
            Administrator-Account an, um das System einzurichten.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
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
            <p className="mt-1 text-xs text-gray-400">Mindestens 8 Zeichen</p>
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

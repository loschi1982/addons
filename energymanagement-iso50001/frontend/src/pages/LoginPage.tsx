import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/hooks/useRedux';
import { login, checkSetupStatus } from '@/store/slices/authSlice';

export default function LoginPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { loading, error, setupRequired } = useAppSelector((state) => state.auth);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // Beim Laden: Setup-Status prüfen
  useEffect(() => {
    dispatch(checkSetupStatus());
  }, [dispatch]);

  // Wenn Setup nötig → zur Setup-Seite weiterleiten
  useEffect(() => {
    if (setupRequired === true) {
      navigate('/setup');
    }
  }, [setupRequired, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = await dispatch(login({ username, password }));
    if (login.fulfilled.match(result)) {
      // Prüfen ob Passwortänderung erforderlich
      if (result.payload.must_change_password) {
        navigate('/change-password');
      } else {
        navigate('/dashboard');
      }
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
            <h1 className="page-title-h1" style={{ fontSize: 22 }}>EnergieManager</h1>
            <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
              ISO 50001 Energiemanagementsystem
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
            <label className="label">Benutzername</label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Passwort</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Anmelden...' : 'Anmelden'}
          </button>
        </form>
      </div>
    </div>
  );
}

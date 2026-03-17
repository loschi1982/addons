import { useEffect, useState, useCallback } from 'react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';

// ── Typen ──

interface UserItem {
  id: string;
  username: string;
  email: string;
  display_name: string | null;
  role_id: string;
  role_name: string | null;
  is_active: boolean;
  is_locked: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login: string | null;
}

interface Role {
  id: string;
  name: string;
  display_name: string;
  is_system_role: boolean;
}

interface AuditLogEntry {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  details: Record<string, unknown> | null;
  timestamp: string;
}

interface UserForm {
  username: string;
  email: string;
  display_name: string;
  password: string;
  role_id: string;
}

const emptyForm: UserForm = {
  username: '',
  email: '',
  display_name: '',
  password: '',
  role_id: '',
};

// ── Hauptkomponente ──

export default function UsersPage() {
  const [activeTab, setActiveTab] = useState<'users' | 'audit'>('users');

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="page-title">Benutzerverwaltung</h1>
      </div>

      {/* Tab-Navigation */}
      <div className="mt-4 flex border-b">
        <button
          className={`px-4 py-2 text-sm font-medium ${activeTab === 'users' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('users')}
        >
          Benutzer
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium ${activeTab === 'audit' ? 'border-b-2 border-primary-600 text-primary-600' : 'text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('audit')}
        >
          Audit-Log
        </button>
      </div>

      {activeTab === 'users' ? <UsersList /> : <AuditLogList />}
    </div>
  );
}

// ── Benutzerliste ──

function UsersList() {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // Modal
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pageSize = 25;

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      if (search) params.append('search', search);

      const response = await apiClient.get<PaginatedResponse<UserItem>>(
        `/api/v1/users?${params}`
      );
      setUsers(response.data.items);
      setTotal(response.data.total);
    } catch {
      // Fehler wird vom Interceptor behandelt
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  const loadRoles = useCallback(async () => {
    try {
      const response = await apiClient.get<Role[]>('/api/v1/users/roles/list');
      setRoles(response.data);
    } catch {
      // Rollen nicht verfügbar
    }
  }, []);

  useEffect(() => {
    loadUsers();
    loadRoles();
  }, [loadUsers, loadRoles]);

  const handleCreate = () => {
    setForm({ ...emptyForm, role_id: roles[0]?.id || '' });
    setFormError(null);
    setShowModal(true);
  };

  const handleUnlock = async (user: UserItem) => {
    try {
      await apiClient.post(`/api/v1/users/${user.id}/unlock`);
      loadUsers();
    } catch {
      // Fehler wird vom Interceptor behandelt
    }
  };

  const handleDeactivate = async (user: UserItem) => {
    if (!confirm(`Benutzer "${user.username}" wirklich deaktivieren?`)) return;
    try {
      await apiClient.delete(`/api/v1/users/${user.id}`);
      loadUsers();
    } catch {
      // Fehler wird vom Interceptor behandelt
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);

    try {
      await apiClient.post('/api/v1/users', form);
      setShowModal(false);
      loadUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Anlegen');
    } finally {
      setSaving(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="mt-4 flex items-center justify-between">
        <input
          type="text"
          className="input w-64"
          placeholder="Benutzer suchen..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
        />
        <button onClick={handleCreate} className="btn-primary">
          + Neuer Benutzer
        </button>
      </div>

      <div className="card mt-4 overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Keine Benutzer gefunden.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Benutzer</th>
                <th className="px-4 py-3">E-Mail</th>
                <th className="px-4 py-3">Rolle</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Letzter Login</th>
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{user.display_name || user.username}</div>
                    <div className="text-xs text-gray-400">{user.username}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                      {user.role_name || '–'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {user.is_locked ? (
                      <span className="text-xs font-medium text-red-600">Gesperrt</span>
                    ) : user.is_active ? (
                      <span className="text-xs font-medium text-green-600">Aktiv</span>
                    ) : (
                      <span className="text-xs font-medium text-gray-400">Inaktiv</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {user.last_login
                      ? new Date(user.last_login).toLocaleString('de-DE')
                      : 'Nie'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {user.is_locked && (
                      <button
                        onClick={() => handleUnlock(user)}
                        className="mr-2 text-sm text-green-600 hover:text-green-800"
                      >
                        Entsperren
                      </button>
                    )}
                    {user.is_active && (
                      <button
                        onClick={() => handleDeactivate(user)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        Deaktivieren
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">Seite {page} von {totalPages}</p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Zurück
            </button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Weiter
            </button>
          </div>
        </div>
      )}

      {/* Modal: Benutzer anlegen */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold">Neuer Benutzer</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Benutzername *</label>
                  <input
                    type="text"
                    className="input"
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                    required
                    minLength={3}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="label">Anzeigename</label>
                  <input
                    type="text"
                    className="input"
                    value={form.display_name}
                    onChange={(e) => setForm({ ...form, display_name: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="label">E-Mail *</label>
                <input
                  type="email"
                  className="input"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                />
              </div>

              <div>
                <label className="label">Passwort *</label>
                <input
                  type="password"
                  className="input"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required
                  minLength={8}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Mindestens 8 Zeichen. Der Benutzer muss das Passwort beim ersten Login ändern.
                </p>
              </div>

              <div>
                <label className="label">Rolle *</label>
                <select
                  className="input"
                  value={form.role_id}
                  onChange={(e) => setForm({ ...form, role_id: e.target.value })}
                  required
                >
                  <option value="">Rolle wählen...</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">
                  Abbrechen
                </button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Wird angelegt...' : 'Anlegen'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Audit-Log ──

function AuditLogList() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const pageSize = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: pageSize.toString(),
      });
      const response = await apiClient.get<PaginatedResponse<AuditLogEntry>>(
        `/api/v1/audit?${params}`
      );
      setLogs(response.data.items);
      setTotal(response.data.total);
    } catch {
      // Fehler wird vom Interceptor behandelt
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = Math.ceil(total / pageSize);

  const ACTION_LABELS: Record<string, string> = {
    login_success: 'Login erfolgreich',
    login_failed: 'Login fehlgeschlagen',
    login_blocked: 'Login blockiert',
    logout: 'Abgemeldet',
    account_locked: 'Konto gesperrt',
    password_changed: 'Passwort geändert',
    user_created: 'Benutzer angelegt',
    user_updated: 'Benutzer geändert',
    user_deleted: 'Benutzer deaktiviert',
    user_unlocked: 'Benutzer entsperrt',
    setup_complete: 'Ersteinrichtung',
    permission_override_added: 'Override hinzugefügt',
    permission_override_removed: 'Override entfernt',
  };

  return (
    <>
      <div className="card mt-4 overflow-hidden p-0">
        {loading ? (
          <div className="p-8 text-center text-gray-400">Laden...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400">Keine Einträge.</div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Zeitpunkt</th>
                <th className="px-4 py-3">Benutzer</th>
                <th className="px-4 py-3">Aktion</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(log.timestamp).toLocaleString('de-DE')}
                  </td>
                  <td className="px-4 py-3">{log.username || '–'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      log.action.includes('failed') || log.action.includes('locked') || log.action.includes('blocked')
                        ? 'bg-red-50 text-red-700'
                        : log.action.includes('success') || log.action.includes('created') || log.action.includes('unlocked')
                          ? 'bg-green-50 text-green-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}>
                      {ACTION_LABELS[log.action] || log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {log.details ? JSON.stringify(log.details) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">Seite {page} von {totalPages}</p>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Zurück
            </button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
              Weiter
            </button>
          </div>
        </div>
      )}
    </>
  );
}

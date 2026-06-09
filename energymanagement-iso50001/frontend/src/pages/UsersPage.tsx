import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Search, Plus, Shield, Gauge, ClipboardList, Pencil, Eye,
  MoreVertical, Ban, Check, Unlock, UserPlus, LogIn, LogOut,
  Settings as SettingsIcon, Download, RefreshCw, KeyRound, type LucideIcon,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import type { PaginatedResponse } from '@/types';
import PageHead from '@/components/ui/PageHead';

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

const emptyForm: UserForm = { username: '', email: '', display_name: '', password: '', role_id: '' };

// ── Rollen-Meta (Ton + Icon) — nach role.name, mit Fallback ──
interface RoleMeta { tone: string; icon: LucideIcon; }
function roleMeta(name: string | null): RoleMeta {
  const n = (name || '').toLowerCase();
  if (n.includes('admin')) return { tone: 'tone-ink', icon: Shield };
  if (n.includes('manager') || n.includes('energiemanager')) return { tone: 'tone-info', icon: Gauge };
  if (n.includes('auditor')) return { tone: 'tone-good', icon: ClipboardList };
  if (n.includes('ableser') || n.includes('reader')) return { tone: 'tone-warn', icon: Pencil };
  return { tone: 'tone-muted', icon: Eye };
}

// ── Initialen aus Name/Username ──
function initials(s: string): string {
  return s.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}

// ── Audit-Aktion → Kategorie/Ton/Icon/Label ──
interface AuditMeta { label: string; tone: string; icon: LucideIcon; cat: 'auth' | 'security' | 'admin' | 'data' }
const AUDIT_META: Record<string, AuditMeta> = {
  login_success: { label: 'Login erfolgreich', tone: 'tone-neutral', icon: LogIn, cat: 'auth' },
  logout: { label: 'Abmeldung', tone: 'tone-neutral', icon: LogOut, cat: 'auth' },
  login_failed: { label: 'Login fehlgeschlagen', tone: 'tone-alert', icon: Ban, cat: 'security' },
  login_blocked: { label: 'Login blockiert', tone: 'tone-alert', icon: Ban, cat: 'security' },
  account_locked: { label: 'Konto gesperrt', tone: 'tone-alert', icon: Ban, cat: 'security' },
  password_changed: { label: 'Passwort geändert', tone: 'tone-warn', icon: KeyRound, cat: 'security' },
  user_created: { label: 'Benutzer angelegt', tone: 'tone-good', icon: UserPlus, cat: 'admin' },
  user_updated: { label: 'Benutzer geändert', tone: 'tone-info', icon: Pencil, cat: 'admin' },
  user_deleted: { label: 'Benutzer deaktiviert', tone: 'tone-alert', icon: Ban, cat: 'admin' },
  user_unlocked: { label: 'Benutzer entsperrt', tone: 'tone-good', icon: Unlock, cat: 'admin' },
  setup_complete: { label: 'Ersteinrichtung', tone: 'tone-info', icon: SettingsIcon, cat: 'admin' },
  permission_override_added: { label: 'Override hinzugefügt', tone: 'tone-info', icon: Shield, cat: 'admin' },
  permission_override_removed: { label: 'Override entfernt', tone: 'tone-info', icon: Shield, cat: 'admin' },
  report_export: { label: 'Bericht exportiert', tone: 'tone-neutral', icon: Download, cat: 'data' },
  data_import: { label: 'Daten importiert', tone: 'tone-good', icon: RefreshCw, cat: 'data' },
};
function auditMeta(action: string): AuditMeta {
  return AUDIT_META[action] || { label: action, tone: 'tone-neutral', icon: SettingsIcon, cat: 'data' };
}

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// ── Hauptkomponente ──

export default function UsersPage() {
  const [tab, setTab] = useState<'users' | 'audit'>('users');
  const [userCount, setUserCount] = useState(0);
  const [auditCount, setAuditCount] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (m: string) => { setToast(m); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), 2800); };

  return (
    <div className="benutzer">
      <PageHead eyebrow="System" title="Benutzerverwaltung" />
      <p style={{ marginTop: -4, fontSize: 12, color: 'var(--ink-3)' }}>
        Konten, Rollen und Berechtigungen verwalten · Sicherheits- und Aktivitätsprotokoll
      </p>

      <div className="bz-tabs">
        <button className={`bz-tab${tab === 'users' ? ' active' : ''}`} onClick={() => setTab('users')}>
          <Shield size={15} /> Benutzer <span className="tab-badge">{userCount}</span>
        </button>
        <button className={`bz-tab${tab === 'audit' ? ' active' : ''}`} onClick={() => setTab('audit')}>
          <ClipboardList size={15} /> Audit-Log <span className="tab-badge">{auditCount}</span>
        </button>
      </div>

      <div className="bz-wrap">
        {tab === 'users' ? <UsersTab onCount={setUserCount} flash={flash} /> : <AuditTab onCount={setAuditCount} />}
      </div>

      {toast && <div className="bz-toast"><Check size={14} style={{ color: 'var(--good)' }} /> {toast}</div>}
    </div>
  );
}

// ── Benutzer-Tab ──

function UsersTab({ onCount, flash }: { onCount: (n: number) => void; flash: (m: string) => void }) {
  const [users, setUsers] = useState<UserItem[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [mustChange, setMustChange] = useState(true);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<UserItem>>('/api/v1/users?page=1&page_size=100');
      setUsers(res.data.items);
      onCount(res.data.total);
    } catch { /* interceptor */ } finally { setLoading(false); }
  }, [onCount]);

  const loadRoles = useCallback(async () => {
    try {
      const res = await apiClient.get<Role[]>('/api/v1/users/roles/list');
      setRoles(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadUsers(); loadRoles(); }, [loadUsers, loadRoles]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.is_active && !u.is_locked).length,
    locked: users.filter((u) => u.is_locked).length,
    disabled: users.filter((u) => !u.is_active).length,
  }), [users]);

  const filtered = useMemo(() => users.filter((u) => {
    if (roleFilter !== 'all' && u.role_name !== roleFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const hay = `${u.display_name ?? ''} ${u.username} ${u.email}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [users, roleFilter, search]);

  // Verfügbare Rollennamen für den Filter (aus den geladenen Usern + Rollen).
  const roleNames = useMemo(() => {
    const set = new Set<string>();
    roles.forEach((r) => set.add(r.name));
    users.forEach((u) => u.role_name && set.add(u.role_name));
    return Array.from(set);
  }, [roles, users]);

  const handleUnlock = async (u: UserItem) => {
    try { await apiClient.post(`/api/v1/users/${u.id}/unlock`); flash(`${u.display_name || u.username} wurde entsperrt.`); loadUsers(); } catch { /* interceptor */ }
  };
  const handleDeactivate = async (u: UserItem) => {
    if (!confirm(`Benutzer „${u.display_name || u.username}" deaktivieren? Er kann sich danach nicht mehr anmelden.`)) return;
    try { await apiClient.delete(`/api/v1/users/${u.id}`); flash(`${u.display_name || u.username} wurde deaktiviert.`); loadUsers(); } catch { /* interceptor */ }
  };
  const handleActivate = async (u: UserItem) => {
    try { await apiClient.put(`/api/v1/users/${u.id}`, { is_active: true }); flash(`${u.display_name || u.username} wurde aktiviert.`); loadUsers(); } catch { /* interceptor */ }
  };

  const openCreate = () => { setForm({ ...emptyForm, role_id: roles[0]?.id || '' }); setMustChange(true); setFormError(null); setShowModal(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSaving(true);
    try {
      await apiClient.post('/api/v1/users', { ...form, must_change_password: mustChange });
      setShowModal(false);
      flash(`Benutzer „${form.display_name || form.username}" angelegt.`);
      loadUsers();
    } catch (err: unknown) {
      const error = err as { response?: { data?: { detail?: string } } };
      setFormError(error.response?.data?.detail || 'Fehler beim Anlegen');
    } finally { setSaving(false); }
  };

  return (
    <>
      {/* Statusleiste */}
      <div className="stat-strip">
        <div className="bstat"><span className="bstat-l">Benutzer gesamt</span><span className="bstat-v">{stats.total}</span></div>
        <div className="bstat"><span className="bstat-l">Aktiv</span><span className="bstat-v good">{stats.active}</span></div>
        <div className="bstat"><span className="bstat-l">Gesperrt</span><span className="bstat-v warn">{stats.locked}</span></div>
        <div className="bstat"><span className="bstat-l">Deaktiviert</span><span className="bstat-v muted">{stats.disabled}</span></div>
      </div>

      {/* Toolbar */}
      <div className="toolbar">
        <div className="search">
          <Search size={15} style={{ color: 'var(--ink-4)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Benutzername oder E-Mail…" />
        </div>
        <div className="role-filter">
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">Alle Rollen</option>
            {roleNames.map((n) => {
              const disp = roles.find((r) => r.name === n)?.display_name || n;
              return <option key={n} value={n}>{disp}</option>;
            })}
          </select>
        </div>
        <span className="grow" />
        <button className="btn-primary" onClick={openCreate}><Plus size={14} /> Neuer Benutzer</button>
      </div>

      {/* Tabelle */}
      <div className="usr-table">
        <div className="usr-row head">
          <span>Benutzer</span><span>E-Mail</span><span>Rolle</span><span>Status</span><span>Letzter Login</span><span className="ta-r">Aktionen</span>
        </div>
        {loading ? (
          <div className="b-empty2"><RefreshCw size={20} className="animate-spin" /><span>Lade Benutzer…</span></div>
        ) : filtered.length === 0 ? (
          <div className="b-empty2"><Search size={20} /><span>Keine Benutzer gefunden.</span></div>
        ) : filtered.map((u) => {
          const rm = roleMeta(u.role_name);
          const RoleIcon = rm.icon;
          const isSystem = roles.find((r) => r.id === u.role_id)?.is_system_role;
          const name = u.display_name || u.username;
          const status = u.is_locked
            ? { tone: 'tone-warn', label: 'Gesperrt' }
            : !u.is_active
            ? { tone: 'tone-muted', label: 'Deaktiviert' }
            : { tone: 'tone-good', label: 'Aktiv' };
          return (
            <div className={`usr-row${!u.is_active ? ' dim' : ''}`} key={u.id}>
              <span className="usr-cell">
                <span className={`ava ${rm.tone}`}>{initials(name)}</span>
                <span className="usr-id">
                  <span className="usr-name">{name}{isSystem && <span className="sys-tag">System</span>}</span>
                  <span className="usr-uname">@{u.username}</span>
                </span>
              </span>
              <span className="usr-email">{u.email}</span>
              <span><span className={`rolechip ${rm.tone}`}><RoleIcon size={12} />{u.role_name || '–'}</span></span>
              <span><span className={`statuschip ${status.tone}`}><span className="dot" />{status.label}</span></span>
              <span className="usr-last">{u.last_login ? fmtDateTime(u.last_login) : <span className="never">— nie angemeldet</span>}</span>
              <span className="usr-actions">
                {u.is_locked ? (
                  <button className="act-link good" onClick={() => handleUnlock(u)}>Entsperren</button>
                ) : u.is_active ? (
                  <button className="act-link danger" onClick={() => handleDeactivate(u)}>Deaktivieren</button>
                ) : (
                  <button className="act-link good" onClick={() => handleActivate(u)}>Aktivieren</button>
                )}
                <RowMenu user={u} onUnlock={handleUnlock} onDeactivate={handleDeactivate} onActivate={handleActivate} />
              </span>
            </div>
          );
        })}
      </div>

      {/* Modal: Benutzer anlegen */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(10,12,16,0.5)' }}>
          <div className="w-full max-w-lg p-6" style={{ background: 'var(--surface)', border: '1px solid var(--line-strong)', borderRadius: 'var(--r-lg)', boxShadow: '0 24px 64px -16px rgba(0,0,0,0.4)' }}>
            <h2 className="mb-4 text-lg font-bold" style={{ color: 'var(--ink)' }}>Neuer Benutzer</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              {formError && (
                <div className="rounded-lg p-3 text-sm" style={{ background: 'color-mix(in srgb, var(--alert) 12%, var(--surface))', border: '1px solid color-mix(in srgb, var(--alert) 38%, transparent)', color: 'var(--alert)' }}>{formError}</div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Benutzername *</label>
                  <input type="text" className="input font-mono" value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, '') })}
                    required minLength={3} autoFocus />
                </div>
                <div>
                  <label className="label">Anzeigename</label>
                  <input type="text" className="input" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="label">E-Mail *</label>
                <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required placeholder="name@firma.de" />
              </div>
              <div>
                <label className="label">Passwort *</label>
                <input type="password" className="input" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
                <p style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>Mindestens 8 Zeichen.</p>
              </div>
              <div>
                <label className="label">Rolle *</label>
                <select className="input" value={form.role_id} onChange={(e) => setForm({ ...form, role_id: e.target.value })} required>
                  <option value="">Rolle wählen…</option>
                  {roles.map((r) => <option key={r.id} value={r.id}>{r.display_name}</option>)}
                </select>
              </div>
              <label className="flex items-center gap-2" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                <input type="checkbox" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
                Passwort beim ersten Login ändern
              </label>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Abbrechen</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Wird angelegt…' : 'Anlegen'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

// ── Kebab-Menü (Zeilenaktionen) ──

function RowMenu({ user, onUnlock, onDeactivate, onActivate }: {
  user: UserItem;
  onUnlock: (u: UserItem) => void;
  onDeactivate: (u: UserItem) => void;
  onActivate: (u: UserItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="rowmenu" ref={ref}>
      <button className={`kebab${open ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Aktionen"><MoreVertical size={16} /></button>
      {open && (
        <div className="menu">
          {user.is_locked && <button className="menu-item good" onClick={() => { setOpen(false); onUnlock(user); }}><Unlock size={14} /> Entsperren</button>}
          {user.is_active && !user.is_locked && <div className="menu-sep" />}
          {user.is_active
            ? <button className="menu-item danger" onClick={() => { setOpen(false); onDeactivate(user); }}><Ban size={14} /> Deaktivieren</button>
            : <button className="menu-item good" onClick={() => { setOpen(false); onActivate(user); }}><Check size={14} /> Aktivieren</button>}
        </div>
      )}
    </div>
  );
}

// ── Audit-Log-Tab ──

const AUDIT_GROUPS: Record<string, string> = {
  all: 'Alle Aktionen', auth: 'Anmeldung', security: 'Sicherheit', admin: 'Verwaltung', data: 'Daten & Berichte',
};

function AuditTab({ onCount }: { onCount: (n: number) => void }) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const pageSize = 50;

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get<PaginatedResponse<AuditLogEntry>>(`/api/v1/audit?page=${page}&page_size=${pageSize}`);
      setLogs(res.data.items);
      setTotal(res.data.total);
      onCount(res.data.total);
    } catch { /* interceptor */ } finally { setLoading(false); }
  }, [page, onCount]);

  useEffect(() => { loadLogs(); }, [loadLogs]);

  const filtered = useMemo(() => logs.filter((e) => {
    const m = auditMeta(e.action);
    if (filter !== 'all' && m.cat !== filter) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      const hay = `${e.username ?? ''} ${m.label} ${e.resource_type ?? ''} ${JSON.stringify(e.details ?? {})}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  }), [logs, filter, q]);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <>
      <div className="toolbar">
        <div className="search">
          <Search size={15} style={{ color: 'var(--ink-4)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Protokoll durchsuchen…" />
        </div>
        <div className="seg-filter">
          {Object.entries(AUDIT_GROUPS).map(([k, v]) => (
            <button key={k} className={`seg-btn${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>{v}</button>
          ))}
        </div>
        <span className="tb-count">{filtered.length} Einträge</span>
      </div>

      <div className="aud-table">
        <div className="aud-row head"><span>Zeitpunkt</span><span>Benutzer</span><span>Aktion</span><span>Details</span><span>Objekt</span></div>
        {loading ? (
          <div className="b-empty2"><RefreshCw size={20} className="animate-spin" /><span>Lade Protokoll…</span></div>
        ) : filtered.length === 0 ? (
          <div className="b-empty2"><Search size={20} /><span>Keine Protokolleinträge gefunden.</span></div>
        ) : filtered.map((e) => {
          const m = auditMeta(e.action);
          const Icon = m.icon;
          const detail = e.details && Object.keys(e.details).length
            ? Object.entries(e.details).map(([k, val]) => `${k}: ${val}`).join(' · ')
            : '—';
          return (
            <div className="aud-row" key={e.id}>
              <span className="aud-ts">{fmtDateTime(e.timestamp)}</span>
              <span className="aud-user">{e.username ? `@${e.username}` : <span className="never">unbekannt</span>}</span>
              <span><span className={`actchip ${m.tone}`}><Icon size={12} />{m.label}</span></span>
              <span className="aud-detail" title={detail}>{detail}</span>
              <span className="aud-res">{e.resource_type || '—'}</span>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between" style={{ padding: '4px 2px' }}>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Seite {page} von {totalPages}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Zurück</button>
            <button className="btn-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Weiter</button>
          </div>
        </div>
      )}
    </>
  );
}

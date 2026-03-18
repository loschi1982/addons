import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Edit2, Trash2, X, Save, ChevronRight,
  Building2, FileText, Users, Target, AlertTriangle,
  Scale, ClipboardCheck, Star, CheckCircle, Clock,
  Shield, TrendingUp,
} from 'lucide-react';
import { apiClient } from '@/utils/api';

/* ── Typen ── */

interface OrgContext {
  id: string;
  scope_description: string;
  scope_boundaries: Record<string, unknown> | null;
  internal_issues: string[];
  external_issues: string[];
  interested_parties: Array<{ name: string; requirements: string }>;
  energy_types_excluded: string[] | null;
  last_reviewed: string;
  version: number;
}

interface Policy {
  id: string;
  title: string;
  content: string;
  approved_by: string;
  approved_date: string;
  valid_from: string;
  valid_to: string | null;
  is_current: boolean;
  pdf_path: string | null;
  version: number;
}

interface EnMSRole {
  id: string;
  role_name: string;
  person_name: string;
  department: string | null;
  responsibilities: string[];
  authorities: string[];
  appointed_date: string;
  appointed_by: string;
  is_active: boolean;
}

interface Objective {
  id: string;
  title: string;
  description: string | null;
  target_type: string;
  target_value: number;
  target_unit: string;
  baseline_value: number;
  baseline_period: string;
  target_date: string;
  responsible_person: string;
  status: string;
  current_value: number | null;
  progress_percent: number | null;
  related_meter_ids: string[] | null;
}

interface ActionPlan {
  id: string;
  objective_id: string;
  title: string;
  description: string | null;
  responsible_person: string;
  investment_cost: number | null;
  expected_savings_kwh: number | null;
  expected_savings_eur: number | null;
  start_date: string;
  target_date: string;
  completion_date: string | null;
  status: string;
}

interface Risk {
  id: string;
  type: 'risk' | 'opportunity';
  title: string;
  description: string;
  category: string;
  likelihood: number;
  impact: number;
  risk_score: number;
  mitigation_action: string | null;
  responsible_person: string | null;
  status: string;
  review_date: string | null;
}

interface LegalReq {
  id: string;
  title: string;
  category: string;
  jurisdiction: string;
  description: string;
  relevance: string;
  compliance_status: string;
  responsible_person: string | null;
  last_assessment_date: string | null;
  next_review_date: string | null;
  source_url: string | null;
  is_active: boolean;
}

interface Document {
  id: string;
  title: string;
  document_type: string;
  category: string;
  description: string | null;
  file_path: string | null;
  version: string;
  status: string;
  author: string;
  approved_by: string | null;
  iso_clause_reference: string | null;
  tags: string[] | null;
  created_at: string;
}

interface Audit {
  id: string;
  title: string;
  audit_type: string;
  scope: string;
  planned_date: string;
  actual_date: string | null;
  lead_auditor: string;
  audit_team: string[] | null;
  status: string;
  overall_result: string | null;
}

interface AuditFinding {
  id: string;
  audit_id: string;
  finding_type: string;
  iso_clause: string;
  description: string;
  corrective_action: string | null;
  responsible_person: string | null;
  due_date: string | null;
  status: string;
}

interface Review {
  id: string;
  title: string;
  review_date: string;
  participants: string[];
  period_start: string;
  period_end: string;
  status: string;
  decisions: Array<Record<string, unknown>> | null;
  action_items: Array<Record<string, unknown>> | null;
  policy_changes_needed: boolean;
  next_review_date: string | null;
}

interface Nonconformity {
  id: string;
  title: string;
  source: string;
  description: string;
  root_cause: string | null;
  immediate_action: string | null;
  corrective_action: string | null;
  responsible_person: string;
  due_date: string;
  completion_date: string | null;
  effectiveness_verified: boolean;
  verification_notes: string | null;
  status: string;
}

/* ── Konstanten ── */

const TABS = [
  { id: 'context', label: 'Kontext', icon: Building2 },
  { id: 'policy', label: 'Energiepolitik', icon: FileText },
  { id: 'roles', label: 'Rollen', icon: Users },
  { id: 'objectives', label: 'Ziele', icon: Target },
  { id: 'risks', label: 'Risiken & Chancen', icon: AlertTriangle },
  { id: 'legal', label: 'Rechtskataster', icon: Scale },
  { id: 'documents', label: 'Dokumente', icon: FileText },
  { id: 'audits', label: 'Audits', icon: ClipboardCheck },
  { id: 'reviews', label: 'Management-Review', icon: Star },
  { id: 'nonconformities', label: 'Nichtkonformitäten', icon: Shield },
];

const STATUS_COLORS: Record<string, string> = {
  planned: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  open: 'bg-yellow-100 text-yellow-700',
  closed: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  compliant: 'bg-green-100 text-green-700',
  partially_compliant: 'bg-yellow-100 text-yellow-700',
  non_compliant: 'bg-red-100 text-red-700',
  not_assessed: 'bg-gray-100 text-gray-700',
  draft: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-gray-100 text-gray-500',
  on_track: 'bg-green-100 text-green-700',
  at_risk: 'bg-yellow-100 text-yellow-700',
  behind: 'bg-red-100 text-red-700',
};

const COMPLIANCE_LABELS: Record<string, string> = {
  compliant: 'Konform',
  partially_compliant: 'Teilweise konform',
  non_compliant: 'Nicht konform',
  not_assessed: 'Nicht bewertet',
};

/* ── Hilfsfunktionen ── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || 'bg-gray-100 text-gray-700';
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>{label}</span>;
}

/* ── Hauptkomponente ── */

export default function ISOPage() {
  const [activeTab, setActiveTab] = useState('context');

  return (
    <div>
      <h1 className="page-title">ISO 50001 Management</h1>
      <p className="mt-1 text-sm text-gray-500">
        Kontext, Energiepolitik, Ziele, Risiken, Audits und Dokumentation
      </p>

      {/* Tab-Navigation */}
      <div className="mt-4 border-b border-gray-200 overflow-x-auto">
        <nav className="flex gap-0 -mb-px">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                  isActive
                    ? 'border-[#1B5E7B] text-[#1B5E7B]'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab-Inhalte */}
      <div className="mt-6">
        {activeTab === 'context' && <ContextTab />}
        {activeTab === 'policy' && <PolicyTab />}
        {activeTab === 'roles' && <RolesTab />}
        {activeTab === 'objectives' && <ObjectivesTab />}
        {activeTab === 'risks' && <RisksTab />}
        {activeTab === 'legal' && <LegalTab />}
        {activeTab === 'documents' && <DocumentsTab />}
        {activeTab === 'audits' && <AuditsTab />}
        {activeTab === 'reviews' && <ReviewsTab />}
        {activeTab === 'nonconformities' && <NonconformitiesTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 1: Organisationskontext (Kap. 4)
   ═══════════════════════════════════════════════════════════════════════ */

function ContextTab() {
  const [ctx, setCtx] = useState<OrgContext | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    scope_description: '',
    internal_issues: '' as string,
    external_issues: '' as string,
    interested_parties: '' as string,
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/context');
      setCtx(data);
      if (data) {
        setForm({
          scope_description: data.scope_description || '',
          internal_issues: (data.internal_issues || []).join('\n'),
          external_issues: (data.external_issues || []).join('\n'),
          interested_parties: (data.interested_parties || [])
            .map((p: { name: string; requirements: string }) => `${p.name}: ${p.requirements}`)
            .join('\n'),
        });
      }
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/v1/iso/context', {
        scope_description: form.scope_description,
        internal_issues: form.internal_issues.split('\n').filter(Boolean),
        external_issues: form.external_issues.split('\n').filter(Boolean),
        interested_parties: form.interested_parties.split('\n').filter(Boolean).map(line => {
          const [name, ...rest] = line.split(':');
          return { name: name.trim(), requirements: rest.join(':').trim() };
        }),
        last_reviewed: new Date().toISOString().slice(0, 10),
      });
      setEditing(false);
      load();
    } catch { /* Fehler */ }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Kontext der Organisation (Kap. 4)</h2>
        <div className="flex gap-2">
          {ctx && <span className="text-sm text-gray-500">Version {ctx.version} | Geprüft: {formatDate(ctx.last_reviewed)}</span>}
          {!editing ? (
            <button onClick={() => setEditing(true)} className="btn-primary text-sm flex items-center gap-1">
              <Edit2 size={14} /> Bearbeiten
            </button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="btn-secondary text-sm">Abbrechen</button>
              <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-1">
                <Save size={14} /> {saving ? 'Speichern…' : 'Speichern'}
              </button>
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <div className="space-y-4">
          <div>
            <label className="label">Geltungsbereich (Scope)</label>
            <textarea className="input w-full h-24" value={form.scope_description}
              onChange={e => setForm(f => ({ ...f, scope_description: e.target.value }))} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Interne Themen (je Zeile ein Thema)</label>
              <textarea className="input w-full h-32" value={form.internal_issues}
                onChange={e => setForm(f => ({ ...f, internal_issues: e.target.value }))} />
            </div>
            <div>
              <label className="label">Externe Themen (je Zeile ein Thema)</label>
              <textarea className="input w-full h-32" value={form.external_issues}
                onChange={e => setForm(f => ({ ...f, external_issues: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className="label">Interessierte Parteien (Format: Name: Anforderung)</label>
            <textarea className="input w-full h-32" value={form.interested_parties}
              onChange={e => setForm(f => ({ ...f, interested_parties: e.target.value }))} />
          </div>
        </div>
      ) : ctx ? (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-2">Geltungsbereich</h3>
            <p className="text-gray-700 whitespace-pre-wrap">{ctx.scope_description}</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="card">
              <h3 className="font-medium text-gray-900 mb-2">Interne Themen</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {(ctx.internal_issues || []).map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
            <div className="card">
              <h3 className="font-medium text-gray-900 mb-2">Externe Themen</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700">
                {(ctx.external_issues || []).map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          </div>
          <div className="card">
            <h3 className="font-medium text-gray-900 mb-2">Interessierte Parteien</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b"><th className="text-left py-2 px-3">Name</th><th className="text-left py-2 px-3">Anforderungen</th></tr></thead>
                <tbody>
                  {(ctx.interested_parties || []).map((p, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 px-3 font-medium">{typeof p === 'object' ? p.name : p}</td>
                      <td className="py-2 px-3">{typeof p === 'object' ? p.requirements : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="card text-center py-12 text-gray-500">
          <Building2 size={40} className="mx-auto mb-3 text-gray-300" />
          <p>Noch kein Kontext definiert.</p>
          <button onClick={() => setEditing(true)} className="btn-primary text-sm mt-3">Kontext anlegen</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 2: Energiepolitik (Kap. 5.2)
   ═══════════════════════════════════════════════════════════════════════ */

function PolicyTab() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', content: '', approved_by: '', approved_date: '', valid_from: '', valid_to: '', is_current: true });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/policies');
      setPolicies(data);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      if (editId) {
        await apiClient.put(`/api/v1/iso/policies/${editId}`, form);
      } else {
        await apiClient.post('/api/v1/iso/policies', form);
      }
      setShowForm(false);
      setEditId(null);
      setForm({ title: '', content: '', approved_by: '', approved_date: '', valid_from: '', valid_to: '', is_current: true });
      load();
    } catch { /* Fehler */ }
  };

  const startEdit = (p: Policy) => {
    setEditId(p.id);
    setForm({ title: p.title, content: p.content, approved_by: p.approved_by, approved_date: p.approved_date, valid_from: p.valid_from, valid_to: p.valid_to || '', is_current: p.is_current });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Energiepolitik (Kap. 5.2)</h2>
        <button onClick={() => { setEditId(null); setForm({ title: '', content: '', approved_by: '', approved_date: '', valid_from: '', valid_to: '', is_current: true }); setShowForm(true); }} className="btn-primary text-sm flex items-center gap-1">
          <Plus size={14} /> Neue Politik
        </button>
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">{editId ? 'Politik bearbeiten' : 'Neue Energiepolitik'}</h3>
            <button onClick={() => setShowForm(false)}><X size={18} /></button>
          </div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <textarea className="input w-full h-40" placeholder="Inhalt der Energiepolitik…" value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} />
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Genehmigt von</label><input className="input w-full" value={form.approved_by} onChange={e => setForm(f => ({ ...f, approved_by: e.target.value }))} /></div>
            <div><label className="label">Genehmigungsdatum</label><input type="date" className="input w-full" value={form.approved_date} onChange={e => setForm(f => ({ ...f, approved_date: e.target.value }))} /></div>
            <div><label className="label">Gültig ab</label><input type="date" className="input w-full" value={form.valid_from} onChange={e => setForm(f => ({ ...f, valid_from: e.target.value }))} /></div>
            <div><label className="label">Gültig bis</label><input type="date" className="input w-full" value={form.valid_to} onChange={e => setForm(f => ({ ...f, valid_to: e.target.value }))} /></div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_current} onChange={e => setForm(f => ({ ...f, is_current: e.target.checked }))} />
            Aktuelle gültige Politik
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {policies.map(p => (
        <div key={p.id} className={`card ${p.is_current ? 'border-l-4 border-l-green-500' : ''}`}>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-gray-900">{p.title}</h3>
                {p.is_current && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Aktuell</span>}
                <span className="text-xs text-gray-500">v{p.version}</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">Genehmigt von {p.approved_by} am {formatDate(p.approved_date)} | Gültig ab {formatDate(p.valid_from)}</p>
            </div>
            <button onClick={() => startEdit(p)} className="text-gray-400 hover:text-gray-600"><Edit2 size={16} /></button>
          </div>
          <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap line-clamp-4">{p.content}</p>
        </div>
      ))}

      {policies.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Energiepolitik definiert.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 3: EnMS-Rollen (Kap. 5.3)
   ═══════════════════════════════════════════════════════════════════════ */

function RolesTab() {
  const [roles, setRoles] = useState<EnMSRole[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ role_name: '', person_name: '', department: '', responsibilities: '', authorities: '', appointed_date: '', appointed_by: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/roles');
      setRoles(data);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    const payload = {
      ...form,
      responsibilities: form.responsibilities.split('\n').filter(Boolean),
      authorities: form.authorities.split('\n').filter(Boolean),
    };
    try {
      if (editId) {
        await apiClient.put(`/api/v1/iso/roles/${editId}`, payload);
      } else {
        await apiClient.post('/api/v1/iso/roles', payload);
      }
      setShowForm(false);
      setEditId(null);
      load();
    } catch { /* Fehler */ }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Rolle wirklich löschen?')) return;
    try {
      await apiClient.delete(`/api/v1/iso/roles/${id}`);
      load();
    } catch { /* Fehler */ }
  };

  const startEdit = (r: EnMSRole) => {
    setEditId(r.id);
    setForm({
      role_name: r.role_name, person_name: r.person_name, department: r.department || '',
      responsibilities: r.responsibilities.join('\n'), authorities: r.authorities.join('\n'),
      appointed_date: r.appointed_date, appointed_by: r.appointed_by,
    });
    setShowForm(true);
  };

  const resetForm = () => {
    setEditId(null);
    setForm({ role_name: '', person_name: '', department: '', responsibilities: '', authorities: '', appointed_date: '', appointed_by: '' });
    setShowForm(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Rollen & Verantwortlichkeiten (Kap. 5.3)</h2>
        <button onClick={resetForm} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neue Rolle</button>
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">{editId ? 'Rolle bearbeiten' : 'Neue Rolle'}</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Rollenbezeichnung</label><input className="input w-full" value={form.role_name} onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))} /></div>
            <div><label className="label">Person</label><input className="input w-full" value={form.person_name} onChange={e => setForm(f => ({ ...f, person_name: e.target.value }))} /></div>
            <div><label className="label">Abteilung</label><input className="input w-full" value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Verantwortlichkeiten (je Zeile)</label><textarea className="input w-full h-24" value={form.responsibilities} onChange={e => setForm(f => ({ ...f, responsibilities: e.target.value }))} /></div>
            <div><label className="label">Befugnisse (je Zeile)</label><textarea className="input w-full h-24" value={form.authorities} onChange={e => setForm(f => ({ ...f, authorities: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Bestellt am</label><input type="date" className="input w-full" value={form.appointed_date} onChange={e => setForm(f => ({ ...f, appointed_date: e.target.value }))} /></div>
            <div><label className="label">Bestellt von</label><input className="input w-full" value={form.appointed_by} onChange={e => setForm(f => ({ ...f, appointed_by: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {roles.map(r => (
          <div key={r.id} className={`card ${!r.is_active ? 'opacity-50' : ''}`}>
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-medium text-gray-900">{r.role_name}</h3>
                <p className="text-sm text-gray-600">{r.person_name} {r.department && `· ${r.department}`}</p>
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(r)} className="text-gray-400 hover:text-gray-600"><Edit2 size={14} /></button>
                <button onClick={() => handleDelete(r.id)} className="text-gray-400 hover:text-red-500"><Trash2 size={14} /></button>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="font-medium text-gray-500 text-xs uppercase mb-1">Verantwortlichkeiten</p>
                <ul className="list-disc list-inside text-gray-700 space-y-0.5">
                  {r.responsibilities.map((resp, i) => <li key={i}>{resp}</li>)}
                </ul>
              </div>
              <div>
                <p className="font-medium text-gray-500 text-xs uppercase mb-1">Befugnisse</p>
                <ul className="list-disc list-inside text-gray-700 space-y-0.5">
                  {r.authorities.map((auth, i) => <li key={i}>{auth}</li>)}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      {roles.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Rollen definiert.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 4: Energieziele & Aktionspläne (Kap. 6.2)
   ═══════════════════════════════════════════════════════════════════════ */

function ObjectivesTab() {
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [actions, setActions] = useState<Record<string, ActionPlan[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', target_type: 'reduction', target_value: '', target_unit: 'kWh', baseline_value: '', baseline_period: '', target_date: '', responsible_person: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/objectives');
      setObjectives(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadActions = async (objId: string) => {
    try {
      const { data } = await apiClient.get(`/api/v1/iso/objectives/${objId}/actions`);
      setActions(prev => ({ ...prev, [objId]: data }));
    } catch { /* leer */ }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!actions[id]) loadActions(id);
    }
  };

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/objectives', {
        ...form,
        target_value: parseFloat(form.target_value),
        baseline_value: parseFloat(form.baseline_value),
      });
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Energieziele & Aktionspläne (Kap. 6.2)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neues Ziel</button>
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neues Energieziel</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <textarea className="input w-full h-20" placeholder="Beschreibung" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Zieltyp</label>
              <select className="input w-full" value={form.target_type} onChange={e => setForm(f => ({ ...f, target_type: e.target.value }))}>
                <option value="reduction">Reduktion</option><option value="efficiency">Effizienz</option><option value="absolute">Absolutwert</option>
              </select>
            </div>
            <div><label className="label">Zielwert</label><input type="number" className="input w-full" value={form.target_value} onChange={e => setForm(f => ({ ...f, target_value: e.target.value }))} /></div>
            <div><label className="label">Einheit</label><input className="input w-full" value={form.target_unit} onChange={e => setForm(f => ({ ...f, target_unit: e.target.value }))} /></div>
            <div><label className="label">Zieldatum</label><input type="date" className="input w-full" value={form.target_date} onChange={e => setForm(f => ({ ...f, target_date: e.target.value }))} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Basiswert</label><input type="number" className="input w-full" value={form.baseline_value} onChange={e => setForm(f => ({ ...f, baseline_value: e.target.value }))} /></div>
            <div><label className="label">Basisperiode</label><input className="input w-full" placeholder="z.B. 2024" value={form.baseline_period} onChange={e => setForm(f => ({ ...f, baseline_period: e.target.value }))} /></div>
            <div><label className="label">Verantwortlich</label><input className="input w-full" value={form.responsible_person} onChange={e => setForm(f => ({ ...f, responsible_person: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {objectives.map(obj => (
        <div key={obj.id} className="card">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(obj.id)}>
            <div className="flex items-center gap-3">
              <ChevronRight size={16} className={`transition-transform ${expandedId === obj.id ? 'rotate-90' : ''}`} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{obj.title}</h3>
                  <StatusBadge status={obj.status} />
                </div>
                <p className="text-sm text-gray-500">{obj.responsible_person} · Ziel: {obj.target_value} {obj.target_unit} bis {formatDate(obj.target_date)}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-32">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Fortschritt</span>
                  <span>{obj.progress_percent?.toFixed(0) || 0}%</span>
                </div>
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-[#1B5E7B] rounded-full transition-all" style={{ width: `${Math.min(obj.progress_percent || 0, 100)}%` }} />
                </div>
              </div>
            </div>
          </div>

          {expandedId === obj.id && (
            <div className="mt-4 pt-4 border-t space-y-3">
              {obj.description && <p className="text-sm text-gray-700">{obj.description}</p>}
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><span className="text-gray-500">Basiswert:</span> {obj.baseline_value} {obj.target_unit}</div>
                <div><span className="text-gray-500">Aktuell:</span> {obj.current_value ?? '–'} {obj.target_unit}</div>
                <div><span className="text-gray-500">Basisperiode:</span> {obj.baseline_period}</div>
                <div><span className="text-gray-500">Typ:</span> {obj.target_type}</div>
              </div>

              <h4 className="font-medium text-sm text-gray-700 mt-4">Aktionspläne</h4>
              {(actions[obj.id] || []).length > 0 ? (
                <div className="space-y-2">
                  {actions[obj.id].map(ap => (
                    <div key={ap.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg text-sm">
                      <StatusBadge status={ap.status} />
                      <span className="font-medium">{ap.title}</span>
                      <span className="text-gray-500 ml-auto">{ap.responsible_person} · {formatDate(ap.start_date)} – {formatDate(ap.target_date)}</span>
                      {ap.expected_savings_kwh && <span className="text-green-600 text-xs">↓ {ap.expected_savings_kwh} kWh</span>}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">Keine Aktionspläne vorhanden.</p>
              )}
            </div>
          )}
        </div>
      ))}

      {objectives.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Energieziele definiert.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 5: Risiken & Chancen (Kap. 6.1)
   ═══════════════════════════════════════════════════════════════════════ */

function RisksTab() {
  const [risks, setRisks] = useState<Risk[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: 'risk' as 'risk' | 'opportunity', title: '', description: '', category: '', likelihood: 3, impact: 3, mitigation_action: '', responsible_person: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/risks');
      setRisks(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/risks', form);
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  const getRiskColor = (score: number): string => {
    if (score <= 4) return 'text-green-600 bg-green-50';
    if (score <= 9) return 'text-yellow-600 bg-yellow-50';
    if (score <= 15) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Risiken & Chancen (Kap. 6.1)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neu</button>
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neues Risiko / Chance</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Typ</label>
              <select className="input w-full" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as 'risk' | 'opportunity' }))}>
                <option value="risk">Risiko</option><option value="opportunity">Chance</option>
              </select>
            </div>
            <div className="col-span-2"><label className="label">Titel</label><input className="input w-full" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          </div>
          <textarea className="input w-full h-20" placeholder="Beschreibung" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Kategorie</label><input className="input w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} /></div>
            <div><label className="label">Wahrscheinlichkeit (1-5)</label><input type="number" min={1} max={5} className="input w-full" value={form.likelihood} onChange={e => setForm(f => ({ ...f, likelihood: +e.target.value }))} /></div>
            <div><label className="label">Auswirkung (1-5)</label><input type="number" min={1} max={5} className="input w-full" value={form.impact} onChange={e => setForm(f => ({ ...f, impact: +e.target.value }))} /></div>
            <div><label className="label">Verantwortlich</label><input className="input w-full" value={form.responsible_person} onChange={e => setForm(f => ({ ...f, responsible_person: e.target.value }))} /></div>
          </div>
          <div><label className="label">Maßnahme</label><textarea className="input w-full h-16" value={form.mitigation_action} onChange={e => setForm(f => ({ ...f, mitigation_action: e.target.value }))} /></div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {/* 5×5 Risikomatrix */}
      <div className="card">
        <h3 className="font-medium text-gray-900 mb-3">Risikomatrix</h3>
        <div className="grid grid-cols-6 gap-1 text-xs text-center">
          <div />
          {[1, 2, 3, 4, 5].map(i => <div key={i} className="font-medium py-1">Auswirkung {i}</div>)}
          {[5, 4, 3, 2, 1].map(likelihood => (
            <>
              <div key={`l${likelihood}`} className="font-medium py-2 text-right pr-2">W {likelihood}</div>
              {[1, 2, 3, 4, 5].map(impact => {
                const score = likelihood * impact;
                const count = risks.filter(r => r.likelihood === likelihood && r.impact === impact).length;
                return (
                  <div key={`${likelihood}-${impact}`} className={`py-2 rounded ${getRiskColor(score)} font-medium`}>
                    {score}{count > 0 && <span className="block text-[10px]">({count})</span>}
                  </div>
                );
              })}
            </>
          ))}
        </div>
      </div>

      {/* Risiko-Liste */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left">
            <th className="py-2 px-3">Typ</th><th className="py-2 px-3">Titel</th><th className="py-2 px-3">Kategorie</th>
            <th className="py-2 px-3 text-center">W</th><th className="py-2 px-3 text-center">A</th><th className="py-2 px-3 text-center">Score</th>
            <th className="py-2 px-3">Status</th><th className="py-2 px-3">Verantwortlich</th>
          </tr></thead>
          <tbody>
            {risks.map(r => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3"><span className={`px-2 py-0.5 rounded text-xs ${r.type === 'risk' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>{r.type === 'risk' ? 'Risiko' : 'Chance'}</span></td>
                <td className="py-2 px-3 font-medium">{r.title}</td>
                <td className="py-2 px-3 text-gray-600">{r.category}</td>
                <td className="py-2 px-3 text-center">{r.likelihood}</td>
                <td className="py-2 px-3 text-center">{r.impact}</td>
                <td className="py-2 px-3 text-center"><span className={`px-2 py-0.5 rounded font-bold ${getRiskColor(r.risk_score)}`}>{r.risk_score}</span></td>
                <td className="py-2 px-3"><StatusBadge status={r.status} /></td>
                <td className="py-2 px-3 text-gray-600">{r.responsible_person || '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {risks.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Risiken oder Chancen erfasst.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 6: Rechtskataster (Kap. 9.1.2)
   ═══════════════════════════════════════════════════════════════════════ */

function LegalTab() {
  const [reqs, setReqs] = useState<LegalReq[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', category: 'energy_law', jurisdiction: 'DE', description: '', relevance: '', responsible_person: '', next_review_date: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/legal');
      setReqs(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/legal', form);
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  const updateCompliance = async (id: string, status: string) => {
    try {
      await apiClient.put(`/api/v1/iso/legal/${id}`, {
        compliance_status: status,
        last_assessment_date: new Date().toISOString().slice(0, 10),
      });
      load();
    } catch { /* Fehler */ }
  };

  const complianceColor = (s: string) => {
    if (s === 'compliant') return 'bg-green-500';
    if (s === 'partially_compliant') return 'bg-yellow-500';
    if (s === 'non_compliant') return 'bg-red-500';
    return 'bg-gray-400';
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Rechtskataster (Kap. 9.1.2)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neue Anforderung</button>
      </div>

      {/* Compliance-Übersicht */}
      <div className="grid grid-cols-4 gap-4">
        {['compliant', 'partially_compliant', 'non_compliant', 'not_assessed'].map(status => (
          <div key={status} className="card text-center">
            <div className={`w-4 h-4 rounded-full ${complianceColor(status)} mx-auto mb-2`} />
            <p className="text-2xl font-bold text-gray-900">{reqs.filter(r => r.compliance_status === status).length}</p>
            <p className="text-xs text-gray-500">{COMPLIANCE_LABELS[status]}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neue Rechtsanforderung</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel / Gesetz" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Kategorie</label>
              <select className="input w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="energy_law">Energierecht</option><option value="environmental">Umweltrecht</option>
                <option value="building">Baurecht</option><option value="safety">Arbeitssicherheit</option><option value="other">Sonstige</option>
              </select>
            </div>
            <div><label className="label">Jurisdiktion</label><input className="input w-full" value={form.jurisdiction} onChange={e => setForm(f => ({ ...f, jurisdiction: e.target.value }))} /></div>
            <div><label className="label">Nächste Prüfung</label><input type="date" className="input w-full" value={form.next_review_date} onChange={e => setForm(f => ({ ...f, next_review_date: e.target.value }))} /></div>
          </div>
          <textarea className="input w-full h-20" placeholder="Beschreibung" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <textarea className="input w-full h-16" placeholder="Relevanz für das EnMS" value={form.relevance} onChange={e => setForm(f => ({ ...f, relevance: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left">
            <th className="py-2 px-3">Status</th><th className="py-2 px-3">Titel</th><th className="py-2 px-3">Kategorie</th>
            <th className="py-2 px-3">Relevanz</th><th className="py-2 px-3">Nächste Prüfung</th><th className="py-2 px-3">Aktion</th>
          </tr></thead>
          <tbody>
            {reqs.map(r => (
              <tr key={r.id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3"><div className={`w-3 h-3 rounded-full ${complianceColor(r.compliance_status)}`} title={COMPLIANCE_LABELS[r.compliance_status]} /></td>
                <td className="py-2 px-3 font-medium">{r.title}</td>
                <td className="py-2 px-3 text-gray-600">{r.category}</td>
                <td className="py-2 px-3 text-gray-600 max-w-xs truncate">{r.relevance}</td>
                <td className="py-2 px-3 text-gray-600">{r.next_review_date ? formatDate(r.next_review_date) : '–'}</td>
                <td className="py-2 px-3">
                  <select className="text-xs border rounded px-1 py-0.5" value={r.compliance_status} onChange={e => updateCompliance(r.id, e.target.value)}>
                    {Object.entries(COMPLIANCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {reqs.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Rechtsanforderungen erfasst.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 7: Dokumentenlenkung (Kap. 7.5)
   ═══════════════════════════════════════════════════════════════════════ */

function DocumentsTab() {
  const [docs, setDocs] = useState<Document[]>([]);
  const [reviewDueDocs, setReviewDueDocs] = useState<Document[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', document_type: 'procedure', category: 'enms', description: '', author: '', iso_clause_reference: '', tags: '', review_due_date: '' });

  const load = useCallback(async () => {
    try {
      const [docsRes, dueRes] = await Promise.all([
        apiClient.get('/api/v1/iso/documents'),
        apiClient.get('/api/v1/iso/documents/review-due?days=30'),
      ]);
      setDocs(docsRes.data.items || []);
      setReviewDueDocs(dueRes.data || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/documents', {
        ...form,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()) : null,
      });
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  const handleUpload = async (docId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('file', file);
      try {
        await apiClient.post(`/api/v1/iso/documents/${docId}/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        load();
      } catch { /* Fehler */ }
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Dokumentenlenkung (Kap. 7.5)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neues Dokument</button>
      </div>

      {/* Überprüfungserinnerungen */}
      {reviewDueDocs.length > 0 && (
        <div className="card border-l-4 border-l-orange-400 bg-orange-50">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={16} className="text-orange-500" />
            <h3 className="font-medium text-orange-800">Überprüfung fällig ({reviewDueDocs.length})</h3>
          </div>
          <div className="space-y-1">
            {reviewDueDocs.map(d => {
              const isOverdue = new Date(d.created_at) < new Date();
              return (
                <div key={d.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-gray-800">{d.title}</span>
                  <span className={`text-xs ${isOverdue ? 'text-red-600 font-bold' : 'text-orange-600'}`}>
                    {d.version && `v${d.version} · `}Fällig
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neues Dokument</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Dokumenttyp</label>
              <select className="input w-full" value={form.document_type} onChange={e => setForm(f => ({ ...f, document_type: e.target.value }))}>
                <option value="procedure">Verfahrensanweisung</option><option value="work_instruction">Arbeitsanweisung</option>
                <option value="form">Formular</option><option value="record">Aufzeichnung</option><option value="policy">Richtlinie</option>
              </select>
            </div>
            <div><label className="label">Kategorie</label>
              <select className="input w-full" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="enms">EnMS</option><option value="energy_planning">Energieplanung</option>
                <option value="monitoring">Überwachung</option><option value="management_review">Managementbewertung</option>
              </select>
            </div>
            <div><label className="label">ISO-Klausel</label><input className="input w-full" placeholder="z.B. 7.5" value={form.iso_clause_reference} onChange={e => setForm(f => ({ ...f, iso_clause_reference: e.target.value }))} /></div>
          </div>
          <textarea className="input w-full h-16" placeholder="Beschreibung" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Autor</label><input className="input w-full" value={form.author} onChange={e => setForm(f => ({ ...f, author: e.target.value }))} /></div>
            <div><label className="label">Tags (kommagetrennt)</label><input className="input w-full" placeholder="EnMS, Audit, ..." value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} /></div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b text-left">
            <th className="py-2 px-3">Titel</th><th className="py-2 px-3">Typ</th><th className="py-2 px-3">Version</th>
            <th className="py-2 px-3">Status</th><th className="py-2 px-3">ISO-Klausel</th><th className="py-2 px-3">Autor</th><th className="py-2 px-3">Aktionen</th>
          </tr></thead>
          <tbody>
            {docs.map(d => (
              <tr key={d.id} className="border-b hover:bg-gray-50">
                <td className="py-2 px-3">
                  <div className="font-medium">{d.title}</div>
                  {d.tags && <div className="flex gap-1 mt-0.5">{d.tags.map(t => <span key={t} className="text-[10px] bg-gray-100 px-1 rounded">{t}</span>)}</div>}
                </td>
                <td className="py-2 px-3 text-gray-600">{d.document_type}</td>
                <td className="py-2 px-3 text-gray-600">v{d.version}</td>
                <td className="py-2 px-3"><StatusBadge status={d.status} /></td>
                <td className="py-2 px-3 text-gray-600">{d.iso_clause_reference || '–'}</td>
                <td className="py-2 px-3 text-gray-600">{d.author}</td>
                <td className="py-2 px-3">
                  <button onClick={() => handleUpload(d.id)} className="text-[#1B5E7B] hover:underline text-xs">Upload</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {docs.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Dokumente angelegt.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 8: Interne Audits (Kap. 9.2)
   ═══════════════════════════════════════════════════════════════════════ */

function AuditsTab() {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [findings, setFindings] = useState<Record<string, AuditFinding[]>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);
  const [checklist, setChecklist] = useState<Array<{ clause: string; topic: string; checks: string[] }>>([]);
  const [checkResults, setCheckResults] = useState<Record<string, string>>({});
  const [form, setForm] = useState({ title: '', audit_type: 'internal', scope: '', planned_date: '', lead_auditor: '', audit_team: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/audits');
      setAudits(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadFindings = async (auditId: string) => {
    try {
      const { data } = await apiClient.get(`/api/v1/iso/audits/${auditId}/findings`);
      setFindings(prev => ({ ...prev, [auditId]: data }));
    } catch { /* leer */ }
  };

  const toggleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
    } else {
      setExpandedId(id);
      if (!findings[id]) loadFindings(id);
    }
  };

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/audits', {
        ...form,
        audit_team: form.audit_team ? form.audit_team.split(',').map(t => t.trim()) : null,
      });
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Interne Audits (Kap. 9.2)</h2>
        <div className="flex gap-2">
          <button onClick={async () => {
            try {
              const { data } = await apiClient.get('/api/v1/iso/audits/checklist');
              setChecklist(data);
              setShowChecklist(true);
            } catch { /* leer */ }
          }} className="btn-secondary text-sm flex items-center gap-1"><ClipboardCheck size={14} /> Checkliste</button>
          <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neues Audit</button>
        </div>
      </div>

      {/* Audit-Checkliste */}
      {showChecklist && (
        <div className="card border-2 border-[#1B5E7B]/20">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-medium text-gray-900">ISO 50001 Audit-Checkliste</h3>
            <button onClick={() => setShowChecklist(false)}><X size={18} /></button>
          </div>
          <div className="space-y-3 max-h-[500px] overflow-y-auto">
            {checklist.map(item => (
              <div key={item.clause} className="border rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-sm font-bold text-[#1B5E7B]">{item.clause}</span>
                  <span className="font-medium text-gray-900">{item.topic}</span>
                </div>
                <div className="space-y-1.5 pl-4">
                  {item.checks.map((check, ci) => {
                    const key = `${item.clause}-${ci}`;
                    return (
                      <div key={ci} className="flex items-center gap-2 text-sm">
                        <select className="text-xs border rounded px-1 py-0.5 w-28"
                          value={checkResults[key] || ''}
                          onChange={e => setCheckResults(prev => ({ ...prev, [key]: e.target.value }))}>
                          <option value="">– Bewertung –</option>
                          <option value="conforming">Konform</option>
                          <option value="observation">Beobachtung</option>
                          <option value="minor_nc">Nebenabweichung</option>
                          <option value="major_nc">Hauptabweichung</option>
                        </select>
                        <span className="text-gray-700">{check}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neues Audit</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Audittyp</label>
              <select className="input w-full" value={form.audit_type} onChange={e => setForm(f => ({ ...f, audit_type: e.target.value }))}>
                <option value="internal">Intern</option><option value="external">Extern</option><option value="surveillance">Überwachung</option>
              </select>
            </div>
            <div><label className="label">Geplant am</label><input type="date" className="input w-full" value={form.planned_date} onChange={e => setForm(f => ({ ...f, planned_date: e.target.value }))} /></div>
            <div><label className="label">Leitender Auditor</label><input className="input w-full" value={form.lead_auditor} onChange={e => setForm(f => ({ ...f, lead_auditor: e.target.value }))} /></div>
          </div>
          <textarea className="input w-full h-16" placeholder="Auditumfang / Scope" value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} />
          <div><label className="label">Auditteam (kommagetrennt)</label><input className="input w-full" value={form.audit_team} onChange={e => setForm(f => ({ ...f, audit_team: e.target.value }))} /></div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {audits.map(a => (
        <div key={a.id} className="card">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => toggleExpand(a.id)}>
            <div className="flex items-center gap-3">
              <ChevronRight size={16} className={`transition-transform ${expandedId === a.id ? 'rotate-90' : ''}`} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{a.title}</h3>
                  <StatusBadge status={a.status} />
                </div>
                <p className="text-sm text-gray-500">{a.lead_auditor} · Geplant: {formatDate(a.planned_date)} {a.actual_date && `· Durchgeführt: ${formatDate(a.actual_date)}`}</p>
              </div>
            </div>
            <span className="text-xs text-gray-400">{a.audit_type}</span>
          </div>

          {expandedId === a.id && (
            <div className="mt-4 pt-4 border-t space-y-3">
              <p className="text-sm text-gray-700"><strong>Scope:</strong> {a.scope}</p>
              {a.overall_result && <p className="text-sm text-gray-700"><strong>Ergebnis:</strong> {a.overall_result}</p>}
              {a.audit_team && <p className="text-sm text-gray-500">Team: {a.audit_team.join(', ')}</p>}

              <h4 className="font-medium text-sm text-gray-700">Befunde ({(findings[a.id] || []).length})</h4>
              {(findings[a.id] || []).map(f => (
                <div key={f.id} className="p-3 bg-gray-50 rounded-lg text-sm space-y-1">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs ${f.finding_type === 'major_nc' ? 'bg-red-100 text-red-700' : f.finding_type === 'minor_nc' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'}`}>
                      {f.finding_type === 'major_nc' ? 'Hauptabweichung' : f.finding_type === 'minor_nc' ? 'Nebenabweichung' : 'Beobachtung'}
                    </span>
                    <span className="font-mono text-gray-500">Kap. {f.iso_clause}</span>
                    <StatusBadge status={f.status} />
                  </div>
                  <p>{f.description}</p>
                  {f.corrective_action && <p className="text-gray-600"><strong>Maßnahme:</strong> {f.corrective_action}</p>}
                  {(f.finding_type === 'major_nc' || f.finding_type === 'minor_nc') && f.status !== 'closed' && (
                    <button
                      className="text-xs text-red-600 hover:underline mt-1"
                      onClick={async () => {
                        try {
                          await apiClient.post(`/api/v1/iso/findings/${f.id}/create-nc`);
                          alert('Nichtkonformität erstellt');
                        } catch { alert('Fehler beim Erstellen der NK'); }
                      }}
                    >→ NK erstellen</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {audits.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Audits geplant.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 9: Managementbewertung (Kap. 9.3)
   ═══════════════════════════════════════════════════════════════════════ */

function ReviewsTab() {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', review_date: '', participants: '', period_start: '', period_end: '' });
  const [prefillData, setPrefillData] = useState<Record<string, unknown> | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/reviews');
      setReviews(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePrefill = async () => {
    if (!form.period_start || !form.period_end) {
      alert('Bitte Zeitraum angeben für Auto-Befüllung.');
      return;
    }
    setPrefillLoading(true);
    try {
      const { data } = await apiClient.get(
        `/api/v1/iso/reviews/prefill?period_start=${form.period_start}&period_end=${form.period_end}`
      );
      setPrefillData(data);
    } catch { /* Fehler */ }
    setPrefillLoading(false);
  };

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/reviews', {
        ...form,
        participants: form.participants.split(',').map(p => p.trim()).filter(Boolean),
      });
      setShowForm(false);
      setPrefillData(null);
      load();
    } catch { /* Fehler */ }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Managementbewertung (Kap. 9.3)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neue Bewertung</button>
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neue Managementbewertung</h3><button onClick={() => { setShowForm(false); setPrefillData(null); }}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Bewertungsdatum</label><input type="date" className="input w-full" value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} /></div>
            <div><label className="label">Zeitraum von</label><input type="date" className="input w-full" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} /></div>
            <div><label className="label">Zeitraum bis</label><input type="date" className="input w-full" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} /></div>
          </div>
          <div><label className="label">Teilnehmer (kommagetrennt)</label><input className="input w-full" placeholder="Max Mustermann, Erika Muster, ..." value={form.participants} onChange={e => setForm(f => ({ ...f, participants: e.target.value }))} /></div>

          {/* Auto-Prefill Button */}
          <button onClick={handlePrefill} disabled={prefillLoading} className="btn-secondary text-sm flex items-center gap-1">
            <TrendingUp size={14} /> {prefillLoading ? 'Lade Daten…' : 'Automatisch vorausfüllen'}
          </button>

          {/* Vorausgefüllte Daten */}
          {prefillData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-3">
              <h4 className="font-medium text-blue-900 text-sm">Automatisch ermittelte Eingaben (Kap. 9.3)</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white p-3 rounded">
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">EnPI-Leistung</p>
                  <p className="text-gray-800">{String(prefillData.enpi_performance || '–')}</p>
                </div>
                <div className="bg-white p-3 rounded">
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">Audit-Ergebnisse</p>
                  <p className="text-gray-800">{String(prefillData.audit_results_summary || '–')}</p>
                </div>
                <div className="bg-white p-3 rounded">
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">Nichtkonformitäten</p>
                  <p className="text-gray-800">{String(prefillData.nonconformities_summary || '–')}</p>
                </div>
                <div className="bg-white p-3 rounded">
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">Compliance-Status</p>
                  <p className="text-gray-800">{String(prefillData.compliance_status || '–')}</p>
                </div>
                <div className="bg-white p-3 rounded col-span-2">
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">Energiepolitik</p>
                  <p className="text-gray-800">{String(prefillData.energy_policy_adequacy || '–')}</p>
                </div>
                {!!prefillData.previous_review_actions && (
                  <div className="bg-white p-3 rounded col-span-2">
                    <p className="font-medium text-gray-500 text-xs uppercase mb-1">Maßnahmen aus letzter Bewertung</p>
                    <p className="text-gray-800">{String(prefillData.previous_review_actions)}</p>
                  </div>
                )}
              </div>
              {Array.isArray(prefillData.objectives_detail) && (prefillData.objectives_detail as Array<Record<string, unknown>>).length > 0 && (
                <div>
                  <p className="font-medium text-gray-500 text-xs uppercase mb-1">Energieziele</p>
                  <div className="space-y-1">
                    {(prefillData.objectives_detail as Array<Record<string, unknown>>).map((o, i) => (
                      <div key={i} className="flex items-center justify-between text-sm bg-white p-2 rounded">
                        <span>{String(o.title)}</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-[#1B5E7B] rounded-full" style={{ width: `${Math.min(Number(o.progress) || 0, 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-500">{Number(o.progress)?.toFixed(0)}%</span>
                          <StatusBadge status={String(o.status)} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setPrefillData(null); }} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {reviews.map(r => (
        <div key={r.id} className="card">
          <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
            <div className="flex items-center gap-3">
              <ChevronRight size={16} className={`transition-transform ${expandedId === r.id ? 'rotate-90' : ''}`} />
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-medium text-gray-900">{r.title}</h3>
                  <StatusBadge status={r.status} />
                  {r.policy_changes_needed && <span className="px-2 py-0.5 rounded-full text-xs bg-orange-100 text-orange-700">Politikänderung nötig</span>}
                </div>
                <p className="text-sm text-gray-500">{formatDate(r.review_date)} · Zeitraum: {formatDate(r.period_start)} – {formatDate(r.period_end)}</p>
              </div>
            </div>
          </div>

          {expandedId === r.id && (
            <div className="mt-4 pt-4 border-t space-y-3 text-sm">
              <div><strong>Teilnehmer:</strong> {r.participants.join(', ')}</div>
              {r.decisions && r.decisions.length > 0 && (
                <div>
                  <strong>Entscheidungen:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {r.decisions.map((d, i) => <li key={i}>{JSON.stringify(d)}</li>)}
                  </ul>
                </div>
              )}
              {r.action_items && r.action_items.length > 0 && (
                <div>
                  <strong>Maßnahmen:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {r.action_items.map((a, i) => <li key={i}>{JSON.stringify(a)}</li>)}
                  </ul>
                </div>
              )}
              {r.next_review_date && <div><strong>Nächste Bewertung:</strong> {formatDate(r.next_review_date)}</div>}
            </div>
          )}
        </div>
      ))}

      {reviews.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Noch keine Managementbewertungen durchgeführt.</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Tab 10: Nichtkonformitäten (Kap. 10.1)
   ═══════════════════════════════════════════════════════════════════════ */

function NonconformitiesTab() {
  const [ncs, setNcs] = useState<Nonconformity[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ title: '', source: 'audit', description: '', responsible_person: '', due_date: '', immediate_action: '' });

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/v1/iso/nonconformities');
      setNcs(data.items || []);
    } catch { /* leer */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    try {
      await apiClient.post('/api/v1/iso/nonconformities', form);
      setShowForm(false);
      load();
    } catch { /* Fehler */ }
  };

  const updateStatus = async (id: string, status: string) => {
    try {
      const payload: Record<string, unknown> = { status };
      if (status === 'closed') payload.completion_date = new Date().toISOString().slice(0, 10);
      await apiClient.put(`/api/v1/iso/nonconformities/${id}`, payload);
      load();
    } catch { /* Fehler */ }
  };

  const overdueDays = (dueDate: string) => {
    const diff = Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
    return diff > 0 ? diff : 0;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Nichtkonformitäten & Korrekturmaßnahmen (Kap. 10.1)</h2>
        <button onClick={() => setShowForm(true)} className="btn-primary text-sm flex items-center gap-1"><Plus size={14} /> Neue NK</button>
      </div>

      {/* Zusammenfassung */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Offen', count: ncs.filter(n => n.status === 'open').length, color: 'text-yellow-600' },
          { label: 'In Bearbeitung', count: ncs.filter(n => n.status === 'in_progress').length, color: 'text-blue-600' },
          { label: 'Geschlossen', count: ncs.filter(n => n.status === 'closed').length, color: 'text-green-600' },
          { label: 'Überfällig', count: ncs.filter(n => n.status !== 'closed' && overdueDays(n.due_date) > 0).length, color: 'text-red-600' },
        ].map(s => (
          <div key={s.label} className="card text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="card border-2 border-[#1B5E7B]/20 space-y-3">
          <div className="flex justify-between"><h3 className="font-medium">Neue Nichtkonformität</h3><button onClick={() => setShowForm(false)}><X size={18} /></button></div>
          <input className="input w-full" placeholder="Titel" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Quelle</label>
              <select className="input w-full" value={form.source} onChange={e => setForm(f => ({ ...f, source: e.target.value }))}>
                <option value="audit">Audit</option><option value="complaint">Beschwerde</option>
                <option value="observation">Beobachtung</option><option value="management_review">Managementbewertung</option>
              </select>
            </div>
            <div><label className="label">Verantwortlich</label><input className="input w-full" value={form.responsible_person} onChange={e => setForm(f => ({ ...f, responsible_person: e.target.value }))} /></div>
            <div><label className="label">Fällig am</label><input type="date" className="input w-full" value={form.due_date} onChange={e => setForm(f => ({ ...f, due_date: e.target.value }))} /></div>
          </div>
          <textarea className="input w-full h-20" placeholder="Beschreibung der Nichtkonformität" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <textarea className="input w-full h-16" placeholder="Sofortmaßnahme (optional)" value={form.immediate_action} onChange={e => setForm(f => ({ ...f, immediate_action: e.target.value }))} />
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="btn-secondary text-sm">Abbrechen</button>
            <button onClick={handleSave} className="btn-primary text-sm">Speichern</button>
          </div>
        </div>
      )}

      {ncs.map(nc => {
        const isOverdue = nc.status !== 'closed' && overdueDays(nc.due_date) > 0;
        return (
          <div key={nc.id} className={`card ${isOverdue ? 'border-l-4 border-l-red-500' : ''}`}>
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedId(expandedId === nc.id ? null : nc.id)}>
              <div className="flex items-center gap-3">
                <ChevronRight size={16} className={`transition-transform ${expandedId === nc.id ? 'rotate-90' : ''}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{nc.title}</h3>
                    <StatusBadge status={nc.status} />
                    {isOverdue && <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">{overdueDays(nc.due_date)} Tage überfällig</span>}
                    {nc.effectiveness_verified && <CheckCircle size={14} className="text-green-500" />}
                  </div>
                  <p className="text-sm text-gray-500">{nc.source} · {nc.responsible_person} · Fällig: {formatDate(nc.due_date)}</p>
                </div>
              </div>
              <select className="text-xs border rounded px-1 py-0.5" value={nc.status}
                onClick={e => e.stopPropagation()}
                onChange={e => updateStatus(nc.id, e.target.value)}>
                <option value="open">Offen</option>
                <option value="in_progress">In Bearbeitung</option>
                <option value="closed">Geschlossen</option>
              </select>
            </div>

            {expandedId === nc.id && (
              <div className="mt-4 pt-4 border-t space-y-2 text-sm">
                <p><strong>Beschreibung:</strong> {nc.description}</p>
                {nc.immediate_action && <p><strong>Sofortmaßnahme:</strong> {nc.immediate_action}</p>}
                {nc.root_cause && <p><strong>Ursache:</strong> {nc.root_cause}</p>}
                {nc.corrective_action && <p><strong>Korrekturmaßnahme:</strong> {nc.corrective_action}</p>}
                {nc.completion_date && <p><strong>Abgeschlossen:</strong> {formatDate(nc.completion_date)}</p>}
                {nc.effectiveness_verified && (
                  <p className="text-green-600"><strong>Wirksamkeit geprüft:</strong> {nc.verification_notes || 'Ja'}</p>
                )}

                {/* Ursachenanalyse (5-Why) */}
                {!nc.root_cause && nc.status !== 'closed' && (
                  <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
                    <p className="text-xs font-medium text-yellow-800 mb-2">Ursachenanalyse (5-Why-Methode)</p>
                    <div className="space-y-1">
                      {[1, 2, 3, 4, 5].map(n => (
                        <div key={n} className="flex items-center gap-2 text-xs">
                          <span className="font-mono w-16 text-yellow-700">Warum {n}:</span>
                          <input className="input flex-1 text-xs py-1"
                            placeholder={`Warum ${n > 1 ? 'ist das so' : 'ist es passiert'}?`}
                            id={`why-${nc.id}-${n}`}
                          />
                        </div>
                      ))}
                    </div>
                    <button className="text-xs text-[#1B5E7B] hover:underline mt-2"
                      onClick={async () => {
                        const whys = [1, 2, 3, 4, 5]
                          .map(n => (document.getElementById(`why-${nc.id}-${n}`) as HTMLInputElement)?.value)
                          .filter(Boolean);
                        if (whys.length === 0) return;
                        try {
                          await apiClient.put(`/api/v1/iso/nonconformities/${nc.id}`, {
                            root_cause: whys.map((w, i) => `Warum ${i + 1}: ${w}`).join('\n'),
                          });
                          load();
                        } catch { /* Fehler */ }
                      }}
                    >Ursache speichern</button>
                  </div>
                )}

                {/* Wirksamkeitsprüfung */}
                {nc.status === 'closed' && !nc.effectiveness_verified && (
                  <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                    <p className="text-xs font-medium text-blue-800 mb-2">Wirksamkeitsprüfung</p>
                    <textarea className="input w-full text-xs h-16" placeholder="Bewertung der Wirksamkeit…" id={`verify-${nc.id}`} />
                    <button className="text-xs text-[#1B5E7B] hover:underline mt-1"
                      onClick={async () => {
                        const notes = (document.getElementById(`verify-${nc.id}`) as HTMLTextAreaElement)?.value;
                        try {
                          await apiClient.put(`/api/v1/iso/nonconformities/${nc.id}`, {
                            effectiveness_verified: true,
                            verification_date: new Date().toISOString().slice(0, 10),
                            verification_notes: notes || 'Wirksamkeit bestätigt',
                          });
                          load();
                        } catch { /* Fehler */ }
                      }}
                    >Wirksamkeit bestätigen</button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {ncs.length === 0 && !showForm && (
        <div className="card text-center py-8 text-gray-500">Keine Nichtkonformitäten erfasst.</div>
      )}
    </div>
  );
}

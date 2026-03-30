import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Download, Trash2, Eye, RefreshCw, FileText,
  CheckCircle, AlertCircle, Clock, Loader2, X,
  BarChart3, Leaf, Thermometer, Search,
  GitBranch, Grid3X3, Workflow, TrendingUp, DollarSign,
  Building2, Gauge,
} from 'lucide-react';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS } from '@/types';

/* ── Typen ── */

interface Report {
  id: string;
  title: string;
  report_type: string;
  period_start: string;
  period_end: string;
  status: string;
  weather_correction_applied: boolean;
  pdf_path: string | null;
  generated_at: string | null;
  error_message: string | null;
  created_at: string;
}

interface ReportDetail extends Report {
  data_snapshot: Record<string, unknown> | null;
  co2_summary: Record<string, unknown> | null;
  summary: string | null;
  findings: Record<string, unknown>[] | null;
  recommendations: Record<string, unknown>[] | null;
}

/* ── Konstanten ── */

const REPORT_TYPES = [
  { value: 'annual', label: 'Jahresbericht' },
  { value: 'quarterly', label: 'Quartalsbericht' },
  { value: 'monthly', label: 'Monatsbericht' },
  { value: 'custom', label: 'Individuell' },
];

const STATUS_CONFIG: Record<string, { label: string; color: string; Icon: React.ElementType }> = {
  pending: { label: 'Ausstehend', color: 'bg-gray-100 text-gray-700', Icon: Clock },
  generating: { label: 'Wird erstellt…', color: 'bg-blue-100 text-blue-700', Icon: Loader2 },
  ready: { label: 'Fertig', color: 'bg-green-100 text-green-700', Icon: CheckCircle },
  error: { label: 'Fehler', color: 'bg-red-100 text-red-700', Icon: AlertCircle },
  draft: { label: 'Entwurf', color: 'bg-gray-100 text-gray-700', Icon: FileText },
};

/* ── Hilfsfunktionen ── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatNumber(val: unknown): string {
  const num = Number(val) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)} Mio.`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)} k`;
  return num.toFixed(1);
}

/* ── Hauptkomponente ── */

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewingReport, setViewingReport] = useState<ReportDetail | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, page_size: 20 };
      if (filterStatus) params.status = filterStatus;
      const res = await apiClient.get('/api/v1/reports', { params });
      setReports(res.data.items);
      setTotal(res.data.total);
    } catch { /* leer */ }
    setLoading(false);
  }, [page, filterStatus]);

  useEffect(() => { fetchReports(); }, [fetchReports]);

  const deleteReport = async (id: string) => {
    if (!confirm('Bericht wirklich löschen? Die PDF-Datei wird ebenfalls gelöscht.')) return;
    try {
      await apiClient.delete(`/api/v1/reports/${id}`);
      fetchReports();
    } catch { /* leer */ }
  };

  const downloadPdf = async (report: Report) => {
    try {
      const res = await apiClient.get(`/api/v1/reports/${report.id}/pdf`, {
        responseType: 'blob',
        headers: { Accept: 'application/pdf' },
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.title.replace(/\s+/g, '_')}_${report.period_start}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('PDF konnte nicht heruntergeladen werden');
    }
  };

  const viewReport = async (id: string) => {
    try {
      const res = await apiClient.get(`/api/v1/reports/${id}`);
      setViewingReport(res.data);
    } catch { /* leer */ }
  };

  const generatePdf = async (id: string) => {
    try {
      await apiClient.post(`/api/v1/reports/${id}/generate`);
      // Polling starten
      pollStatus(id);
    } catch {
      alert('PDF-Generierung konnte nicht gestartet werden');
    }
  };

  const pollStatus = (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await apiClient.get(`/api/v1/reports/${id}/status`);
        if (res.data.status === 'ready' || res.data.status === 'error') {
          clearInterval(interval);
          fetchReports();
        }
      } catch {
        clearInterval(interval);
      }
    }, 2000);
    // Timeout nach 60 Sekunden
    setTimeout(() => clearInterval(interval), 60000);
  };

  const filteredReports = searchTerm
    ? reports.filter((r) => r.title.toLowerCase().includes(searchTerm.toLowerCase()))
    : reports;

  const totalPages = Math.ceil(total / 20);

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Berichte</h1>
          <p className="mt-1 text-sm text-gray-500">
            Energieberichte erstellen, als PDF exportieren und online ansehen.
          </p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary flex items-center gap-1.5">
          <Plus className="h-4 w-4" />
          Neuer Bericht
        </button>
      </div>

      {/* Filter-Leiste */}
      <div className="mt-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            type="text"
            className="input pl-9"
            placeholder="Berichte suchen…"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="input w-auto"
          value={filterStatus}
          onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }}
        >
          <option value="">Alle Status</option>
          <option value="ready">Fertig</option>
          <option value="pending">Ausstehend</option>
          <option value="generating">Wird erstellt</option>
          <option value="error">Fehler</option>
        </select>
      </div>

      {/* Berichts-Tabelle */}
      <div className="card mt-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-600" />
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="py-12 text-center text-gray-400">
            <FileText className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-2">Keine Berichte vorhanden</p>
            <button onClick={() => setShowCreateModal(true)} className="btn-primary mt-3">
              Ersten Bericht erstellen
            </button>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Titel</th>
                    <th className="pb-2 font-medium">Typ</th>
                    <th className="pb-2 font-medium">Zeitraum</th>
                    <th className="pb-2 font-medium text-center">Status</th>
                    <th className="pb-2 font-medium">Erstellt</th>
                    <th className="pb-2 font-medium text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((r) => {
                    const statusCfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.draft;
                    const StatusIcon = statusCfg.Icon;
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-3 font-medium text-gray-900">{r.title}</td>
                        <td className="py-3 text-gray-500">
                          {REPORT_TYPES.find((t) => t.value === r.report_type)?.label || r.report_type}
                        </td>
                        <td className="py-3 text-gray-500">
                          {formatDate(r.period_start)} – {formatDate(r.period_end)}
                        </td>
                        <td className="py-3 text-center">
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.color}`}>
                            <StatusIcon className={`h-3.5 w-3.5 ${r.status === 'generating' ? 'animate-spin' : ''}`} />
                            {statusCfg.label}
                          </span>
                        </td>
                        <td className="py-3 text-gray-500">{formatDate(r.created_at)}</td>
                        <td className="py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => viewReport(r.id)}
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600"
                              title="Ansehen"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                            {r.status === 'ready' && r.pdf_path && (
                              <button
                                onClick={() => downloadPdf(r)}
                                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600"
                                title="PDF herunterladen"
                              >
                                <Download className="h-4 w-4" />
                              </button>
                            )}
                            {(r.status === 'ready' || r.status === 'error') && (
                              <button
                                onClick={() => generatePdf(r.id)}
                                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary-600"
                                title="PDF neu generieren"
                              >
                                <RefreshCw className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => deleteReport(r.id)}
                              className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-600"
                              title="Löschen"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between border-t pt-3">
                <span className="text-sm text-gray-500">{total} Berichte gesamt</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    Zurück
                  </button>
                  <span className="px-3 py-1.5 text-sm text-gray-500">
                    Seite {page} von {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages, page + 1))}
                    disabled={page === totalPages}
                    className="btn-secondary text-sm disabled:opacity-50"
                  >
                    Weiter
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CreateReportModal
          onClose={() => setShowCreateModal(false)}
          onCreate={() => { setShowCreateModal(false); fetchReports(); }}
        />
      )}
      {viewingReport && (
        <ReportViewer
          report={viewingReport}
          onClose={() => setViewingReport(null)}
          onDownload={() => downloadPdf(viewingReport)}
          onGenerate={() => { generatePdf(viewingReport.id); setViewingReport(null); }}
        />
      )}
    </div>
  );
}

/* ── Bericht erstellen Modal ── */

const QUARTER_LABELS = ['Q1 (Jan–Mär)', 'Q2 (Apr–Jun)', 'Q3 (Jul–Sep)', 'Q4 (Okt–Dez)'];
const MONTH_LABELS_FULL = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function CreateReportModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: () => void;
}) {
  const [title, setTitle] = useState('');
  const [reportType, setReportType] = useState('annual');
  // Perioden-Felder
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [quarter, setQuarter] = useState(1);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [periodStart, setPeriodStart] = useState(`${currentYear}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().split('T')[0]);
  // Scope-Filter
  const [sites, setSites] = useState<{ id: string; name: string }[]>([]);
  const [rootMeters, setRootMeters] = useState<{ id: string; name: string; energy_type: string }[]>([]);
  const [siteId, setSiteId] = useState('');
  const [rootMeterId, setRootMeterId] = useState('');
  // Inhalts-Toggles
  const [includeCo2, setIncludeCo2] = useState(true);
  const [includeWeather, setIncludeWeather] = useState(false);
  const [includeSeu, setIncludeSeu] = useState(true);
  const [includeEnpi, setIncludeEnpi] = useState(true);
  const [includeAnomalies, setIncludeAnomalies] = useState(true);
  // Diagramm-Toggles
  const [includeMeterTree, setIncludeMeterTree] = useState(false);
  const [includeHeatmap, setIncludeHeatmap] = useState(false);
  const [includeSankey, setIncludeSankey] = useState(true);
  const [includeYoyComparison, setIncludeYoyComparison] = useState(true);
  const [includeCostOverview, setIncludeCostOverview] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Standorte und Root-Zähler laden
  useEffect(() => {
    apiClient.get('/api/v1/sites', { params: { page_size: 100 } })
      .then((res) => setSites((res.data.items || []).map((s: Record<string, unknown>) => ({ id: s.id as string, name: s.name as string }))))
      .catch(() => {});
    apiClient.get('/api/v1/meters', { params: { page_size: 200 } })
      .then((res) => {
        const meters = (res.data.items || []) as Record<string, unknown>[];
        const roots = meters.filter((m) => !m.parent_meter_id);
        setRootMeters(roots.map((m) => ({
          id: m.id as string,
          name: m.name as string,
          energy_type: m.energy_type as string,
        })));
      })
      .catch(() => {});
  }, []);

  // Auto-Titel generieren
  useEffect(() => {
    if (reportType === 'annual') {
      setTitle(`Jahresbericht ${year}`);
    } else if (reportType === 'quarterly') {
      setTitle(`Q${quarter} ${year}`);
    } else if (reportType === 'monthly') {
      setTitle(`${MONTH_LABELS_FULL[month - 1]} ${year}`);
    } else {
      setTitle(`Bericht ${periodStart} – ${periodEnd}`);
    }
  }, [reportType, year, quarter, month, periodStart, periodEnd]);

  // Jahr-Optionen (2020 bis aktuelles Jahr + 1)
  const yearOptions = Array.from({ length: currentYear - 2019 }, (_, i) => currentYear - i);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title,
        report_type: reportType,
        include_co2: includeCo2,
        include_weather_correction: includeWeather,
        include_seu: includeSeu,
        include_enpi: includeEnpi,
        include_anomalies: includeAnomalies,
        include_meter_tree: includeMeterTree,
        include_heatmap: includeHeatmap,
        include_sankey: includeSankey,
        include_yoy_comparison: includeYoyComparison,
        include_cost_overview: includeCostOverview,
      };

      if (reportType === 'annual') {
        payload.year = year;
      } else if (reportType === 'quarterly') {
        payload.year = year;
        payload.quarter = quarter;
      } else if (reportType === 'monthly') {
        payload.year = year;
        payload.month = month;
      } else {
        payload.period_start = periodStart;
        payload.period_end = periodEnd;
      }

      if (siteId) payload.site_id = siteId;
      if (rootMeterId) payload.root_meter_id = rootMeterId;

      await apiClient.post('/api/v1/reports', payload);
      onCreate();
    } catch {
      setError('Bericht konnte nicht erstellt werden');
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Neuen Bericht erstellen</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Titel *</label>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>

          <div>
            <label className="label">Berichtstyp</label>
            <select className="input" value={reportType} onChange={(e) => setReportType(e.target.value)}>
              {REPORT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Perioden-Auswahl je nach Berichtstyp */}
          {reportType === 'annual' && (
            <div>
              <label className="label">Jahr</label>
              <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {yearOptions.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}

          {reportType === 'quarterly' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Jahr</label>
                <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Quartal</label>
                <select className="input" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                  {QUARTER_LABELS.map((label, idx) => (
                    <option key={idx + 1} value={idx + 1}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {reportType === 'monthly' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Jahr</label>
                <select className="input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                  {yearOptions.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Monat</label>
                <select className="input" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTH_LABELS_FULL.map((label, idx) => (
                    <option key={idx + 1} value={idx + 1}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {reportType === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Zeitraum von *</label>
                <input type="date" className="input" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} required />
              </div>
              <div>
                <label className="label">Zeitraum bis *</label>
                <input type="date" className="input" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} required />
              </div>
            </div>
          )}

          {/* Scope-Filter */}
          {(sites.length > 0 || rootMeters.length > 0) && (
            <div>
              <label className="label mb-2">Umfang (optional)</label>
              <div className="space-y-2">
                {sites.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Building2 className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Standort</span>
                    </div>
                    <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                      <option value="">Alle Standorte</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                )}
                {rootMeters.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Gauge className="h-3.5 w-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Zählerstrang (Hauptzähler)</span>
                    </div>
                    <select className="input" value={rootMeterId} onChange={(e) => setRootMeterId(e.target.value)}>
                      <option value="">Alle Zähler</option>
                      {rootMeters.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.energy_type})</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Berichts-Sektionen */}
          <div>
            <label className="label mb-2">Berichts-Sektionen</label>
            <div className="space-y-2">
              {[
                { checked: includeCo2, onChange: setIncludeCo2, label: 'CO₂-Bilanz', icon: Leaf },
                { checked: includeWeather, onChange: setIncludeWeather, label: 'Witterungskorrektur', icon: Thermometer },
                { checked: includeSeu, onChange: setIncludeSeu, label: 'Wesentliche Energieverbraucher (SEU)', icon: BarChart3 },
                { checked: includeEnpi, onChange: setIncludeEnpi, label: 'Energiekennzahlen (EnPI)', icon: BarChart3 },
                { checked: includeAnomalies, onChange: setIncludeAnomalies, label: 'Anomalie-Erkennung', icon: AlertCircle },
              ].map(({ checked, onChange, label, icon: Icon }) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  />
                  <Icon className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Diagramme */}
          <div>
            <label className="label mb-2">Diagramme im Bericht</label>
            <div className="space-y-2">
              {[
                { checked: includeSankey, onChange: setIncludeSankey, label: 'Energiefluss (Sankey)', icon: Workflow },
                { checked: includeYoyComparison, onChange: setIncludeYoyComparison, label: 'Jahresvergleich', icon: TrendingUp },
                { checked: includeHeatmap, onChange: setIncludeHeatmap, label: 'Lastprofil (Heatmap)', icon: Grid3X3 },
                { checked: includeMeterTree, onChange: setIncludeMeterTree, label: 'Zählerstruktur', icon: GitBranch },
                { checked: includeCostOverview, onChange: setIncludeCostOverview, label: 'Kostenübersicht', icon: DollarSign },
              ].map(({ checked, onChange, label, icon: Icon }) => (
                <label key={label} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => onChange(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-primary-600"
                  />
                  <Icon className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Abbrechen</button>
            <button type="submit" className="btn-primary" disabled={!title.trim() || saving}>
              {saving ? 'Erstelle…' : 'Bericht erstellen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Report-Viewer (Online-Ansicht) ── */

function ReportViewer({
  report,
  onClose,
  onDownload,
  onGenerate,
}: {
  report: ReportDetail;
  onClose: () => void;
  onDownload: () => void;
  onGenerate: () => void;
}) {
  const snapshot = report.data_snapshot || {};
  const co2 = report.co2_summary || {};
  const findings = report.findings || [];
  const recommendations = report.recommendations || [];

  const totalKwh = (snapshot.total_consumption_kwh as number) || 0;
  const totalCo2 = (co2.total_co2_kg as number) || 0;
  const meterCount = (snapshot.meter_count as number) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-4xl rounded-xl bg-white shadow-xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{report.title}</h2>
            <p className="text-sm text-gray-500">
              {formatDate(report.period_start)} – {formatDate(report.period_end)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {report.pdf_path && (
              <button onClick={onDownload} className="btn-secondary flex items-center gap-1.5 text-sm">
                <Download className="h-4 w-4" />
                PDF
              </button>
            )}
            {!report.pdf_path && (
              <button onClick={onGenerate} className="btn-primary flex items-center gap-1.5 text-sm">
                <FileText className="h-4 w-4" />
                PDF generieren
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {/* Zusammenfassung */}
          {report.summary && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Management-Zusammenfassung</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{report.summary}</p>
            </div>
          )}

          {/* KPI-Karten */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{formatNumber(totalKwh)}</p>
              <p className="text-xs text-gray-500">kWh Gesamtverbrauch</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{formatNumber(totalCo2)}</p>
              <p className="text-xs text-gray-500">kg CO₂-Emissionen</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-2xl font-bold text-primary-600">{meterCount}</p>
              <p className="text-xs text-gray-500">Erfasste Zähler</p>
            </div>
          </div>

          {/* Energiebilanz */}
          {(snapshot.energy_balance as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Energiebilanz</h3>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Energieträger</th>
                    <th className="pb-2 font-medium text-right">Verbrauch (kWh)</th>
                    <th className="pb-2 font-medium text-right">Anteil</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.energy_balance as Record<string, unknown>[]).map((item, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 text-gray-700">
                        {ENERGY_TYPE_LABELS[(item.energy_type as string) as keyof typeof ENERGY_TYPE_LABELS] || (item.energy_type as string)}
                      </td>
                      <td className="py-2 text-right text-gray-700">
                        {formatNumber(item.consumption_kwh as number)}
                      </td>
                      <td className="py-2 text-right text-gray-500">
                        {(item.share_percent as number).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* CO₂-Bilanz */}
          {(co2.by_energy_type as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">CO₂-Bilanz</h3>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Energieträger</th>
                    <th className="pb-2 font-medium text-right">CO₂ (kg)</th>
                    <th className="pb-2 font-medium text-right">Verbrauch (kWh)</th>
                  </tr>
                </thead>
                <tbody>
                  {(co2.by_energy_type as Record<string, unknown>[]).map((item, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 text-gray-700">{item.energy_type as string}</td>
                      <td className="py-2 text-right text-gray-700">{formatNumber(item.co2_kg as number)}</td>
                      <td className="py-2 text-right text-gray-500">{formatNumber(item.consumption_kwh as number)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {co2.trend_vs_previous_year != null && (
                <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                  (co2.trend_vs_previous_year as number) < 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                }`}>
                  {(co2.trend_vs_previous_year as number) < 0 ? '↓' : '↑'} {Math.abs(co2.trend_vs_previous_year as number).toFixed(1)}% vs. Vorjahr
                </div>
              )}
            </div>
          )}

          {/* Top-Verbraucher */}
          {(snapshot.top_consumers as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Top-Verbraucher (SEU)</h3>
              <div className="space-y-2">
                {(snapshot.top_consumers as Record<string, unknown>[]).map((tc, idx) => {
                  const maxVal = ((snapshot.top_consumers as Record<string, unknown>[])[0]?.consumption_kwh as number) || 1;
                  const pct = ((tc.consumption_kwh as number) / maxVal) * 100;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-700">{tc.name as string}</span>
                        <span className="text-gray-500">{formatNumber(tc.consumption_kwh as number)} kWh</span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-gray-100">
                        <div className="h-2 rounded-full bg-primary-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Befunde */}
          {findings.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Erkenntnisse und Befunde</h3>
              <div className="space-y-2">
                {findings.map((f, idx) => (
                  <div
                    key={idx}
                    className={`rounded-lg border-l-4 p-3 ${
                      f.severity === 'hoch' ? 'border-l-red-500 bg-red-50' :
                      f.severity === 'mittel' ? 'border-l-amber-500 bg-amber-50' :
                      'border-l-green-500 bg-green-50'
                    }`}
                  >
                    <p className="text-sm font-medium text-gray-900">{f.title as string}</p>
                    <p className="text-sm text-gray-600">{f.description as string}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empfehlungen */}
          {recommendations.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Maßnahmen und Empfehlungen</h3>
              <div className="space-y-2">
                {recommendations.map((r, idx) => (
                  <div key={idx} className="rounded-lg border-l-4 border-l-primary-500 bg-primary-50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-gray-900">{String(r.title)}</p>
                      {!!r.priority && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          r.priority === 'hoch' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
                        }`}>
                          {r.priority === 'hoch' ? 'Hoch' : 'Mittel'}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600">{String(r.description)}</p>
                    {!!r.savings_kwh && (
                      <p className="mt-1 text-sm font-medium text-green-600">
                        Einsparpotenzial: {formatNumber(r.savings_kwh as number)} kWh/a
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Fehler-Info */}
          {report.error_message && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-medium text-red-700">Fehler bei der Generierung</p>
              <p className="text-sm text-red-600">{report.error_message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

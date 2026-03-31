import { useEffect, useState, useCallback } from 'react';
import {
  Plus, Download, Trash2, Eye, RefreshCw, FileText,
  CheckCircle, AlertCircle, Clock, Loader2, X,
  BarChart3, Leaf, Thermometer, Search,
  GitBranch, Grid3X3, Workflow, TrendingUp, DollarSign,
  Building2, Gauge, Zap,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import SankeyDiagram from '@/components/charts/SankeyDiagram';
import { apiClient } from '@/utils/api';
import { ENERGY_TYPE_LABELS, ENERGY_TYPE_COLORS } from '@/types';

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
  // Bezugsgröße für Energieintensität
  const [referenceValue, setReferenceValue] = useState('');
  const [referenceUnit, setReferenceUnit] = useState('m²');
  // Analyse-Kommentar
  const [analysisComment, setAnalysisComment] = useState('');
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
      if (referenceValue) {
        payload.reference_value = parseFloat(referenceValue);
        payload.reference_unit = referenceUnit;
      }
      if (analysisComment.trim()) payload.analysis_comment = analysisComment.trim();

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

          {/* Bezugsgröße für Energieintensität */}
          <div>
            <label className="label mb-1">Bezugsgröße (optional)</label>
            <p className="text-xs text-gray-400 mb-2">Ermöglicht die Angabe von kWh pro m², Mitarbeiter o.ä.</p>
            <div className="flex gap-2">
              <input
                type="number"
                className="input flex-1"
                placeholder="z.B. 500"
                min="0"
                step="any"
                value={referenceValue}
                onChange={(e) => setReferenceValue(e.target.value)}
              />
              <select
                className="input w-32"
                value={referenceUnit}
                onChange={(e) => setReferenceUnit(e.target.value)}
              >
                <option value="m²">m²</option>
                <option value="Mitarbeiter">Mitarbeiter</option>
                <option value="Einheit">Einheit</option>
                <option value="Tonne">Tonne</option>
                <option value="Stück">Stück</option>
              </select>
            </div>
          </div>

          {/* Analyse-Kommentar */}
          <div>
            <label className="label mb-1">Ursachen-Kommentar (optional)</label>
            <p className="text-xs text-gray-400 mb-2">Kontextinformation zur Analyse, z.B. "Neues Gebäude in Betrieb", "Kalter Winter"</p>
            <textarea
              className="input min-h-[60px] resize-y"
              placeholder="Hintergrund oder Ursachen für Verbrauchsänderungen…"
              value={analysisComment}
              onChange={(e) => setAnalysisComment(e.target.value)}
            />
          </div>

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

/* ── Chart-Hilfskomponenten für den Viewer ── */

const MONTHS_SHORT = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];

function YoyChart({ charts }: { charts: Record<string, unknown> }) {
  const yoy = charts.yoy_comparison as Record<string, unknown> | undefined;
  if (!yoy) return null;
  const p1 = yoy.period1 as Record<string, unknown> | undefined;
  const p2 = yoy.period2 as Record<string, unknown> | undefined;
  const p1data = p1?.data as Record<string, { period: string; value: number }[]> | undefined;
  const p2data = p2?.data as Record<string, { period: string; value: number }[]> | undefined;
  if (!p1data || !p2data) return null;

  const sums1: Record<number, number> = {};
  const sums2: Record<number, number> = {};
  Object.values(p1data).forEach((entries) =>
    entries.forEach((e) => { const m = new Date(e.period).getMonth(); sums1[m] = (sums1[m] || 0) + e.value; })
  );
  Object.values(p2data).forEach((entries) =>
    entries.forEach((e) => { const m = new Date(e.period).getMonth(); sums2[m] = (sums2[m] || 0) + e.value; })
  );
  const allMonths = [...new Set([...Object.keys(sums1), ...Object.keys(sums2)].map(Number))].sort((a, b) => a - b);
  if (allMonths.length === 0) return null;
  const chartData = allMonths.map((m) => ({
    monat: MONTHS_SHORT[m],
    Vorjahr: Math.round((sums1[m] || 0) * 10) / 10,
    Aktuell: Math.round((sums2[m] || 0) * 10) / 10,
  }));
  const p1Year = String(p1?.start || '').slice(0, 4);
  const p2Year = String(p2?.start || '').slice(0, 4);

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">
        Jahresvergleich{p1Year && p2Year ? ` ${p1Year} vs. ${p2Year}` : ''}
      </h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
          <XAxis dataKey="monat" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <Tooltip formatter={(v: number) => [`${v.toLocaleString('de-DE')} kWh`]} />
          <Legend />
          <Bar dataKey="Vorjahr" fill="#9CA3AF" radius={[2, 2, 0, 0]} />
          <Bar dataKey="Aktuell" fill="#1B5E7B" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SankeyChart({ charts }: { charts: Record<string, unknown> }) {
  const sankey = charts.sankey as { nodes: { id: string; label: string; type: string; depth?: number }[]; links: { source: number; target: number; value: number; direction?: 'consumption' | 'feed_in' }[] } | undefined;
  if (!sankey?.nodes?.length) return null;
  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Energiefluss</h3>
      <div className="rounded-lg border bg-gray-50 p-2 overflow-x-auto">
        <SankeyDiagram nodes={sankey.nodes} links={sankey.links} width={700} height={340} />
      </div>
    </div>
  );
}

function MonthlyTrendChart({ snapshot }: { snapshot: Record<string, unknown> }) {
  const monthly = snapshot.monthly_trend as { month: number; consumption_kwh: number }[] | undefined;
  if (!monthly?.length) return null;
  const data = monthly
    .filter((d) => d.consumption_kwh > 0)
    .map((d) => ({ monat: MONTHS_SHORT[d.month - 1], kWh: Math.round(d.consumption_kwh) }));
  if (data.length === 0) return null;
  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Monatlicher Verbrauchsverlauf</h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
          <XAxis dataKey="monat" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
          <Tooltip formatter={(v: number) => [`${v.toLocaleString('de-DE')} kWh`]} />
          <Bar dataKey="kWh" fill="#1B5E7B" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function CostSection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const cost = snapshot.cost_summary as {
    available: boolean;
    total_cost_net: number;
    total_cost_gross: number;
    monthly_costs: { month: string; cost_net: number }[];
  } | undefined;
  if (!cost?.available) return null;
  const totalKwh = (snapshot.total_consumption_kwh as number) || 0;
  const costPerKwhCt = totalKwh > 0 ? (cost.total_cost_net / totalKwh) * 100 : 0;

  const monthlyCostData = (cost.monthly_costs || []).map((d) => ({
    monat: MONTHS_SHORT[parseInt(d.month.slice(5, 7), 10) - 1] || d.month,
    '€ netto': Math.round(d.cost_net * 100) / 100,
  }));

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3">Wirtschaftlichkeit</h3>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xl font-bold text-primary-600">{cost.total_cost_net.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</p>
          <p className="text-xs text-gray-500">Energiekosten netto</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xl font-bold text-primary-600">{cost.total_cost_gross.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</p>
          <p className="text-xs text-gray-500">inkl. MwSt.</p>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <p className="text-xl font-bold text-primary-600">{costPerKwhCt.toFixed(1)} ct</p>
          <p className="text-xs text-gray-500">pro kWh</p>
        </div>
      </div>
      {monthlyCostData.length > 0 && (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyCostData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
            <XAxis dataKey="monat" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v} €`} />
            <Tooltip formatter={(v: number) => [`${v.toLocaleString('de-DE')} €`]} />
            <Bar dataKey="€ netto" fill="#2A8CB5" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

/* Typen für Energieart-Trennung */
interface EnergyTypeData {
  label: string;
  unit: string;
  color: string;
  total_native: number;
  total_kwh_equiv: number;
  meter_count: number;
  top_meters: { meter_id: string; name: string; unit: string; total_native: number; total_kwh_equiv: number }[];
  monthly_trend: { month: number; consumption_native: number }[];
}

interface SchemaStrand {
  schema_label: string;
  root_meter_id: string;
  root_meter_name: string;
  energy_type: string;
  unit: string;
  total_native: number;
  total_kwh_equiv: number;
  meter_count: number;
  meters: { meter_id: string; name: string; energy_type: string; unit: string; total_native: number; total_kwh_equiv: number; is_root: boolean }[];
}

function EnergyByTypeSection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const energyByType = snapshot.energy_by_type as Record<string, EnergyTypeData> | undefined;
  if (!energyByType || Object.keys(energyByType).length === 0) return null;

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <Zap className="h-4 w-4 text-primary-600" />
        Energieverbrauch nach Energieart
      </h3>
      <p className="text-sm text-gray-500 mb-4">
        Jede Energieart wird in ihrer nativen Einheit ausgewiesen. Eine Zusammenfassung verschiedener Energieträger ist nicht ISO&nbsp;50001-konform.
      </p>
      <div className="space-y-6">
        {Object.entries(energyByType).map(([key, et]) => {
          const color = et.color || (ENERGY_TYPE_COLORS as Record<string, string>)[key] || '#1B5E7B';
          const chartData = et.monthly_trend
            .filter((d) => d.consumption_native > 0)
            .map((d) => ({
              monat: MONTHS_SHORT[d.month - 1],
              [et.unit]: Math.round(d.consumption_native * 10) / 10,
            }));
          return (
            <div key={key} className="rounded-lg border overflow-hidden">
              {/* Header */}
              <div className="px-4 py-2.5 flex items-center gap-2" style={{ backgroundColor: color + '18', borderBottom: `2px solid ${color}` }}>
                <span className="h-3 w-3 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="font-semibold text-gray-900">{et.label}</span>
                <span className="ml-auto text-sm font-bold" style={{ color }}>
                  {et.total_native.toLocaleString('de-DE', { maximumFractionDigits: 1 })} {et.unit}
                </span>
                {et.unit !== 'kWh' && (
                  <span className="text-xs text-gray-400">
                    ({et.total_kwh_equiv.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh-Äquiv.)
                  </span>
                )}
              </div>
              <div className="p-4">
                {/* Zähler-Liste */}
                {et.top_meters.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs text-gray-500 mb-2">{et.meter_count} Zähler erfasst</p>
                    <div className="space-y-1.5">
                      {et.top_meters.map((m) => {
                        const maxVal = et.top_meters[0]?.total_native || 1;
                        const pct = (m.total_native / maxVal) * 100;
                        return (
                          <div key={m.meter_id}>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-gray-700">{m.name}</span>
                              <span className="text-gray-500 font-mono">
                                {m.total_native.toLocaleString('de-DE', { maximumFractionDigits: 1 })} {m.unit}
                              </span>
                            </div>
                            <div className="mt-0.5 h-1.5 w-full rounded-full bg-gray-100">
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {/* Monatsverlauf */}
                {chartData.length > 0 && (
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                      <XAxis dataKey="monat" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
                      <Tooltip formatter={(v: number) => [`${v.toLocaleString('de-DE')} ${et.unit}`]} />
                      <Bar dataKey={et.unit} fill={color} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SchemaStrandsSection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const strands = snapshot.schema_strands as SchemaStrand[] | undefined;
  if (!strands?.length) return null;

  return (
    <div>
      <h3 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-primary-600" />
        Auswertung nach Energieschema
      </h3>
      <p className="text-sm text-gray-500 mb-3">
        Verbrauch je Zählerstrang (Betrachtungspunkt) gemäß dem konfigurierten Energieschema.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="pb-2 font-medium">Strang</th>
              <th className="pb-2 font-medium">Energieart</th>
              <th className="pb-2 font-medium text-right">Verbrauch</th>
              <th className="pb-2 font-medium text-right">kWh-Äquiv.</th>
              <th className="pb-2 font-medium text-right">Zähler</th>
            </tr>
          </thead>
          <tbody>
            {strands.map((strand) => {
              const color = (ENERGY_TYPE_COLORS as Record<string, string>)[strand.energy_type] || '#1B5E7B';
              return (
                <tr key={strand.root_meter_id} className="border-b last:border-0">
                  <td className="py-2">
                    <span className="font-medium text-gray-800">{strand.schema_label}</span>
                    <span className="block text-xs text-gray-400">{strand.root_meter_name}</span>
                  </td>
                  <td className="py-2">
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: color + '22', color }}>
                      {ENERGY_TYPE_LABELS[strand.energy_type as keyof typeof ENERGY_TYPE_LABELS] || strand.energy_type}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono text-gray-700">
                    {strand.total_native.toLocaleString('de-DE', { maximumFractionDigits: 1 })} {strand.unit}
                  </td>
                  <td className="py-2 text-right text-gray-500">
                    {strand.total_kwh_equiv.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-2 text-right text-gray-500">{strand.meter_count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Typen für Nachhaltigkeit ── */

interface EnpiData {
  name: string;
  description?: string;
  unit: string;
  target_value: number | null;
  target_direction: string;
  latest_value: number | null;
  baseline_value: number | null;
  ampel: 'gruen' | 'rot' | 'grau';
}

interface ObjectiveAction {
  title: string;
  responsible: string;
  status: string;
  status_label: string;
  target_date: string | null;
  savings_kwh: number;
  savings_eur: number;
  savings_co2_kg: number;
}

interface ObjectiveData {
  title: string;
  description?: string;
  target_value: number;
  target_unit: string;
  baseline_value: number;
  baseline_period: string;
  target_date: string | null;
  responsible: string;
  status: string;
  status_label: string;
  current_value: number | null;
  progress_percent: number | null;
  actions: ObjectiveAction[];
  total_savings_kwh: number;
  total_savings_eur: number;
  total_savings_co2_kg: number;
}

interface BuildingData {
  name: string;
  building_type: string | null;
  building_type_label: string;
  area_m2: number;
  building_year: number | null;
  energy_certificate_class: string | null;
}

interface SustainabilityData {
  enpis: EnpiData[];
  objectives: ObjectiveData[];
  buildings: BuildingData[];
  total_area_m2: number;
  co2_history: { year: number; co2_kg: number }[];
}

function SustainabilitySection({ snapshot }: { snapshot: Record<string, unknown> }) {
  const sus = snapshot.sustainability as SustainabilityData | undefined;
  if (!sus) return null;

  const { enpis, objectives, buildings, total_area_m2, co2_history } = sus;
  const hasContent = (enpis?.length || 0) + (objectives?.length || 0) + (buildings?.length || 0) > 0;
  if (!hasContent) return null;

  const AMPEL_COLORS = { gruen: '#16A34A', rot: '#DC2626', grau: '#9CA3AF' };
  const AMPEL_LABELS = { gruen: 'Ziel erreicht', rot: 'Ziel verfehlt', grau: 'Kein Wert' };

  return (
    <div className="space-y-6">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
        <Leaf className="h-4 w-4 text-green-600" />
        Nachhaltigkeit &amp; ISO 50001
      </h3>

      {/* EnPI-Tabelle */}
      {enpis?.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Energieleistungskennzahlen (EnPI)</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Kennzahl</th>
                  <th className="pb-2 font-medium text-right">Ist</th>
                  <th className="pb-2 font-medium text-right">Ziel</th>
                  <th className="pb-2 font-medium text-right">Baseline</th>
                  <th className="pb-2 font-medium text-right">Einheit</th>
                  <th className="pb-2 font-medium text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {enpis.map((ep, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 text-gray-700">
                      <div className="font-medium">{ep.name}</div>
                      {ep.description && <div className="text-xs text-gray-400">{ep.description}</div>}
                    </td>
                    <td className="py-2 text-right font-mono text-gray-700">
                      {ep.latest_value != null ? ep.latest_value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '–'}
                    </td>
                    <td className="py-2 text-right font-mono text-gray-500">
                      {ep.target_value != null ? ep.target_value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '–'}
                    </td>
                    <td className="py-2 text-right font-mono text-gray-400">
                      {ep.baseline_value != null ? ep.baseline_value.toLocaleString('de-DE', { maximumFractionDigits: 2 }) : '–'}
                    </td>
                    <td className="py-2 text-right text-gray-400">{ep.unit}</td>
                    <td className="py-2 text-right">
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{
                          color: AMPEL_COLORS[ep.ampel],
                          backgroundColor: `${AMPEL_COLORS[ep.ampel]}18`,
                        }}
                      >
                        {ep.ampel === 'gruen' ? '✓' : ep.ampel === 'rot' ? '✗' : '–'}
                        {AMPEL_LABELS[ep.ampel]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Energieziele */}
      {objectives?.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Energieziele &amp; Maßnahmen</p>
          <div className="space-y-3">
            {objectives.map((obj, i) => {
              const prog = obj.progress_percent ?? 0;
              const barColor = prog >= 80 ? '#16A34A' : prog >= 40 ? '#F59E0B' : '#1B5E7B';
              return (
                <div key={i} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{obj.title}</p>
                      {obj.description && (
                        <p className="text-xs text-gray-500 mt-0.5">{obj.description}</p>
                      )}
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-gray-400">
                        <span>Ziel: <strong className="text-gray-600">{obj.target_value} {obj.target_unit}</strong></span>
                        {obj.target_date && <span>Termin: {obj.target_date}</span>}
                        <span>{obj.responsible}</span>
                        {obj.total_savings_kwh > 0 && (
                          <span className="text-green-600 font-medium">
                            ↓ {obj.total_savings_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh Einsparpotenzial
                          </span>
                        )}
                        {obj.total_savings_co2_kg > 0 && (
                          <span className="text-green-600">
                            · {obj.total_savings_co2_kg.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kg CO₂
                          </span>
                        )}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      obj.status === 'completed' ? 'bg-green-100 text-green-700' :
                      obj.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                      'bg-gray-100 text-gray-600'
                    }`}>
                      {obj.status_label}
                    </span>
                  </div>
                  {/* Fortschrittsbalken */}
                  <div className="mt-2 h-1.5 w-full rounded-full bg-gray-100">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${Math.min(prog, 100)}%`, backgroundColor: barColor }}
                    />
                  </div>
                  {/* Aktionspläne */}
                  {obj.actions.length > 0 && (
                    <div className="mt-2 space-y-1 pl-4 border-l-2 border-gray-100">
                      {obj.actions.map((act, j) => (
                        <div key={j} className="flex items-start justify-between gap-2 text-xs text-gray-500">
                          <span>↳ {act.title}</span>
                          <div className="flex items-center gap-2 shrink-0">
                            {act.savings_kwh > 0 && (
                              <span className="text-green-600">{act.savings_kwh.toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh</span>
                            )}
                            {act.savings_eur > 0 && (
                              <span className="text-green-600">{act.savings_eur.toLocaleString('de-DE', { maximumFractionDigits: 0 })} €</span>
                            )}
                            <span className={`rounded px-1.5 py-0.5 ${
                              act.status === 'completed' ? 'bg-green-100 text-green-700' :
                              act.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                              'bg-gray-100 text-gray-500'
                            }`}>{act.status_label}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Gebäude */}
      {buildings?.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2 flex items-center gap-1">
            <Building2 className="h-3.5 w-3.5" />
            Gebäude &amp; Liegenschaft
          </p>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 font-medium">Gebäude</th>
                <th className="pb-2 font-medium">Typ</th>
                <th className="pb-2 font-medium text-right">Fläche</th>
                <th className="pb-2 font-medium text-right">Baujahr</th>
                <th className="pb-2 font-medium text-right">Energieausweis</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 font-medium text-gray-700">{b.name}</td>
                  <td className="py-2 text-gray-500">{b.building_type_label}</td>
                  <td className="py-2 text-right text-gray-700">{b.area_m2 > 0 ? `${b.area_m2.toLocaleString('de-DE', { maximumFractionDigits: 0 })} m²` : '–'}</td>
                  <td className="py-2 text-right text-gray-500">{b.building_year ?? '–'}</td>
                  <td className="py-2 text-right text-gray-500">{b.energy_certificate_class ?? '–'}</td>
                </tr>
              ))}
            </tbody>
            {total_area_m2 > 0 && (
              <tfoot>
                <tr className="border-t-2 border-gray-300">
                  <td colSpan={2} className="py-2 font-semibold text-gray-700">Gesamt</td>
                  <td className="py-2 text-right font-semibold text-gray-700">{total_area_m2.toLocaleString('de-DE', { maximumFractionDigits: 0 })} m²</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* CO₂-Verlauf */}
      {co2_history?.length >= 2 && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">CO₂-Verlauf (historisch)</p>
          <div className="flex gap-2 flex-wrap">
            {co2_history.map((entry, i) => {
              const maxKg = Math.max(...co2_history.map(e => e.co2_kg));
              const pct = maxKg > 0 ? (entry.co2_kg / maxKg) * 100 : 0;
              const trend = i > 0 ? entry.co2_kg - co2_history[i - 1].co2_kg : 0;
              return (
                <div key={i} className="flex flex-col items-center gap-1 min-w-[52px]">
                  <div className="relative w-8 bg-gray-100 rounded-t" style={{ height: '60px' }}>
                    <div
                      className="absolute bottom-0 w-full rounded-t"
                      style={{ height: `${pct}%`, backgroundColor: '#1B5E7B' }}
                    />
                  </div>
                  <span className="text-xs font-mono text-gray-700">{(entry.co2_kg / 1000).toFixed(1)}t</span>
                  {i > 0 && (
                    <span className={`text-xs ${trend > 0 ? 'text-red-500' : 'text-green-600'}`}>
                      {trend > 0 ? '↑' : '↓'}
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{entry.year}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

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
  const charts = (snapshot.charts || {}) as Record<string, unknown>;

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

          {/* KPI-Karten: pro Energieart eine Karte (native Einheit) */}
          {(() => {
            const energyByType = snapshot.energy_by_type as Record<string, EnergyTypeData> | undefined;
            const intensityPerUnit = snapshot.energy_intensity_per_unit as number | null | undefined;
            const refUnit = (snapshot.reference_unit as string) || 'm²';
            const intensityPerDay = snapshot.energy_intensity_kwh_per_day as number | undefined;
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {energyByType && Object.entries(energyByType).map(([key, et]) => (
                  <div key={key} className="rounded-lg border p-3 text-center">
                    <p className="text-xl font-bold" style={{ color: et.color || '#1B5E7B' }}>
                      {et.total_native.toLocaleString('de-DE', { maximumFractionDigits: 0 })}
                    </p>
                    <p className="text-xs text-gray-400">{et.unit}</p>
                    <p className="text-xs text-gray-500">{et.label}</p>
                  </div>
                ))}
                {!energyByType && (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-xl font-bold text-primary-600">{formatNumber(totalKwh)}</p>
                    <p className="text-xs text-gray-500">kWh Gesamtverbrauch</p>
                  </div>
                )}
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-xl font-bold text-primary-600">{formatNumber(totalCo2)}</p>
                  <p className="text-xs text-gray-500">kg CO₂-Emissionen</p>
                </div>
                {intensityPerUnit != null ? (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-xl font-bold text-primary-600">{intensityPerUnit.toFixed(1)}</p>
                    <p className="text-xs text-gray-500">kWh/{refUnit}</p>
                  </div>
                ) : intensityPerDay ? (
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-xl font-bold text-primary-600">{intensityPerDay.toFixed(1)}</p>
                    <p className="text-xs text-gray-500">kWh/Tag</p>
                  </div>
                ) : null}
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-xl font-bold text-primary-600">{meterCount}</p>
                  <p className="text-xs text-gray-500">Erfasste Zähler</p>
                </div>
              </div>
            );
          })()}

          {/* Energieart-Trennung (Hauptsektion) */}
          <EnergyByTypeSection snapshot={snapshot as Record<string, unknown>} />

          {/* Schema-Stränge */}
          <SchemaStrandsSection snapshot={snapshot as Record<string, unknown>} />

          {/* Vorjahresvergleich nach Energieträger */}
          {(snapshot.energy_yoy_table as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Vorjahresvergleich nach Energieträger</h3>
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <th className="pb-2 font-medium">Energieträger</th>
                    <th className="pb-2 font-medium text-right">Vorjahr</th>
                    <th className="pb-2 font-medium text-right">Aktuell</th>
                    <th className="pb-2 font-medium text-right">Δ %</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.energy_yoy_table as Record<string, unknown>[]).map((row, idx) => {
                    const delta = row.delta_pct as number | null;
                    const unit = row.unit as string;
                    return (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-2 text-gray-700 font-medium">{row.label as string}</td>
                        <td className="py-2 text-right text-gray-500">{(row.prev_native as number).toLocaleString('de-DE', { maximumFractionDigits: 1 })} {unit}</td>
                        <td className="py-2 text-right text-gray-700">{(row.curr_native as number).toLocaleString('de-DE', { maximumFractionDigits: 1 })} {unit}</td>
                        <td className={`py-2 text-right font-semibold ${delta == null ? 'text-gray-400' : delta > 5 ? 'text-red-600' : delta < -5 ? 'text-green-600' : 'text-gray-700'}`}>
                          {delta != null ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%` : '–'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Verbrauch nach Bereichen */}
          {(snapshot.consumer_categories as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Verbrauch nach Bereichen</h3>
              <div className="space-y-2">
                {(snapshot.consumer_categories as Record<string, unknown>[]).map((cat, idx) => (
                  <div key={idx}>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-700">{cat.label as string}</span>
                      <span className="text-gray-500 font-mono">{(cat.kwh as number).toLocaleString('de-DE', { maximumFractionDigits: 0 })} kWh ({(cat.pct as number).toFixed(1)}%)</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                      <div className="h-1.5 rounded-full bg-primary-500" style={{ width: `${cat.pct as number}%` }} />
                    </div>
                  </div>
                ))}
              </div>
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

          {/* Nachhaltigkeit & ISO 50001 */}
          <SustainabilitySection snapshot={snapshot as Record<string, unknown>} />

          {/* Top-Verbraucher (SEU) – native Einheit */}
          {(snapshot.top_consumers as Record<string, unknown>[])?.length > 0 && (
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-2">Top-Verbraucher (SEU)</h3>
              <div className="space-y-2">
                {(snapshot.top_consumers as Record<string, unknown>[]).map((tc, idx) => {
                  // Sortierung per kWh-Äquiv, Anzeige in nativer Einheit
                  const maxVal = ((snapshot.top_consumers as Record<string, unknown>[])[0]?.consumption_kwh as number) || 1;
                  const pct = ((tc.consumption_kwh as number) / maxVal) * 100;
                  const native = tc.consumption_native as number | null;
                  const unit = (tc.unit as string) || 'kWh';
                  const etColor = (ENERGY_TYPE_COLORS as Record<string, string>)[tc.energy_type as string] || '#1B5E7B';
                  const displayVal = native != null && native > 0
                    ? `${native.toLocaleString('de-DE', { maximumFractionDigits: 1 })} ${unit}`
                    : `${formatNumber(tc.consumption_kwh as number)} kWh`;
                  return (
                    <div key={idx}>
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-1.5">
                          <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: etColor }} />
                          <span className="font-medium text-gray-700">{tc.name as string}</span>
                          <span className="text-xs text-gray-400">
                            {ENERGY_TYPE_LABELS[(tc.energy_type as string) as keyof typeof ENERGY_TYPE_LABELS] || (tc.energy_type as string)}
                          </span>
                        </div>
                        <span className="text-gray-500 font-mono text-xs">{displayVal}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: etColor }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Monatlicher Verbrauchsverlauf: nur anzeigen wenn genau eine Energieart */}
          {Object.keys((snapshot.energy_by_type as Record<string, unknown>) || {}).length <= 1 && (
            <MonthlyTrendChart snapshot={snapshot as Record<string, unknown>} />
          )}

          {/* Ursachenanalyse */}
          {(() => {
            const analysis = snapshot.analysis as { bullets?: string[]; weather?: Record<string, unknown> } | undefined;
            if (!analysis?.bullets?.length) return null;
            const weather = analysis.weather;
            return (
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-3">Ursachenanalyse</h3>
                <ul className="space-y-2">
                  {analysis.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="mt-0.5 h-2 w-2 flex-shrink-0 rounded-full bg-primary-500 mt-1.5" />
                      <span dangerouslySetInnerHTML={{ __html: b }} />
                    </li>
                  ))}
                </ul>
                {weather && (weather.actual_hdd as number) > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div className="rounded-lg border bg-blue-50 p-3 text-center">
                      <p className="text-lg font-bold text-blue-700">{(weather.actual_hdd as number).toFixed(0)}</p>
                      <p className="text-xs text-gray-500">
                        HDD{weather.reference_hdd ? ` (Ref: ${(weather.reference_hdd as number).toFixed(0)})` : ''}
                      </p>
                    </div>
                    <div className="rounded-lg border bg-blue-50 p-3 text-center">
                      <p className="text-lg font-bold text-blue-700">{(weather.avg_temp as number).toFixed(1)}°C</p>
                      <p className="text-xs text-gray-500">Mittlere Temperatur</p>
                    </div>
                    {(weather.heating_days as number) > 0 && (
                      <div className="rounded-lg border bg-blue-50 p-3 text-center">
                        <p className="text-lg font-bold text-blue-700">{weather.heating_days as number}</p>
                        <p className="text-xs text-gray-500">Heiztage</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Jahresvergleich */}
          <YoyChart charts={charts} />

          {/* KPI-Vergleichstabelle */}
          {(() => {
            const prevKwh = snapshot.prev_total_kwh as number | undefined;
            const currKwh = snapshot.total_consumption_kwh as number | undefined;
            const costSum = snapshot.cost_summary as Record<string, unknown> | undefined;
            const rows: { label: string; unit: string; prev: string; curr: string; delta: string | null }[] = [];
            if (prevKwh != null && currKwh != null && (prevKwh > 0 || currKwh > 0)) {
              const d = prevKwh > 0 ? ((currKwh - prevKwh) / prevKwh * 100) : null;
              rows.push({ label: 'Gesamtverbrauch (kWh-Äquiv.)', unit: 'kWh', prev: prevKwh.toLocaleString('de-DE', { maximumFractionDigits: 0 }), curr: currKwh.toLocaleString('de-DE', { maximumFractionDigits: 0 }), delta: d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)}%` : null });
            }
            if (costSum?.available && costSum.prev_year_cost_net != null) {
              const prev = costSum.prev_year_cost_net as number;
              const curr = costSum.total_cost_net as number;
              const d = prev > 0 ? ((curr - prev) / prev * 100) : null;
              rows.push({ label: 'Energiekosten', unit: '€ netto', prev: prev.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), curr: curr.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }), delta: d != null ? `${d > 0 ? '+' : ''}${d.toFixed(1)}%` : null });
            }
            if (rows.length === 0) return null;
            return (
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Kennzahlen-Vergleich</h3>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="pb-2 font-medium">Kennzahl</th>
                      <th className="pb-2 font-medium text-right">Einheit</th>
                      <th className="pb-2 font-medium text-right">Vorjahr</th>
                      <th className="pb-2 font-medium text-right">Aktuell</th>
                      <th className="pb-2 font-medium text-right">Δ %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-2 text-gray-700">{row.label}</td>
                        <td className="py-2 text-right text-gray-400 text-xs">{row.unit}</td>
                        <td className="py-2 text-right text-gray-500">{row.prev}</td>
                        <td className="py-2 text-right text-gray-700 font-medium">{row.curr}</td>
                        <td className={`py-2 text-right font-semibold ${row.delta == null ? 'text-gray-400' : row.delta.startsWith('+') ? 'text-red-600' : 'text-green-600'}`}>
                          {row.delta ?? '–'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Maßnahmen & Ergebnisse (split by status) */}
          {(() => {
            const sus = snapshot.sustainability as Record<string, unknown> | undefined;
            const objs = sus?.objectives as Record<string, unknown>[] | undefined;
            if (!objs?.length) return null;
            const STATUS_DONE = new Set(['completed', 'abgeschlossen', 'done']);
            const done = objs.filter(o => STATUS_DONE.has((o.status as string || '').toLowerCase()) || (o.progress_percent as number) >= 100);
            const planned = objs.filter(o => !STATUS_DONE.has((o.status as string || '').toLowerCase()) && (o.progress_percent as number | null) !== 100);
            const renderRows = (items: Record<string, unknown>[]) => items.map((obj, idx) => {
              const prog = obj.progress_percent as number | null;
              return (
                <div key={idx} className="border-b last:border-0 py-2">
                  <div className="flex justify-between items-start">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{obj.title as string}</p>
                      {!!obj.description && <p className="text-xs text-gray-500">{obj.description as string}</p>}
                    </div>
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{obj.target_date as string || '–'}</span>
                  </div>
                  {prog != null && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                        <div className="h-1.5 rounded-full" style={{ width: `${Math.min(prog, 100)}%`, backgroundColor: prog >= 80 ? '#16A34A' : prog >= 40 ? '#F59E0B' : '#1B5E7B' }} />
                      </div>
                      <span className="text-xs text-gray-500 w-8 text-right">{prog.toFixed(0)}%</span>
                    </div>
                  )}
                </div>
              );
            });
            return (
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Maßnahmen &amp; Ergebnisse</h3>
                {done.length > 0 && (
                  <div className="mb-3">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">Abgeschlossen ({done.length})</p>
                    <div className="divide-y">{renderRows(done)}</div>
                  </div>
                )}
                {planned.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-primary-600 uppercase tracking-wide mb-1">Laufend &amp; Geplant ({planned.length})</p>
                    <div className="divide-y">{renderRows(planned)}</div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Wirtschaftlichkeit */}
          <CostSection snapshot={snapshot as Record<string, unknown>} />

          {/* Energiefluss (Sankey) */}
          <SankeyChart charts={charts} />

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
                        {!!r.savings_note && (
                          <span className="ml-1 font-normal text-gray-400 text-xs">({String(r.savings_note)})</span>
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bewertung & Ausblick */}
          {(() => {
            const sus = snapshot.sustainability as Record<string, unknown> | undefined;
            const objs = sus?.objectives as Record<string, unknown>[] | undefined;
            const costSum = snapshot.cost_summary as Record<string, unknown> | undefined;
            const prevKwh = snapshot.prev_total_kwh as number | undefined;
            const currKwh = snapshot.total_consumption_kwh as number | undefined;
            const renewPct = snapshot.renewable_pct as number | undefined;
            const hasData = (prevKwh != null && currKwh != null) || costSum?.available || (renewPct != null && renewPct > 0);
            if (!hasData) return null;
            const yoyDelta = (prevKwh != null && prevKwh > 0 && currKwh != null) ? ((currKwh - prevKwh) / prevKwh * 100) : null;
            const STATUS_DONE = new Set(['completed', 'abgeschlossen', 'done']);
            const doneCount = objs?.filter(o => STATUS_DONE.has((o.status as string || '').toLowerCase()) || (o.progress_percent as number) >= 100).length ?? 0;
            return (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <h3 className="text-base font-semibold text-gray-900 mb-2">Bewertung &amp; Ausblick</h3>
                <div className="space-y-1.5 text-sm text-gray-700">
                  {yoyDelta != null && (
                    <p>Gesamtenergieverbrauch ist gegenüber Vorjahr um <span className={`font-semibold ${yoyDelta > 0 ? 'text-red-600' : 'text-green-600'}`}>{yoyDelta > 0 ? '+' : ''}{yoyDelta.toFixed(1)}%</span> {yoyDelta > 0 ? 'gestiegen' : 'gesunken'}.</p>
                  )}
                  {!!costSum?.available && (() => {
                    const savings = costSum!.cost_savings as number | null;
                    if (savings == null || Math.abs(savings) === 0) return null;
                    return <p>Energiekosten haben sich um <span className={`font-semibold ${savings > 0 ? 'text-green-600' : 'text-red-600'}`}>{Math.abs(savings).toLocaleString('de-DE', { maximumFractionDigits: 0 })} €</span> {savings > 0 ? 'reduziert' : 'erhöht'}.</p>;
                  })()}
                  {renewPct != null && renewPct > 0 && (
                    <p>Anteil erneuerbarer Energien: <span className="font-semibold text-green-600">{renewPct.toFixed(1)}%</span></p>
                  )}
                  {objs != null && objs.length > 0 && (
                    <p>Von {objs.length} Energiezielen sind <span className="font-semibold text-green-600">{doneCount}</span> abgeschlossen.</p>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Kontinuierliche Verbesserung (KVP) */}
          {(() => {
            const sus = snapshot.sustainability as Record<string, unknown> | undefined;
            const kvp = sus?.kvp as Record<string, unknown> | undefined;
            if (!kvp) return null;
            const openNc = kvp.open_nonconformities as number ?? 0;
            const closedNc = kvp.closed_nonconformities as number ?? 0;
            const totalAudits = kvp.total_audits as number ?? 0;
            const lastReview = kvp.last_review_date as string | null;
            return (
              <div>
                <h3 className="text-base font-semibold text-gray-900 mb-2">Kontinuierliche Verbesserung (KVP)</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className={`rounded-lg border p-3 text-center ${openNc > 0 ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
                    <p className={`text-2xl font-bold ${openNc > 0 ? 'text-red-600' : 'text-green-600'}`}>{openNc}</p>
                    <p className="text-xs text-gray-500 mt-1">Offene Abweichungen</p>
                  </div>
                  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-center">
                    <p className="text-2xl font-bold text-green-600">{closedNc}</p>
                    <p className="text-xs text-gray-500 mt-1">Geschlossene Abweichungen</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                    <p className="text-2xl font-bold text-gray-700">{totalAudits}</p>
                    <p className="text-xs text-gray-500 mt-1">Interne Audits</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-center">
                    <p className="text-sm font-bold text-gray-700">{lastReview ?? '–'}</p>
                    <p className="text-xs text-gray-500 mt-1">Letztes Management-Review</p>
                  </div>
                </div>
              </div>
            );
          })()}

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

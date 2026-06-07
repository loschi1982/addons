import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiClient } from '@/utils/api';
import PageHead from '@/components/ui/PageHead';

interface Alert {
  type: string;
  severity: string;
  message: string;
  meter_id: string;
  meter_name?: string;
  meter_display_name?: string | null;
  last_reading_at?: string | null;
  days_since?: number | null;
}

interface PlausibilityWarning {
  warning_type?: 'sub_meter_mismatch' | 'frozen_meter';
  meter_name: string;
  meter_display_name?: string | null;
  meter_id?: string;
  energy_type: string;
  main_value?: number;
  main_unit?: string;
  sub_sum?: number;
  diff_percent?: number;
  frozen_since?: string;
  frozen_days?: number;
  frozen_value?: number;
  last_reading_at?: string;
}

interface DataQualityResponse {
  period_start: string;
  period_end: string;
  alerts: Alert[];
  plausibility_warnings: PlausibilityWarning[];
}

function formatNumber(value: unknown, decimals = 1): string {
  const num = Number(value) || 0;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(decimals)} Mio.`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(decimals)} k`;
  return num.toFixed(decimals);
}

function fmtDate(iso?: string | null): string {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function AlertBanner({ alerts }: { alerts: Alert[] }) {
  const navigate = useNavigate();
  if (alerts.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="h-5 w-5 text-amber-600" />
        <h3 className="font-medium text-amber-800">
          {alerts.length} Warnung{alerts.length > 1 ? 'en' : ''} – Zähler ohne aktuelle Daten
        </h3>
      </div>
      <ul className="space-y-1">
        {alerts.map((a, i) => {
          const name = a.meter_name ?? '';
          const display = a.meter_display_name;
          const hasReading = !!a.last_reading_at;
          return (
            <li key={i} className="text-sm text-amber-700">
              {a.meter_id ? (
                <button
                  onClick={() => navigate(`/readings?meter_id=${a.meter_id}`)}
                  className="font-medium hover:underline text-left"
                >
                  {name}
                </button>
              ) : (
                <span className="font-medium">{name}</span>
              )}
              {display ? <span className="text-amber-600"> – {display}</span> : null}
              {hasReading
                ? ` hat seit ${fmtDate(a.last_reading_at)} (${a.days_since} Tagen) keine Daten geliefert.`
                : ` hat noch keine Daten geliefert.`}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlausibilityBanner({ warnings, onReload }: { warnings: PlausibilityWarning[]; onReload: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  if (!warnings || warnings.length === 0) return null;

  const mismatch = warnings.filter((w) => (w.warning_type ?? 'sub_meter_mismatch') === 'sub_meter_mismatch');
  const frozen = warnings.filter((w) => w.warning_type === 'frozen_meter');

  const handleDeactivate = async (meterId: string, name: string) => {
    if (!confirm(`Zähler "${name}" wirklich deaktivieren? Er wird in Auswertungen nicht mehr berücksichtigt.`)) return;
    setBusy(meterId);
    try {
      await apiClient.put(`/api/v1/meters/${meterId}`, { is_active: false });
      onReload();
    } catch {
      alert('Deaktivieren fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      {mismatch.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-orange-600" />
            <h3 className="font-medium text-orange-800">
              Plausibilitätsprüfung: {mismatch.length} Abweichung{mismatch.length > 1 ? 'en' : ''} Hauptzähler vs. Unterzähler
            </h3>
          </div>
          <ul className="space-y-1.5">
            {mismatch.map((w, i) => {
              const subGtMain = (w.sub_sum ?? 0) > (w.main_value ?? 0);
              return (
                <li key={i} className="text-sm text-orange-700">
                  {w.meter_id ? (
                    <button
                      onClick={() => navigate(`/schemas?meter_id=${w.meter_id}`)}
                      className="font-medium hover:underline text-left"
                      title="Im Energieschema öffnen"
                    >
                      {w.meter_name}
                    </button>
                  ) : (
                    <span className="font-medium">{w.meter_name}</span>
                  )}
                  {w.meter_display_name ? <span className="text-orange-600"> – {w.meter_display_name}</span> : null}
                  : Hauptzähler {formatNumber(w.main_value ?? 0, 0)} {w.main_unit},
                  Unterzähler-Summe {formatNumber(w.sub_sum ?? 0, 0)} {w.main_unit} ({(w.diff_percent ?? 0).toFixed(1)} % Differenz)
                  {subGtMain && (
                    <span className="ml-2 inline-block rounded bg-orange-200 px-1.5 py-0.5 text-xs font-medium text-orange-900">
                      Unterzähler &gt; Hauptzähler – Datenfehler prüfen
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {frozen.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <h3 className="font-medium text-amber-800">
              Eingefrorene Zähler: {frozen.length} Zähler ohne Wertänderung
            </h3>
          </div>
          <ul className="space-y-1.5">
            {frozen.map((w, i) => (
              <li key={i} className="flex items-center gap-2 text-sm text-amber-700">
                <span className="flex-1">
                  {w.meter_id ? (
                    <button
                      onClick={() => navigate(`/readings?meter_id=${w.meter_id}`)}
                      className="font-medium hover:underline text-left"
                    >
                      {w.meter_name}
                    </button>
                  ) : (
                    <span className="font-medium">{w.meter_name}</span>
                  )}
                  {w.meter_display_name ? <span className="text-amber-600"> – {w.meter_display_name}</span> : null}
                  {' '}– seit {fmtDate(w.frozen_since)} unverändert ({w.frozen_days} Tage),
                  Wert: {formatNumber(w.frozen_value ?? 0, 2)} {w.main_unit}
                </span>
                {w.meter_id && (
                  <button
                    onClick={() => handleDeactivate(w.meter_id!, w.meter_name)}
                    disabled={busy === w.meter_id}
                    className="flex-shrink-0 rounded border border-amber-300 bg-white px-2 py-0.5 text-xs font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                    title="Zähler deaktivieren (is_active=false)"
                  >
                    {busy === w.meter_id ? 'Wird deaktiviert…' : 'Deaktivieren'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-600">
            Mögliche Ursachen: defekter Zähler, fehlende Datenquelle, dauerhaft inaktiver Verbraucher.
          </p>
        </div>
      )}
    </div>
  );
}

export default function DataQualityPage() {
  const [data, setData] = useState<DataQualityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await apiClient.get<DataQualityResponse>('/api/v1/dashboard/data-quality');
      setData(resp.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unbekannter Fehler';
      setError(`Datenqualität konnte nicht geladen werden: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const alertCount = data?.alerts.length ?? 0;
  const warningCount = data?.plausibility_warnings.length ?? 0;
  const clean = !loading && !error && alertCount === 0 && warningCount === 0;

  return (
    <div>

      <PageHead
        eyebrow="Analyse"
        title="Datenqualität"
        actions={
          <button
            onClick={load}
            disabled={loading}
            className="btn-secondary flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Neu prüfen
          </button>
        }
      />
      <p style={{ marginTop: -4, marginBottom: 12, fontSize: 12, color: 'var(--ink-3)' }}>
        Zähler ohne aktuelle Daten und Plausibilitätsprüfung Haupt-/Unterzähler.
      </p>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="card text-center text-gray-500">Lade Datenqualitätsprüfung…</div>
      )}

      {clean && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <h3 className="font-medium text-emerald-800">Keine Auffälligkeiten</h3>
            <p className="text-sm text-emerald-700">
              Alle Zähler liefern aktuelle Daten, Haupt-/Unterzähler stimmen überein.
            </p>
          </div>
        </div>
      )}

      {data && (alertCount > 0 || warningCount > 0) && (
        <div className="space-y-4">
          <AlertBanner alerts={data.alerts} />
          <PlausibilityBanner warnings={data.plausibility_warnings} onReload={load} />
        </div>
      )}
    </div>
  );
}

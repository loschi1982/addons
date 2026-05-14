"""
root_cause_analyzer.py – Ursachenanalyse für Energieberichte.

Erzeugt aus dem Berichts-Snapshot eine strukturierte Analyse mit
7 Schwerpunkt-Blöcken (Witterung, Verbraucher-Anomalien, Lastspitzen,
Kosten-Ursachen, EnPI, Benchmark, Raumklima). Jeder Block liefert
Beobachtung, Bewertung, mögliche Ursachen und (falls Daten fehlen)
einen Aktivierungs-Hinweis.

Genutzte Services werden bei Bedarf aufgerufen — fehlende Daten führen
nicht zu Fehlern, sondern zu einem `available=False`-Block.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.meter import Meter
from app.models.reading import MeterReading
from app.services.reporting.chart_renderer import (
    render_benchmark_svg,
    render_climate_overlay_svg,
    render_cost_attribution_svg,
    render_enpi_trend_svg,
    render_peak_profile_svg,
    render_submeter_changes_svg,
    render_weather_normalized_trend_svg,
)

logger = structlog.get_logger()


class RootCauseAnalyzer:
    """Generiert die Ursachenanalyse-Sektion für einen Bericht-Snapshot."""

    def __init__(
        self,
        db: AsyncSession,
        snapshot: dict,
        period_start: date,
        period_end: date,
        scope: dict | None = None,
    ):
        self.db = db
        self.snapshot = snapshot
        self.period_start = period_start
        self.period_end = period_end
        self.scope = scope or {}
        # Vorjahreszeitraum
        try:
            self.prev_start = period_start.replace(year=period_start.year - 1)
            self.prev_end = period_end.replace(year=period_end.year - 1)
        except ValueError:
            self.prev_start = period_start - timedelta(days=365)
            self.prev_end = period_end - timedelta(days=365)

    async def analyze(self) -> dict:
        """Hauptmethode – führt alle Block-Analysen aus."""
        blocks: dict[str, Any] = {}
        for name, fn in [
            ("weather", self._weather_block),
            ("consumer_anomalies", self._consumer_block),
            ("peak_load", self._peak_block),
            ("cost_drivers", self._cost_block),
            ("enpi", self._enpi_block),
            ("benchmark", self._benchmark_block),
            ("climate", self._climate_block),
        ]:
            try:
                blocks[name] = await fn()
            except Exception as e:
                logger.warning("root_cause_block_failed", block=name, error=str(e))
                blocks[name] = {
                    "available": False,
                    "title": name.replace("_", " ").title(),
                    "hint": f"Block konnte nicht berechnet werden: {e}",
                }

        blocks["summary_findings"] = self._summary_findings(blocks)
        return blocks

    # ─────────────────────────────────────────────────────────────────
    # 1. Witterungseinfluss
    # ─────────────────────────────────────────────────────────────────

    async def _weather_block(self) -> dict:
        """Vergleich roher vs. witterungsbereinigter Verbrauch."""
        from app.models.correction import WeatherCorrectedConsumption, WeatherCorrectionConfig

        # Welche Zähler haben Witterungskorrektur konfiguriert?
        configs = (await self.db.execute(
            select(WeatherCorrectionConfig).where(WeatherCorrectionConfig.is_active == True)  # noqa: E712
        )).scalars().all()
        if not configs:
            return {
                "available": False,
                "title": "Witterungseinfluss",
                "hint": "Aktivieren Sie die Witterungskorrektur unter Zähler → Witterungskorrektur, um Heizgradtage-bereinigte Verbräuche zu sehen.",
                "severity": "info",
            }

        # Korrigierte Werte für den Zeitraum
        meter_ids = [c.meter_id for c in configs]
        rows = (await self.db.execute(
            select(WeatherCorrectedConsumption).where(
                WeatherCorrectedConsumption.meter_id.in_(meter_ids),
                WeatherCorrectedConsumption.period_start >= self.period_start,
                WeatherCorrectedConsumption.period_end <= self.period_end,
            ).order_by(WeatherCorrectedConsumption.period_start)
        )).scalars().all()

        if not rows:
            return {
                "available": False,
                "title": "Witterungseinfluss",
                "hint": "Witterungskorrektur ist konfiguriert, aber für den Zeitraum liegen keine berechneten Werte vor. Berechnen Sie die Korrektur neu.",
                "severity": "info",
            }

        # Pro Monat aggregieren
        by_month: dict[str, dict] = {}
        for r in rows:
            key = r.period_start.strftime("%Y-%m")
            d = by_month.setdefault(key, {"month": key, "raw": 0.0, "corrected": 0.0, "actual_hdd": 0.0, "reference_hdd": 0.0, "n": 0})
            d["raw"] += float(r.raw_consumption or 0)
            d["corrected"] += float(r.corrected_consumption or 0)
            d["actual_hdd"] += float(r.actual_hdd or 0)
            d["reference_hdd"] += float(r.reference_hdd or 0)
            d["n"] += 1
        months = sorted(by_month.values(), key=lambda x: x["month"])
        # HDD-Mittelwert pro Monat (über alle Zähler)
        for m in months:
            if m["n"] > 0:
                m["actual_hdd"] /= m["n"]
                m["reference_hdd"] /= m["n"]

        total_raw = sum(m["raw"] for m in months)
        total_corr = sum(m["corrected"] for m in months)
        if total_raw <= 0:
            return {"available": False, "title": "Witterungseinfluss", "hint": "Keine Verbrauchsdaten zur Korrektur.", "severity": "info"}

        weather_share = (total_raw - total_corr) / total_raw * 100
        delta = total_raw - total_corr
        chart_svg = render_weather_normalized_trend_svg(months)

        if abs(weather_share) > 5:
            severity = "mittel"
            sign = "höher" if weather_share > 0 else "niedriger"
            description = (
                f"Der gemessene Verbrauch lag witterungsbedingt {abs(weather_share):.1f} % {sign} "
                f"als unter Norm-Bedingungen erwartet ({abs(delta):,.0f} kWh). "
                f"Nach Witterungsbereinigung beträgt der Verbrauch {total_corr:,.0f} kWh "
                f"(Roh: {total_raw:,.0f} kWh)."
            )
        else:
            severity = "info"
            description = (
                f"Witterung erklärt nur {abs(weather_share):.1f} % der Abweichung — der Verbrauch "
                f"liegt im Normbereich. Roh: {total_raw:,.0f} kWh, korrigiert: {total_corr:,.0f} kWh."
            )

        return {
            "available": True,
            "title": "Witterungseinfluss",
            "description": description,
            "metrics": {
                "raw_kwh": round(total_raw, 1),
                "corrected_kwh": round(total_corr, 1),
                "weather_share_pct": round(weather_share, 1),
                "delta_kwh": round(delta, 1),
                "meter_count": len(meter_ids),
            },
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 2. Verbraucher-Anomalien
    # ─────────────────────────────────────────────────────────────────

    async def _consumer_block(self) -> dict:
        """Top-Verbraucher mit größten Abweichungen zum Vorjahr."""
        # Konvertierung
        CONVERSION = {"m³": 10.3, "l": 9.8, "kg": 4.8, "MWh": 1000.0, "kWh": 1.0}

        async def _sums(start: date, end: date) -> dict:
            ts_start = datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc)
            ts_end = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
            q = (
                select(
                    Meter.id, Meter.name, Meter.display_name, Meter.energy_type, Meter.unit,
                    func.sum(MeterReading.consumption).label("total"),
                )
                .join(MeterReading, MeterReading.meter_id == Meter.id)
                .where(
                    Meter.is_active == True,  # noqa: E712
                    Meter.is_feed_in != True,
                    MeterReading.timestamp >= ts_start,
                    MeterReading.timestamp < ts_end,
                    MeterReading.consumption.isnot(None),
                    MeterReading.consumption > 0,
                )
                .group_by(Meter.id, Meter.name, Meter.display_name, Meter.energy_type, Meter.unit)
            )
            rows = (await self.db.execute(q)).all()
            return {
                r.id: {
                    "name": r.name,
                    "display_name": r.display_name,
                    "unit": r.unit,
                    "kwh": float(r.total or 0) * CONVERSION.get(r.unit, 1.0),
                }
                for r in rows
            }

        curr = await _sums(self.period_start, self.period_end)
        prev = await _sums(self.prev_start, self.prev_end)
        if not curr:
            return {"available": False, "title": "Verbraucher-Anomalien", "hint": "Keine Verbrauchsdaten im Zeitraum.", "severity": "info"}

        total_curr = sum(c["kwh"] for c in curr.values())
        if total_curr <= 0:
            return {"available": False, "title": "Verbraucher-Anomalien", "hint": "Kein Verbrauch im Zeitraum.", "severity": "info"}

        rows = []
        for mid, c in curr.items():
            p = prev.get(mid, {"kwh": 0.0})
            curr_kwh = c["kwh"]
            prev_kwh = p["kwh"]
            share = curr_kwh / total_curr * 100
            if prev_kwh > 0:
                delta_pct = (curr_kwh - prev_kwh) / prev_kwh * 100
            else:
                delta_pct = None  # nicht vergleichbar
            rows.append({
                "meter_id": str(mid),
                "name": c["name"],
                "display_name": c["display_name"],
                "curr_kwh": round(curr_kwh, 1),
                "prev_kwh": round(prev_kwh, 1),
                "delta_pct": round(delta_pct, 1) if delta_pct is not None else None,
                "share_pct": round(share, 2),
            })

        # Top 10 nach absoluter Veränderung (kWh)
        rows.sort(key=lambda r: abs(r["curr_kwh"] - r["prev_kwh"]), reverse=True)
        top = rows[:10]

        # Größter Treiber
        anomalies = [r for r in top if r["delta_pct"] is not None and abs(r["delta_pct"]) > 20]
        # Extreme Ausreißer (>1000 %) als wahrscheinlichen Datenfehler markieren
        data_errors = [r for r in anomalies if abs(r["delta_pct"]) > 1000]
        real_anomalies = [r for r in anomalies if abs(r["delta_pct"]) <= 1000]
        chart_svg = render_submeter_changes_svg(top)

        if anomalies:
            biggest = anomalies[0]
            label = biggest["display_name"] or biggest["name"]
            if data_errors:
                description = (
                    f"⚠️ {len(data_errors)} Zähler zeigen Veränderungen >1000 % — wahrscheinlich Datenfehler "
                    f"(Zählerwechsel, falsche Einheit, fehlende Vorjahreswerte). "
                    f"Größte Veränderung: **{label}** mit {biggest['delta_pct']:+.1f} % "
                    f"({biggest['prev_kwh']:,.0f} → {biggest['curr_kwh']:,.0f} kWh). "
                    f"{len(real_anomalies)} weitere Zähler weichen plausibel >20 % vom Vorjahr ab."
                )
            else:
                description = (
                    f"{len(anomalies)} Zähler weichen >20 % vom Vorjahr ab. Größte Veränderung: "
                    f"**{label}** mit {biggest['delta_pct']:+.1f} % "
                    f"({biggest['prev_kwh']:,.0f} → {biggest['curr_kwh']:,.0f} kWh). "
                    f"Prüfen Sie: geänderte Belegung, Filtertausch, defekte Steuerung oder Sub-Zähler-Verkabelung."
                )
            severity = "hoch" if data_errors else "mittel"
        else:
            description = (
                f"Top-Verbraucher zeigen keine ungewöhnlichen Veränderungen (alle <20 % vs. Vorjahr). "
                f"Verbrauchsstruktur ist stabil."
            )
            severity = "info"

        return {
            "available": True,
            "title": "Verbraucher-Anomalien",
            "description": description,
            "metrics": {
                "total_current_kwh": round(total_curr, 1),
                "anomaly_count": len(anomalies),
                "top_meter": (anomalies[0]["display_name"] or anomalies[0]["name"]) if anomalies else None,
            },
            "top_meters": top,
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 3. Lastspitzen
    # ─────────────────────────────────────────────────────────────────

    async def _peak_block(self) -> dict:
        """Peak-zu-Mittel-Quotient und Spitzenstunden für Stromzähler."""
        from app.services.analytics_service import AnalyticsService

        # Nur Strom (Lastprofile sind primär für Strom relevant)
        meter_ids_rows = (await self.db.execute(
            select(Meter.id).where(
                Meter.is_active == True,  # noqa: E712
                Meter.is_feed_in != True,
                Meter.energy_type == "electricity",
                Meter.parent_meter_id.is_(None),  # Nur Hauptzähler
            )
        )).all()
        meter_ids = [r[0] for r in meter_ids_rows]
        if not meter_ids:
            return {"available": False, "title": "Lastspitzen", "hint": "Keine Strom-Hauptzähler aktiv.", "severity": "info"}

        svc = AnalyticsService(self.db)
        try:
            profile = await svc.get_load_profile(meter_ids, self.period_start, self.period_end)
        except Exception as e:
            return {"available": False, "title": "Lastspitzen", "hint": f"Lastprofil konnte nicht berechnet werden: {e}", "severity": "info"}

        peak = profile.get("peak_demand_kw")
        avg = profile.get("avg_demand_kw")
        daily_peaks = profile.get("daily_peaks", [])
        if not peak or not avg or avg <= 0:
            return {"available": False, "title": "Lastspitzen", "hint": "Nicht genügend Daten für Lastprofil-Auswertung.", "severity": "info"}

        ratio = peak / avg

        # Spitzenstunden ermitteln (Stunde des Tages-Peaks)
        peak_hours: dict[int, int] = {}
        for dp in daily_peaks:
            ts = dp.get("ts") or dp.get("timestamp")
            if not ts:
                continue
            try:
                hour = datetime.fromisoformat(ts.replace("Z", "+00:00")).hour
                peak_hours[hour] = peak_hours.get(hour, 0) + 1
            except Exception:
                continue
        top_hours = sorted(peak_hours.items(), key=lambda x: -x[1])[:3]
        hour_list = ", ".join(f"{h:02d}:00 ({n}×)" for h, n in top_hours) if top_hours else "keine Häufung"

        contract = profile.get("max_demand_kw_contract")
        exceeded = profile.get("contract_exceeded", False)

        if ratio > 2.0:
            severity = "mittel" if not exceeded else "hoch"
            description = (
                f"Spitzenlast {peak:,.1f} kW liegt {ratio:.1f}× über dem Mittelwert ({avg:,.1f} kW). "
                f"Bevorzugte Spitzenstunden: {hour_list}. "
                f"Typische Ursachen: zeitgleicher Anlauf großer Verbraucher, fehlende Lastverschiebung, "
                f"oder Kühlung-/Beleuchtungsschaltzeiten."
            )
            if exceeded and contract:
                description += f" ⚠️ Vertragsgrenze ({contract:,.0f} kW) wurde überschritten — Spitzenlast-Zuschläge wahrscheinlich."
        else:
            severity = "info"
            description = (
                f"Lastprofil ist gleichmäßig: Spitzen nur {ratio:.1f}× über Durchschnitt "
                f"({peak:,.1f} kW Peak vs. {avg:,.1f} kW Ø). Optimierungspotenzial begrenzt."
            )

        chart_svg = render_peak_profile_svg(peak_hours)

        return {
            "available": True,
            "title": "Lastspitzen",
            "description": description,
            "metrics": {
                "peak_kw": round(peak, 1),
                "avg_kw": round(avg, 1),
                "ratio": round(ratio, 2),
                "contract_kw": contract,
                "contract_exceeded": exceeded,
                "top_hours": [{"hour": h, "count": n} for h, n in top_hours],
            },
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 4. Kosten-Ursachen
    # ─────────────────────────────────────────────────────────────────

    async def _cost_block(self) -> dict:
        """Kostendelta in Verbrauchs- vs. Tarif-Komponente zerlegen."""
        cost_summary = self.snapshot.get("cost_summary") or {}
        total_curr = float(cost_summary.get("total_cost_net") or 0)
        total_prev = cost_summary.get("prev_year_cost_net")

        snap_curr_kwh = float(self.snapshot.get("total_consumption_kwh") or 0)
        snap_prev_kwh = float(self.snapshot.get("prev_total_kwh") or 0)

        if total_curr <= 0 or total_prev is None or float(total_prev) <= 0:
            return {
                "available": False,
                "title": "Kosten-Ursachen",
                "hint": "Vorjahres-Kostendaten fehlen — Kostenursachen können nicht zerlegt werden.",
                "severity": "info",
            }
        total_prev = float(total_prev)

        if snap_prev_kwh <= 0 or snap_curr_kwh <= 0:
            return {
                "available": False,
                "title": "Kosten-Ursachen",
                "hint": "Verbrauchsdaten für Vorjahresvergleich unvollständig.",
                "severity": "info",
            }

        # Durchschnittspreise
        price_prev = total_prev / snap_prev_kwh
        price_curr = total_curr / snap_curr_kwh

        # Zerlegung: Mengeneffekt = (curr_kwh - prev_kwh) × price_prev
        # Preiseffekt = curr_kwh × (price_curr - price_prev)
        volume_effect = (snap_curr_kwh - snap_prev_kwh) * price_prev
        price_effect = snap_curr_kwh * (price_curr - price_prev)
        total_delta = total_curr - total_prev  # ≈ volume_effect + price_effect

        delta_pct = total_delta / total_prev * 100 if total_prev else 0
        vol_pct = volume_effect / total_prev * 100 if total_prev else 0
        prc_pct = price_effect / total_prev * 100 if total_prev else 0

        chart_svg = render_cost_attribution_svg({
            "prev": total_prev,
            "volume_effect": volume_effect,
            "price_effect": price_effect,
            "curr": total_curr,
        })

        if abs(delta_pct) < 2:
            severity = "info"
            description = (
                f"Kosten praktisch konstant ({delta_pct:+.1f} %): "
                f"{total_prev:,.0f} € → {total_curr:,.0f} €."
            )
        else:
            severity = "mittel" if abs(delta_pct) < 15 else "hoch"
            sign_word = "höher" if delta_pct > 0 else "niedriger"
            description = (
                f"Energiekosten {abs(delta_pct):.1f} % {sign_word} als Vorjahr ({total_prev:,.0f} € → {total_curr:,.0f} €). "
                f"Davon entfallen **{vol_pct:+.1f} %** auf Verbrauchsänderung und "
                f"**{prc_pct:+.1f} %** auf Tarifentwicklung "
                f"(Ø-Preis: {price_prev*100:.1f} → {price_curr*100:.1f} ct/kWh)."
            )

        return {
            "available": True,
            "title": "Kosten-Ursachen",
            "description": description,
            "metrics": {
                "total_prev_eur": round(total_prev, 2),
                "total_curr_eur": round(total_curr, 2),
                "volume_effect_eur": round(volume_effect, 2),
                "price_effect_eur": round(price_effect, 2),
                "price_prev_ct_per_kwh": round(price_prev * 100, 2),
                "price_curr_ct_per_kwh": round(price_curr * 100, 2),
            },
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 5. EnPI vs. Ziel/Baseline
    # ─────────────────────────────────────────────────────────────────

    async def _enpi_block(self) -> dict:
        """Pro EnPI: Baseline-Vergleich und Ziel-Erreichung."""
        from app.models.energy_review import EnergyBaseline, EnergyPerformanceIndicator, EnPIValue

        enpis = (await self.db.execute(
            select(EnergyPerformanceIndicator)
        )).scalars().all()
        if not enpis:
            return {
                "available": False,
                "title": "EnPI vs. Ziel/Baseline",
                "hint": "Keine Energy Performance Indicators definiert. Legen Sie EnPIs unter Energiebewertung an, um Effizienz-Trends zu sehen.",
                "severity": "info",
            }

        entries = []
        for enpi in enpis:
            # Werte im Berichtszeitraum (Mittelwert)
            vals = (await self.db.execute(
                select(EnPIValue).where(
                    EnPIValue.enpi_id == enpi.id,
                    EnPIValue.period_start >= self.period_start,
                    EnPIValue.period_end <= self.period_end,
                )
            )).scalars().all()
            current = (sum(float(v.enpi_value) for v in vals) / len(vals)) if vals else None

            # Aktuelle Baseline
            baseline = (await self.db.execute(
                select(EnergyBaseline).where(
                    EnergyBaseline.enpi_id == enpi.id,
                    EnergyBaseline.is_current == True,  # noqa: E712
                )
            )).scalar_one_or_none()
            baseline_value = float(baseline.adjusted_baseline_value or baseline.baseline_value) if baseline else None

            # Verlauf für Chart (letzte 24 Monate)
            history = (await self.db.execute(
                select(EnPIValue).where(EnPIValue.enpi_id == enpi.id).order_by(EnPIValue.period_start)
            )).scalars().all()
            history_points = [{
                "period": v.period_start.isoformat(),
                "value": float(v.enpi_value),
            } for v in history]

            entries.append({
                "id": str(enpi.id),
                "name": enpi.name,
                "unit": enpi.unit,
                "current": round(current, 2) if current is not None else None,
                "baseline": round(baseline_value, 2) if baseline_value is not None else None,
                "target": float(enpi.target_value) if enpi.target_value is not None else None,
                "target_direction": enpi.target_direction,
                "history": history_points,
            })

        # Bewertung
        off_target = []
        for e in entries:
            if e["current"] is None or e["target"] is None:
                continue
            lower_is_better = e["target_direction"] in (None, "lower")
            diff = e["current"] - e["target"]
            if lower_is_better and diff > 0:
                off_target.append({**e, "deviation": diff})
            elif not lower_is_better and diff < 0:
                off_target.append({**e, "deviation": -diff})

        chart_svg = render_enpi_trend_svg(entries)

        if off_target:
            worst = max(off_target, key=lambda x: abs(x["deviation"]))
            severity = "mittel"
            description = (
                f"{len(off_target)} von {len(entries)} EnPIs verfehlen das Ziel. "
                f"Größte Abweichung: **{worst['name']}** mit {worst['current']:.2f} {worst['unit'] or ''} "
                f"(Ziel: {worst['target']:.2f})."
            )
        else:
            severity = "info"
            description = (
                f"Alle {len(entries)} EnPI(s) erreichen ihre Ziele oder es sind keine Ziele definiert. "
                f"Effizienzentwicklung ist auf Kurs."
            )

        return {
            "available": True,
            "title": "EnPI vs. Ziel/Baseline",
            "description": description,
            "metrics": {
                "enpi_count": len(entries),
                "off_target": len(off_target),
            },
            "enpis": entries,
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 6. Benchmark (VDI 3807)
    # ─────────────────────────────────────────────────────────────────

    async def _benchmark_block(self) -> dict:
        """Externer Vergleich gegen Referenzwerte (kWh/m²/a)."""
        from app.models.benchmark import BenchmarkReference

        # Bei mehreren Gebäudetypen pro Energieart: erste passende Referenz wählen
        # (nach building_type falls scope vorgibt, sonst beliebige aktive)
        refs_all = (await self.db.execute(
            select(BenchmarkReference).where(BenchmarkReference.is_active == True)  # noqa: E712
        )).scalars().all()
        refs_by_type: dict[str, Any] = {}
        for r in refs_all:
            if r.energy_type not in refs_by_type:
                refs_by_type[r.energy_type] = r
        refs = list(refs_by_type.values())
        if not refs:
            return {
                "available": False,
                "title": "Benchmark (VDI 3807)",
                "hint": "Keine Benchmark-Referenzwerte hinterlegt. Importieren Sie VDI 3807 Werte für Ihren Gebäudetyp, um externe Vergleiche zu sehen.",
                "severity": "info",
            }

        # Aktuelle Energieaufteilung (kWh)
        balance = self.snapshot.get("energy_balance") or []
        items = []
        for ref in refs:
            # Verbrauch passender Energieart
            cons = next((b for b in balance if b.get("energy_type") == ref.energy_type), None)
            if not cons:
                continue
            kwh = float(cons.get("consumption_kwh") or 0)
            # Pro Jahr normieren falls Zeitraum kürzer
            days = (self.period_end - self.period_start).days + 1
            kwh_per_year = kwh * (365.0 / max(days, 1))
            # Pro m² wenn Fläche bekannt
            area = self.snapshot.get("reference_value")
            kwh_per_m2_a = kwh_per_year / area if area else None
            if kwh_per_m2_a is None:
                continue
            items.append({
                "energy_type": ref.energy_type,
                "building_type": ref.building_type,
                "value": round(kwh_per_m2_a, 1),
                "good": float(ref.value_good or 0),
                "medium": float(ref.value_medium or 0),
                "poor": float(ref.value_poor or 0),
                "unit": ref.unit or "kWh/m²/a",
            })

        if not items:
            return {
                "available": False,
                "title": "Benchmark (VDI 3807)",
                "hint": "Bezugsgröße (m²) für Standort nicht hinterlegt — kann nicht gegen Benchmark vergleichen.",
                "severity": "info",
            }

        # Bewertung
        bad_count = sum(1 for i in items if i["value"] >= i["poor"])
        mid_count = sum(1 for i in items if i["medium"] <= i["value"] < i["poor"])
        good_count = sum(1 for i in items if i["value"] < i["medium"])

        chart_svg = render_benchmark_svg(items)

        if bad_count > 0:
            severity = "hoch"
            description = f"{bad_count} Energieart(en) im Bereich 'schlecht' gegenüber VDI 3807. Sanierungspotenzial groß."
        elif mid_count > 0:
            severity = "mittel"
            description = f"{mid_count} Energieart(en) im Bereich 'mittel' — Optimierung möglich."
        else:
            severity = "info"
            description = f"Alle {good_count} Energiearten im Bereich 'gut' gegenüber VDI 3807."

        return {
            "available": True,
            "title": "Benchmark (VDI 3807)",
            "description": description,
            "metrics": {
                "good": good_count,
                "medium": mid_count,
                "poor": bad_count,
            },
            "items": items,
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # 7. Raumklima-Korrelation
    # ─────────────────────────────────────────────────────────────────

    async def _climate_block(self) -> dict:
        """Pro Zone: Raumtemperatur/-feuchte vs. Sollwert + Außentemperatur."""
        from app.services.climate_service import ClimateService

        svc = ClimateService(self.db)
        try:
            zones = await svc.get_zone_summaries(self.period_start, self.period_end)
        except Exception:
            zones = []

        if not zones:
            return {
                "available": False,
                "title": "Raumklima-Korrelation",
                "hint": "Keine Klimasensoren (Temperatur/Feuchte) für Gebäude/Nutzungseinheiten aktiviert. Verbinden Sie Sensoren via HomeAssistant oder Modbus, um Raumklima-Daten zur Wirkungsverfolgung zu nutzen.",
                "severity": "info",
            }

        deviations = []
        for z in zones:
            avg_temp = z.get("avg_temperature")
            target_max = z.get("target_temp_max")
            target_min = z.get("target_temp_min")
            if avg_temp is None or target_max is None:
                continue
            if avg_temp > target_max:
                deviations.append({
                    "zone": z.get("zone") or z.get("name"),
                    "avg_temp": round(float(avg_temp), 1),
                    "target_max": float(target_max),
                    "type": "über Sollmax",
                })
            elif target_min is not None and avg_temp < target_min:
                deviations.append({
                    "zone": z.get("zone") or z.get("name"),
                    "avg_temp": round(float(avg_temp), 1),
                    "target_min": float(target_min),
                    "type": "unter Sollmin",
                })

        chart_svg = render_climate_overlay_svg(zones)

        if deviations:
            worst = deviations[0]
            severity = "mittel"
            description = (
                f"{len(deviations)} Zone(n) außerhalb des Sollwert-Bereichs. "
                f"Beispiel: **{worst['zone']}** durchschnittlich {worst['avg_temp']} °C ({worst['type']}). "
                f"Hinweis: Steuerung, Schaltzeiten oder Lüftung prüfen — kann Heiz-/Kühlverbrauch direkt beeinflussen."
            )
        else:
            severity = "info"
            description = (
                f"Alle {len(zones)} überwachten Zonen liegen im Sollwert-Bereich. "
                f"Wirkungsverfolgung umgesetzter Maßnahmen über Sensor-Trends möglich."
            )

        return {
            "available": True,
            "title": "Raumklima-Korrelation",
            "description": description,
            "metrics": {
                "zones": len(zones),
                "deviations": len(deviations),
            },
            "zone_data": zones,
            "deviations": deviations,
            "chart_svg": chart_svg,
            "severity": severity,
        }

    # ─────────────────────────────────────────────────────────────────
    # Summary
    # ─────────────────────────────────────────────────────────────────

    def _summary_findings(self, blocks: dict) -> list[dict]:
        """Top-5 zugespitzte Befunde aus den Blöcken extrahieren."""
        sev_order = {"hoch": 0, "mittel": 1, "info": 2}
        findings = []
        for key, b in blocks.items():
            if not isinstance(b, dict) or not b.get("available"):
                continue
            if b.get("severity") == "info":
                continue
            findings.append({
                "anchor": key,
                "title": b.get("title"),
                "description": b.get("description", "").split(".")[0] + ".",  # erster Satz
                "severity": b.get("severity"),
            })
        findings.sort(key=lambda f: sev_order.get(f["severity"], 9))
        return findings[:5]

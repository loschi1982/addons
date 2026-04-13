"""
benchmark_service.py – Externes Benchmarking (VDI 3807, GEFMA 124, BAFA).

Verwaltet editierbare Referenzwerte und vergleicht eigene EnPI-Werte
mit Branchenstandards. Seed-Daten werden beim ersten Aufruf geladen.
"""

import json
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import structlog
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.benchmark import BenchmarkReference

logger = structlog.get_logger()

SEED_FILE = Path(__file__).parent.parent.parent / "seed_data" / "benchmark_references.json"

BUILDING_TYPE_LABELS = {
    "office": "Bürogebäude",
    "school": "Schule / Bildungseinrichtung",
    "hospital": "Krankenhaus / Klinik",
    "residential": "Wohngebäude",
    "retail": "Einzelhandel / Geschäftshaus",
    "warehouse": "Lagerhalle / Logistik",
    "production": "Produktion / Industrie",
    "hotel": "Hotel / Beherbergung",
    "sports_hall": "Sporthalle / Freizeiteinrichtung",
    "data_center": "Rechenzentrum",
    "public_building": "Öffentliches Gebäude / Verwaltung",
}

ENERGY_TYPE_LABELS = {
    "electricity": "Strom",
    "natural_gas": "Erdgas",
    "district_heating": "Fernwärme",
    "district_cooling": "Fernkälte",
    "oil": "Heizöl",
    "total": "Gesamtenergie",
}


class BenchmarkService:
    """Service für externes Benchmarking."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def ensure_seeded(self) -> int:
        """Seed-Daten laden wenn Tabelle leer."""
        count = (await self.db.execute(select(func.count(BenchmarkReference.id)))).scalar() or 0
        if count > 0:
            return 0

        if not SEED_FILE.exists():
            logger.warning("benchmark_seed_missing", path=str(SEED_FILE))
            return 0

        with open(SEED_FILE, encoding="utf-8") as f:
            records = json.load(f)

        for rec in records:
            ref = BenchmarkReference(
                building_type=rec["building_type"],
                energy_type=rec["energy_type"],
                source=rec.get("source", "VDI_3807"),
                unit=rec.get("unit", "kwh_per_m2_a"),
                value_good=Decimal(str(rec["value_good"])),
                value_medium=Decimal(str(rec["value_medium"])),
                value_poor=Decimal(str(rec["value_poor"])),
                description=rec.get("description"),
                is_active=True,
            )
            self.db.add(ref)

        await self.db.commit()
        logger.info("benchmark_seeded", count=len(records))
        return len(records)

    async def list_references(
        self,
        building_type: str | None = None,
        energy_type: str | None = None,
        source: str | None = None,
        is_active: bool | None = True,
    ) -> list[BenchmarkReference]:
        """Alle Referenzwerte laden."""
        query = select(BenchmarkReference).order_by(
            BenchmarkReference.building_type,
            BenchmarkReference.energy_type,
        )
        if building_type:
            query = query.where(BenchmarkReference.building_type == building_type)
        if energy_type:
            query = query.where(BenchmarkReference.energy_type == energy_type)
        if source:
            query = query.where(BenchmarkReference.source == source)
        if is_active is not None:
            query = query.where(BenchmarkReference.is_active == is_active)
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_reference(self, ref_id: uuid.UUID) -> BenchmarkReference:
        ref = await self.db.get(BenchmarkReference, ref_id)
        if not ref:
            raise ValueError("Referenzwert nicht gefunden")
        return ref

    async def create_reference(self, data: dict) -> BenchmarkReference:
        ref = BenchmarkReference(**data)
        self.db.add(ref)
        await self.db.commit()
        await self.db.refresh(ref)
        return ref

    async def update_reference(self, ref_id: uuid.UUID, data: dict) -> BenchmarkReference:
        ref = await self.get_reference(ref_id)
        for k, v in data.items():
            if hasattr(ref, k):
                setattr(ref, k, v)
        await self.db.commit()
        await self.db.refresh(ref)
        return ref

    async def delete_reference(self, ref_id: uuid.UUID) -> None:
        ref = await self.get_reference(ref_id)
        ref.is_active = False
        await self.db.commit()

    async def compare(
        self,
        building_type: str,
        energy_type: str,
        actual_value: float,
        unit: str = "kwh_per_m2_a",
    ) -> dict:
        """
        Eigenen Wert mit Referenz vergleichen.

        Gibt Bewertung (gut/mittel/schlecht), prozentuale Abweichung
        vom Median-Referenzwert und alle verfügbaren Quellen zurück.
        """
        await self.ensure_seeded()

        refs_result = await self.db.execute(
            select(BenchmarkReference).where(
                BenchmarkReference.building_type == building_type,
                BenchmarkReference.energy_type == energy_type,
                BenchmarkReference.unit == unit,
                BenchmarkReference.is_active == True,  # noqa: E712
            )
        )
        refs = list(refs_result.scalars().all())

        if not refs:
            return {
                "building_type": building_type,
                "building_type_label": BUILDING_TYPE_LABELS.get(building_type, building_type),
                "energy_type": energy_type,
                "energy_type_label": ENERGY_TYPE_LABELS.get(energy_type, energy_type),
                "actual_value": actual_value,
                "unit": unit,
                "rating": None,
                "deviation_from_medium_pct": None,
                "references": [],
                "no_reference": True,
            }

        # Primärquelle (erste verfügbare)
        primary = refs[0]
        good = float(primary.value_good)
        medium = float(primary.value_medium)
        poor = float(primary.value_poor)

        if actual_value <= good:
            rating = "good"
        elif actual_value <= medium:
            rating = "medium"
        else:
            rating = "poor"

        deviation_pct = round((actual_value - medium) / medium * 100, 1) if medium else None

        return {
            "building_type": building_type,
            "building_type_label": BUILDING_TYPE_LABELS.get(building_type, building_type),
            "energy_type": energy_type,
            "energy_type_label": ENERGY_TYPE_LABELS.get(energy_type, energy_type),
            "actual_value": actual_value,
            "unit": unit,
            "rating": rating,
            "deviation_from_medium_pct": deviation_pct,
            "references": [
                {
                    "id": str(r.id),
                    "source": r.source,
                    "value_good": float(r.value_good),
                    "value_medium": float(r.value_medium),
                    "value_poor": float(r.value_poor),
                    "description": r.description,
                }
                for r in refs
            ],
            "no_reference": False,
        }

    async def get_overview(self, year: int | None = None) -> dict:
        """
        Übersicht: Vergleich aller Gebäude-EnPIs mit Referenzwerten.

        Nutzt die bestehende Benchmark-Logik aus AnalyticsService,
        ergänzt sie aber um DB-Referenzwerte statt Hardcode.
        """
        await self.ensure_seeded()

        # Alle aktiven DB-Referenzen als Lookup-Dict laden
        refs_result = await self.db.execute(
            select(BenchmarkReference).where(
                BenchmarkReference.is_active == True,  # noqa: E712
                BenchmarkReference.unit == "kwh_per_m2_a",
            )
        )
        ref_dict: dict[tuple, dict] = {}
        for r in refs_result.scalars().all():
            key = (r.building_type, r.energy_type)
            if key not in ref_dict:  # Erste Quelle gewinnt
                ref_dict[key] = {
                    "good": float(r.value_good),
                    "medium": float(r.value_medium),
                    "poor": float(r.value_poor),
                    "source": r.source,
                }

        # Gebäudetyp-Labels
        building_types = [
            {"key": k, "label": v}
            for k, v in BUILDING_TYPE_LABELS.items()
        ]
        sources_available = sorted({
            r.source
            for r in (await self.db.execute(select(BenchmarkReference.source))).scalars().all()
        })

        return {
            "year": year or date.today().year,
            "reference_count": len(ref_dict),
            "building_types": building_types,
            "energy_type_labels": ENERGY_TYPE_LABELS,
            "references": {
                f"{k[0]}|{k[1]}": v
                for k, v in ref_dict.items()
            },
            "sources": sources_available,
        }

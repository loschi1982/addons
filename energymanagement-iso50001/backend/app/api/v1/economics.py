"""
economics.py – Wirtschaftlichkeitsanalyse-Endpunkte.

Berechnet Amortisationszeiten, ROI und NPV für Aktionspläne
und Verbraucher mit hinterlegten Investitionskosten.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user
from app.models.user import User
from app.services.economics_service import EconomicsService

router = APIRouter()


@router.get("/amortization")
async def get_amortization_overview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Amortisationsübersicht für alle Aktionspläne und Verbraucher
    mit hinterlegten Investitionskosten.

    Energiepreis-Kaskade: Invoice → Readings → tariff_info → Fallback (0.30 €/kWh).
    """
    service = EconomicsService(db)
    items = await service.get_amortization_overview()
    return {"items": items, "count": len(items)}


@router.get("/price")
async def get_effective_price(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Effektiven kWh-Preis aus der Daten-Kaskade ermitteln (systemweit).
    Nützlich zur Anzeige des aktuell verwendeten Planpreises.
    """
    service = EconomicsService(db)
    price, source = await service.get_price_per_kwh()
    increase_rate = await service.get_price_increase_rate()
    return {
        "price_per_kwh": price,
        "price_source": source,
        "price_increase_rate_pct": round(increase_rate * 100, 1),
        "source_labels": {
            "invoice": "Aus Energieabrechnungen (letzte 12 Monate)",
            "readings": "Aus Zählerlesungen mit Kostendaten (letzte 12 Monate)",
            "tariff_info": "Aus Tarif-Planwert (Zähler-Konfiguration)",
            "fallback": "Standardwert – keine Tarifdaten vorhanden",
        },
    }

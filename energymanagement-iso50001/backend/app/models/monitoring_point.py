"""
monitoring_point.py – Betrachtungspunkte für das Energieschema.

Ein Betrachtungspunkt definiert eine Wurzel für die Energieschema-Visualisierung.
Im Gegensatz zum alten Mechanismus (`Meter.schema_label`) kann ein Punkt nicht
nur ein einzelner Zähler sein, sondern auch ein gesamter Standort, ein Gebäude
oder eine Nutzungseinheit – optional gefiltert nach einer Energieart.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.models.base import TimestampMixin, UUIDMixin


class MonitoringPoint(Base, UUIDMixin, TimestampMixin):
    """
    Betrachtungspunkt: Wurzel eines Energieschemas.

    Genau eine der vier Scope-IDs (site_id, building_id, usage_unit_id,
    meter_id) ist gesetzt. `energy_type` ist optional und filtert die
    eingeschlossenen Zähler. Bei NULL werden alle Energiearten gezeigt.
    """
    __tablename__ = "monitoring_points"

    label: Mapped[str] = mapped_column(String(255), nullable=False)

    site_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sites.id", ondelete="CASCADE"), nullable=True, index=True
    )
    building_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("buildings.id", ondelete="CASCADE"), nullable=True, index=True
    )
    usage_unit_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("usage_units.id", ondelete="CASCADE"), nullable=True, index=True
    )
    meter_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("meters.id", ondelete="CASCADE"), nullable=True, index=True
    )

    energy_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    __table_args__ = (
        CheckConstraint(
            "(CASE WHEN site_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN building_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN usage_unit_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN meter_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_monitoring_point_exactly_one_scope",
        ),
    )

    # Relationships werden im Service explizit per selectinload geladen,
    # nicht eager hier (vermeidet greenlet-Probleme bei async sessions).
    site = relationship("Site", lazy="select")
    building = relationship("Building", lazy="select")
    usage_unit = relationship("UsageUnit", lazy="select")
    meter = relationship("Meter", lazy="select")

    @property
    def scope_type(self) -> str:
        if self.meter_id is not None:
            return "meter"
        if self.usage_unit_id is not None:
            return "usage_unit"
        if self.building_id is not None:
            return "building"
        return "site"

    @property
    def scope_id(self) -> uuid.UUID:
        return self.meter_id or self.usage_unit_id or self.building_id or self.site_id  # type: ignore[return-value]

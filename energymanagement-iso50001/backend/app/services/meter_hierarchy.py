"""Zähler-Hierarchie: maßgebliche Zähler je Strang ermitteln.

Hintergrund: Eltern- und Kindzähler dürfen für Gesamtsummen NICHT gemeinsam
addiert werden (Doppelzählung). Für jede Auswertung wird je Strang der
**höchste Zähler genommen, der im Zeitraum Verbrauchsdaten hat** – andernfalls
wird in dessen Kinder abgestiegen ("pro Strang tiefste Ebene mit Daten").

So ist garantiert, dass kein gewählter Zähler Vor- oder Nachfahre eines anderen
gewählten Zählers ist → keine Doppelzählung, ohne dass leere Strukturzähler
(z. B. ein EVU-Hauptzähler ohne Ablesung im Zeitraum) ganze Stränge auf 0 setzen.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable, Protocol

from sqlalchemy import func, select

from app.models.meter import Meter
from app.models.reading import MeterReading

# Quellen, die automatisch (häufig) ablesen – relevant für Toleranzen.
AUTO_DATA_SOURCES: set[str] = {
    "modbus", "bacnet", "shelly", "knx", "homeassistant", "mqtt",
}


class _MeterNode(Protocol):
    id: uuid.UUID
    parent_meter_id: uuid.UUID | None


def select_authoritative_ids(
    meters: Iterable[_MeterNode],
    ids_with_data: set[uuid.UUID],
) -> set[uuid.UUID]:
    """Maßgebliche Zähler-IDs aus einer Kandidatenmenge bestimmen (rein, ohne DB).

    Args:
        meters: Kandidaten-Zähler (bereits gefiltert, z. B. aktiv, nicht
            Einspeisung, nicht virtuelle Quelle). Nur ``id`` und
            ``parent_meter_id`` werden benötigt.
        ids_with_data: IDs der Zähler, die im Zeitraum Verbrauch > 0 haben.

    Returns:
        Teilmenge der Kandidaten, in der kein Element Vor-/Nachfahre eines
        anderen ist (pro Strang tiefste Ebene mit Daten).
    """
    meter_list = list(meters)
    by_id: dict[uuid.UUID, _MeterNode] = {m.id: m for m in meter_list}
    children_by_parent: dict[uuid.UUID | None, list[_MeterNode]] = defaultdict(list)
    for m in meter_list:
        children_by_parent[m.parent_meter_id].append(m)

    result: set[uuid.UUID] = set()

    def walk(node: _MeterNode) -> None:
        if node.id in ids_with_data:
            # Knoten hat eigene Daten → maßgeblich, NICHT weiter absteigen.
            result.add(node.id)
            return
        # Keine eigenen Daten → in Kinder absteigen (Blatt ohne Daten = nichts).
        for child in children_by_parent.get(node.id, []):
            walk(child)

    # Wurzeln der Kandidatenmenge: parent fehlt oder liegt außerhalb der Kandidaten
    # (z. B. weil der Elternzähler Einspeisung/virtuell ist).
    for m in meter_list:
        if m.parent_meter_id is None or m.parent_meter_id not in by_id:
            walk(m)

    return result


async def meter_ids_with_data(
    db,
    period_start: date,
    period_end: date,
    candidate_ids: Iterable[uuid.UUID] | None = None,
) -> set[uuid.UUID]:
    """IDs aller Zähler mit Verbrauch > 0 im Zeitraum (optional auf Kandidaten begrenzt)."""
    ts_start = datetime.combine(period_start, time.min, tzinfo=timezone.utc)
    ts_end = datetime.combine(period_end + timedelta(days=1), time.min, tzinfo=timezone.utc)
    q = (
        select(MeterReading.meter_id)
        .where(
            MeterReading.consumption.isnot(None),
            MeterReading.timestamp >= ts_start,
            MeterReading.timestamp < ts_end,
        )
        .group_by(MeterReading.meter_id)
        .having(func.sum(MeterReading.consumption) > 0)
    )
    cand = list(candidate_ids) if candidate_ids is not None else None
    if cand is not None:
        if not cand:
            return set()
        q = q.where(MeterReading.meter_id.in_(cand))
    rows = (await db.execute(q)).all()
    return {r[0] for r in rows}


async def resolve_authoritative_meter_ids(
    db,
    period_start: date,
    period_end: date,
    *,
    site_id: uuid.UUID | None = None,
    energy_type: str | None = None,
    exclude_feed_in: bool = True,
    candidate_ids: Iterable[uuid.UUID] | None = None,
) -> set[uuid.UUID]:
    """Maßgebliche Zähler-IDs für eine Auswertung (DB-gestützt).

    Lädt aktive, physische (nicht-virtuelle) Zähler – optional auf Site/Energieart/
    Kandidaten begrenzt –, ermittelt welche im Zeitraum Daten haben und wählt je
    Strang die tiefste Ebene mit Daten.
    """
    q = select(Meter.id, Meter.parent_meter_id).where(
        Meter.is_active == True,  # noqa: E712
        Meter.is_virtual == False,  # noqa: E712
    )
    if exclude_feed_in:
        q = q.where(Meter.is_feed_in != True)  # noqa: E712
    if site_id is not None:
        q = q.where(Meter.site_id == site_id)
    if energy_type is not None:
        q = q.where(Meter.energy_type == energy_type)
    if candidate_ids is not None:
        cand = list(candidate_ids)
        if not cand:
            return set()
        q = q.where(Meter.id.in_(cand))

    rows = (await db.execute(q)).all()
    if not rows:
        return set()

    class _N:
        __slots__ = ("id", "parent_meter_id")

        def __init__(self, mid, pid):
            self.id = mid
            self.parent_meter_id = pid

    nodes = [_N(r.id, r.parent_meter_id) for r in rows]
    all_ids = {n.id for n in nodes}
    has_data = await meter_ids_with_data(db, period_start, period_end, all_ids)
    return select_authoritative_ids(nodes, has_data)

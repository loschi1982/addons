"""
snapshot_periods.py – Standard-Periodendefinitionen für vorberechnete Snapshots.

Statt Dashboard- und Analytics-Daten bei jedem Seitenaufruf live aus der
Datenbank zu aggregieren, werden für eine feste Menge an Standardzeiträumen
Snapshots per Celery Beat vorberechnet und in den entsprechenden
`*_snapshots`-Tabellen abgelegt. Dieses Modul definiert genau diese
Periodenmenge zentral.

Für frei gewählte Zeiträume (Custom-Date-Picker) wird weiterhin live
berechnet (60s In-Memory-Cache greift dann als zweite Stufe).
"""

from datetime import date

# Period-Keys, die von den Beat-Tasks befüllt werden
PERIOD_KEYS: tuple[str, ...] = (
    "current_ytd",       # 1. Januar – heute
    "current_month",     # 1. dieses Monats – heute
    "last_month",        # Vormonat komplett
    "last_year",         # Vorjahr komplett
    "year_before",       # Vor-Vorjahr komplett
)

# Gängige Granularitäten für Dashboard-Snapshots
GRANULARITIES: tuple[str, ...] = ("daily", "weekly", "monthly", "yearly")


def resolve_period(key: str, today: date | None = None) -> tuple[date, date]:
    """Liefert (start, end) für den Period-Key, bezogen auf heute.

    Erlaubte Keys siehe PERIOD_KEYS.
    """
    today = today or date.today()
    if key == "current_ytd":
        return date(today.year, 1, 1), today
    if key == "current_month":
        return date(today.year, today.month, 1), today
    if key == "last_month":
        if today.month == 1:
            year, month = today.year - 1, 12
        else:
            year, month = today.year, today.month - 1
        start = date(year, month, 1)
        # Letzter Tag des Vormonats = Tag vor dem 1. des aktuellen Monats
        first_of_current = date(today.year, today.month, 1)
        end = date(start.year, start.month, (first_of_current - start).days)
        return start, end
    if key == "last_year":
        year = today.year - 1
        return date(year, 1, 1), date(year, 12, 31)
    if key == "year_before":
        year = today.year - 2
        return date(year, 1, 1), date(year, 12, 31)
    raise ValueError(f"Unbekannter Period-Key: {key}")


def match_period_key(start: date, end: date, today: date | None = None) -> str | None:
    """Versucht, einen gegebenen Zeitraum auf einen Standard-Period-Key zu mappen.

    Liefert None, wenn der Zeitraum keinem Standard entspricht
    (→ Snapshot kann nicht verwendet werden, Live-Berechnung nötig).
    """
    today = today or date.today()
    for key in PERIOD_KEYS:
        ps, pe = resolve_period(key, today)
        if ps == start and pe == end:
            return key
    return None

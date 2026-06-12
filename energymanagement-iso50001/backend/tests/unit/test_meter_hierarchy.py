"""
test_meter_hierarchy.py – Tests für die maßgebliche Zähler-Auswahl je Strang.

Sichert die Kern-Logik gegen Eltern/Kind-Doppelzählung ab:
je Strang wird die tiefste Ebene mit Daten gewählt.
"""

import uuid

from app.services.meter_hierarchy import select_authoritative_ids


class _N:
    """Minimaler Zähler-Stub mit id + parent_meter_id."""

    __slots__ = ("id", "parent_meter_id")

    def __init__(self, mid, pid=None):
        self.id = mid
        self.parent_meter_id = pid


def _ids(n):
    return [uuid.uuid4() for _ in range(n)]


def test_parent_with_data_excludes_children():
    """Eltern hat Daten → Eltern maßgeblich, Kinder NICHT mitzählen."""
    p, c1, c2 = _ids(3)
    meters = [_N(p), _N(c1, p), _N(c2, p)]
    auth = select_authoritative_ids(meters, {p, c1, c2})
    assert auth == {p}


def test_empty_parent_falls_through_to_children():
    """Eltern ohne Daten → in Kinder mit Daten absteigen."""
    p, c1, c2 = _ids(3)
    meters = [_N(p), _N(c1, p), _N(c2, p)]
    auth = select_authoritative_ids(meters, {c1, c2})
    assert auth == {c1, c2}


def test_nested_topmost_with_data_wins():
    """Großeltern mit Daten → Kind/Enkel ausgeschlossen (kein Doppelzählen)."""
    gp, p, c = _ids(3)
    meters = [_N(gp), _N(p, gp), _N(c, p)]
    auth = select_authoritative_ids(meters, {gp, p, c})
    assert auth == {gp}


def test_empty_branch_descends_two_levels():
    """Großeltern+Eltern ohne Daten → bis zum Enkel mit Daten absteigen."""
    gp, p, c = _ids(3)
    meters = [_N(gp), _N(p, gp), _N(c, p)]
    auth = select_authoritative_ids(meters, {c})
    assert auth == {c}


def test_leaf_without_data_contributes_nothing():
    p, c1, c2 = _ids(3)
    meters = [_N(p), _N(c1, p), _N(c2, p)]
    # Eltern ohne Daten, nur ein Kind mit Daten
    auth = select_authoritative_ids(meters, {c1})
    assert auth == {c1}


def test_parent_outside_candidate_set_treats_child_as_root():
    """Elternzähler nicht in Kandidaten (z. B. Einspeisung) → Kind ist Wurzel."""
    missing_parent = uuid.uuid4()
    c = uuid.uuid4()
    meters = [_N(c, missing_parent)]  # parent nicht in der Menge
    auth = select_authoritative_ids(meters, {c})
    assert auth == {c}


def test_no_double_count_across_siblings_and_levels():
    """Gemischt: ein Strang Eltern-maßgeblich, ein Strang Kinder-maßgeblich."""
    p1, p1c = _ids(2)          # p1 hat Daten → p1
    p2, p2c1, p2c2 = _ids(3)   # p2 ohne Daten → p2c1, p2c2
    meters = [_N(p1), _N(p1c, p1), _N(p2), _N(p2c1, p2), _N(p2c2, p2)]
    auth = select_authoritative_ids(meters, {p1, p2c1, p2c2})
    assert auth == {p1, p2c1, p2c2}
    # p1 und p1c nie gemeinsam; p2 nie mit seinen Kindern
    assert p1c not in auth
    assert p2 not in auth

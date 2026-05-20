"""Tests für app.services.snapshot_periods."""

from datetime import date

import pytest

from app.services.snapshot_periods import (
    GRANULARITIES,
    PERIOD_KEYS,
    match_period_key,
    resolve_period,
)


def test_period_keys_complete():
    assert set(PERIOD_KEYS) == {
        "current_ytd", "current_month", "last_month", "last_year", "year_before",
    }


def test_granularities_complete():
    assert set(GRANULARITIES) == {"daily", "weekly", "monthly", "yearly"}


def test_resolve_current_ytd():
    today = date(2026, 5, 20)
    start, end = resolve_period("current_ytd", today)
    assert start == date(2026, 1, 1)
    assert end == today


def test_resolve_current_month():
    today = date(2026, 5, 20)
    start, end = resolve_period("current_month", today)
    assert start == date(2026, 5, 1)
    assert end == today


def test_resolve_last_month_simple():
    today = date(2026, 5, 20)
    start, end = resolve_period("last_month", today)
    assert start == date(2026, 4, 1)
    assert end == date(2026, 4, 30)


def test_resolve_last_month_january_rolls_back_year():
    today = date(2026, 1, 15)
    start, end = resolve_period("last_month", today)
    assert start == date(2025, 12, 1)
    assert end == date(2025, 12, 31)


def test_resolve_last_year():
    today = date(2026, 5, 20)
    start, end = resolve_period("last_year", today)
    assert start == date(2025, 1, 1)
    assert end == date(2025, 12, 31)


def test_resolve_year_before():
    today = date(2026, 5, 20)
    start, end = resolve_period("year_before", today)
    assert start == date(2024, 1, 1)
    assert end == date(2024, 12, 31)


def test_resolve_unknown_key():
    with pytest.raises(ValueError):
        resolve_period("nicht_existent")


def test_match_period_key_roundtrip():
    today = date(2026, 5, 20)
    for key in PERIOD_KEYS:
        start, end = resolve_period(key, today)
        assert match_period_key(start, end, today) == key


def test_match_period_key_custom_returns_none():
    today = date(2026, 5, 20)
    # Beliebiger Custom-Zeitraum
    assert match_period_key(date(2026, 3, 15), date(2026, 4, 22), today) is None

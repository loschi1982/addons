"""Performance-Indexes: meter_readings und meters

Revision ID: 2024_01_16_001
Revises: 2024_01_15_001
Create Date: 2024-01-16 00:00:00.000000

Behebt fehlende Composite- und Partial-Indexes, die zu langsamen
Dashboard-, Analytics- und Zeitreihen-Abfragen führen.
"""

from alembic import op

# revision identifiers
revision = "2024_01_16_001"
down_revision = "2024_01_15_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── meter_readings: Composite-Index (meter_id, timestamp DESC) ──────────
    # Dieser Index wird bei fast jeder Verbrauchsabfrage genutzt:
    #   WHERE meter_id = ? AND timestamp BETWEEN ? AND ?
    # Ohne diesen Index muss PostgreSQL den gesamten Index für meter_id
    # scannen und dann nach timestamp filtern.
    op.create_index(
        "ix_meter_readings_meter_timestamp",
        "meter_readings",
        ["meter_id", "timestamp"],
        postgresql_ops={"timestamp": "DESC"},
    )

    # ── meter_readings: consumption-Index für Aggregationen ─────────────────
    # Nicht-Null-Werte für SUM/AVG-Abfragen auf consumption
    op.create_index(
        "ix_meter_readings_consumption",
        "meter_readings",
        ["consumption"],
        postgresql_where="consumption IS NOT NULL AND consumption > 0",
    )

    # ── meters: Partial-Index für aktive Hauptzähler ─────────────────────────
    # Pattern: WHERE is_active = true AND is_feed_in != true AND parent_meter_id IS NULL
    # Wird in allen Services als Standard-Filter verwendet.
    op.create_index(
        "ix_meters_active_main",
        "meters",
        ["id"],
        postgresql_where="is_active = true AND (is_feed_in = false OR is_feed_in IS NULL) AND parent_meter_id IS NULL",
    )

    # ── meters: Partial-Index für aktive Zähler nach energy_type ────────────
    # Pattern: WHERE is_active = true AND energy_type = ?
    op.create_index(
        "ix_meters_active_energy_type",
        "meters",
        ["energy_type"],
        postgresql_where="is_active = true",
    )

    # ── meters: Index auf parent_meter_id ────────────────────────────────────
    # Für Unter-Zähler-Abfragen (Hierarchie)
    op.create_index(
        "ix_meters_parent_meter_id",
        "meters",
        ["parent_meter_id"],
        postgresql_where="parent_meter_id IS NOT NULL",
    )

    # ── meters: Index auf usage_unit_id ──────────────────────────────────────
    op.create_index(
        "ix_meters_usage_unit_id",
        "meters",
        ["usage_unit_id"],
        postgresql_where="usage_unit_id IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_index("ix_meters_usage_unit_id", table_name="meters")
    op.drop_index("ix_meters_parent_meter_id", table_name="meters")
    op.drop_index("ix_meters_active_energy_type", table_name="meters")
    op.drop_index("ix_meters_active_main", table_name="meters")
    op.drop_index("ix_meter_readings_consumption", table_name="meter_readings")
    op.drop_index("ix_meter_readings_meter_timestamp", table_name="meter_readings")

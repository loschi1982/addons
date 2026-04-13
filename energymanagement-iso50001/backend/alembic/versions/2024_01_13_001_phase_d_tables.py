"""Phase D: benchmark_references, training_records, control_strategies.

Revision ID: 2024_01_13_001
Revises: 2024_01_12_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_13_001"
down_revision = "2024_01_12_001"


def upgrade() -> None:
    bind = op.get_bind()
    tables = inspect(bind).get_table_names()

    # ── benchmark_references ─────────────────────────────────────────────────
    if "benchmark_references" not in tables:
        op.create_table(
            "benchmark_references",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("building_type", sa.String(100), nullable=False),
            sa.Column("energy_type", sa.String(50), nullable=False),
            sa.Column("source", sa.String(50), nullable=False, server_default="VDI_3807"),
            sa.Column("unit", sa.String(30), nullable=False, server_default="kwh_per_m2_a"),
            sa.Column("value_good", sa.Numeric(10, 2), nullable=False),
            sa.Column("value_medium", sa.Numeric(10, 2), nullable=False),
            sa.Column("value_poor", sa.Numeric(10, 2), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_benchmark_ref_type", "benchmark_references", ["building_type", "energy_type"])

    # ── training_records ─────────────────────────────────────────────────────
    if "training_records" not in tables:
        op.create_table(
            "training_records",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("title", sa.String(500), nullable=False),
            sa.Column("training_type", sa.String(50), nullable=False, server_default="internal"),
            sa.Column("iso_clause", sa.String(20), nullable=True),
            sa.Column("topic", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("training_date", sa.Date(), nullable=False),
            sa.Column("duration_hours", sa.Numeric(5, 1), nullable=True),
            sa.Column("location", sa.String(255), nullable=True),
            sa.Column("trainer", sa.String(255), nullable=False),
            sa.Column("external_provider", sa.String(255), nullable=True),
            sa.Column("participants", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("participant_count", sa.Integer(), nullable=True),
            sa.Column("materials_path", sa.String(500), nullable=True),
            sa.Column("certificate_path", sa.String(500), nullable=True),
            sa.Column("attendance_list_path", sa.String(500), nullable=True),
            sa.Column("status", sa.String(50), nullable=False, server_default="completed"),
            sa.Column("effectiveness_check", sa.Text(), nullable=True),
            sa.Column("effectiveness_date", sa.Date(), nullable=True),
            sa.Column("effectiveness_result", sa.String(50), nullable=True),
            sa.Column("next_training_date", sa.Date(), nullable=True),
            sa.Column("recurrence_months", sa.Integer(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_training_records_date", "training_records", ["training_date"])
        op.create_index("ix_training_records_status", "training_records", ["status"])

    # ── control_strategies ───────────────────────────────────────────────────
    if "control_strategies" not in tables:
        op.create_table(
            "control_strategies",
            sa.Column("id", sa.UUID(), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("strategy_type", sa.String(50), nullable=False, server_default="heating"),
            sa.Column("building_id", sa.UUID(), nullable=True),
            sa.Column("usage_unit_id", sa.UUID(), nullable=True),
            sa.Column("ha_entity_id", sa.String(255), nullable=True),
            sa.Column("setpoint_heating", sa.Numeric(5, 1), nullable=True),
            sa.Column("setpoint_cooling", sa.Numeric(5, 1), nullable=True),
            sa.Column("setpoint_night_reduction", sa.Numeric(5, 1), nullable=True),
            sa.Column("max_co2_ppm", sa.Numeric(7, 1), nullable=True),
            sa.Column("operating_days", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("operating_time_start", sa.Time(), nullable=True),
            sa.Column("operating_time_end", sa.Time(), nullable=True),
            sa.Column("valid_from", sa.Date(), nullable=True),
            sa.Column("valid_until", sa.Date(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(["building_id"], ["buildings.id"]),
            sa.ForeignKeyConstraint(["usage_unit_id"], ["usage_units.id"]),
        )
        op.create_index("ix_control_strategies_active", "control_strategies", ["is_active"])


def downgrade() -> None:
    op.drop_table("control_strategies")
    op.drop_table("training_records")
    op.drop_index("ix_benchmark_ref_type", "benchmark_references")
    op.drop_table("benchmark_references")

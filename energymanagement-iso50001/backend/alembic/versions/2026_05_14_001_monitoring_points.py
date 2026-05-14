"""Betrachtungspunkte (monitoring_points) – Energieschema auf beliebiger Hierarchie-Ebene

Revision ID: 2026_05_14_001
Revises: 2024_01_17_001
Create Date: 2026-05-14 00:00:00.000000

Neue Tabelle für Betrachtungspunkte des Energieschemas. Ein Punkt kann
einen einzelnen Zähler ODER einen ganzen Standort/Gebäude/Nutzungseinheit
referenzieren, optional gefiltert nach Energieart. Damit lassen sich
Energieflüsse auf jeder Hierarchie-Ebene visualisieren.
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "2026_05_14_001"
down_revision = "2024_01_17_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "monitoring_points",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column(
            "site_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "building_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("buildings.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "usage_unit_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("usage_units.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column(
            "meter_id", sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("meters.id", ondelete="CASCADE"), nullable=True,
        ),
        sa.Column("energy_type", sa.String(50), nullable=True),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True),
            server_default=sa.func.now(), nullable=False,
        ),
        sa.CheckConstraint(
            "(CASE WHEN site_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN building_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN usage_unit_id IS NOT NULL THEN 1 ELSE 0 END + "
            " CASE WHEN meter_id IS NOT NULL THEN 1 ELSE 0 END) = 1",
            name="ck_monitoring_point_exactly_one_scope",
        ),
    )
    op.create_index("ix_monitoring_points_site_id", "monitoring_points", ["site_id"])
    op.create_index("ix_monitoring_points_building_id", "monitoring_points", ["building_id"])
    op.create_index("ix_monitoring_points_usage_unit_id", "monitoring_points", ["usage_unit_id"])
    op.create_index("ix_monitoring_points_meter_id", "monitoring_points", ["meter_id"])


def downgrade() -> None:
    op.drop_table("monitoring_points")

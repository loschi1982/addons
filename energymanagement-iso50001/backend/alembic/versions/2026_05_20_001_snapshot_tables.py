"""Snapshot-Tabellen für vorberechnete Dashboard/Analytics/Datenqualität/Tarife

Revision ID: 2026_05_20_001
Revises: 2026_05_15_001
Create Date: 2026-05-20 00:00:00.000000

Vier neue Tabellen für vorberechnete Auswertungen, die per Celery Beat
periodisch befüllt werden. Services lesen primär aus diesen Tabellen
und fallen nur bei Custom-Zeiträumen auf Live-Berechnung zurück.
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "2026_05_20_001"
down_revision = "2026_05_15_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("period_key", sa.String(32), nullable=False),
        sa.Column("granularity", sa.String(16), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("site_id", "period_key", "granularity",
                            name="uq_dashboard_snapshot"),
    )
    op.create_index("ix_dashboard_snapshots_site_id", "dashboard_snapshots", ["site_id"])
    op.create_index("ix_dashboard_snapshots_period_key", "dashboard_snapshots", ["period_key"])

    op.create_table(
        "data_quality_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("site_id", name="uq_data_quality_snapshot"),
    )
    op.create_index("ix_data_quality_snapshots_site_id", "data_quality_snapshots", ["site_id"])

    op.create_table(
        "analytics_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("period_key", sa.String(32), nullable=False),
        sa.Column("kind", sa.String(32), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("site_id", "period_key", "kind",
                            name="uq_analytics_snapshot"),
    )
    op.create_index("ix_analytics_snapshots_site_id", "analytics_snapshots", ["site_id"])
    op.create_index("ix_analytics_snapshots_period_key", "analytics_snapshots", ["period_key"])
    op.create_index("ix_analytics_snapshots_kind", "analytics_snapshots", ["kind"])

    op.create_table(
        "tariff_aggregate_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", UUID(as_uuid=True),
                  sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=True),
        sa.Column("period_key", sa.String(32), nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("site_id", "period_key",
                            name="uq_tariff_aggregate_snapshot"),
    )
    op.create_index("ix_tariff_aggregate_snapshots_site_id", "tariff_aggregate_snapshots", ["site_id"])
    op.create_index("ix_tariff_aggregate_snapshots_period_key", "tariff_aggregate_snapshots", ["period_key"])


def downgrade() -> None:
    op.drop_index("ix_tariff_aggregate_snapshots_period_key", "tariff_aggregate_snapshots")
    op.drop_index("ix_tariff_aggregate_snapshots_site_id", "tariff_aggregate_snapshots")
    op.drop_table("tariff_aggregate_snapshots")

    op.drop_index("ix_analytics_snapshots_kind", "analytics_snapshots")
    op.drop_index("ix_analytics_snapshots_period_key", "analytics_snapshots")
    op.drop_index("ix_analytics_snapshots_site_id", "analytics_snapshots")
    op.drop_table("analytics_snapshots")

    op.drop_index("ix_data_quality_snapshots_site_id", "data_quality_snapshots")
    op.drop_table("data_quality_snapshots")

    op.drop_index("ix_dashboard_snapshots_period_key", "dashboard_snapshots")
    op.drop_index("ix_dashboard_snapshots_site_id", "dashboard_snapshots")
    op.drop_table("dashboard_snapshots")

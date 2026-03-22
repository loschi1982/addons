"""Virtuelle Zähler und Einspeise-Kennzeichnung.

Erweitert die meters-Tabelle um is_submeter, is_virtual, is_feed_in
und virtual_config (JSON-Formel für berechnete Zähler).

Revision ID: 003_meter_virtual
Revises: 002_meter_hierarchy
Create Date: 2026-03-23
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = "003_meter_virtual"
down_revision = "002_meter_hierarchy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meters", sa.Column("is_submeter", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("meters", sa.Column("is_virtual", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("meters", sa.Column("is_feed_in", sa.Boolean(), server_default="false", nullable=False))
    op.add_column("meters", sa.Column("virtual_config", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("meters", "virtual_config")
    op.drop_column("meters", "is_feed_in")
    op.drop_column("meters", "is_virtual")
    op.drop_column("meters", "is_submeter")

"""Kosten-Felder für Zählerstände (Brutto, MwSt, Netto)

Revision ID: a5d001_costs
Revises: a4d001_delivery
Create Date: 2024-01-05 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "a5d001_costs"
down_revision = "a4d001_delivery"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meter_readings", sa.Column("cost_gross", sa.Numeric(12, 2), nullable=True))
    op.add_column("meter_readings", sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True))
    op.add_column("meter_readings", sa.Column("cost_net", sa.Numeric(12, 2), nullable=True))


def downgrade() -> None:
    op.drop_column("meter_readings", "cost_net")
    op.drop_column("meter_readings", "vat_rate")
    op.drop_column("meter_readings", "cost_gross")

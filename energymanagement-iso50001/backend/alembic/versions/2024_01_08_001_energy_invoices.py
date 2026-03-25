"""Energieabrechnungen: Tabelle energy_invoices

Revision ID: a8d001_invoices
Revises: a7d001_schema_label
Create Date: 2024-01-08
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects.postgresql import UUID

revision = "a8d001_invoices"
down_revision = "a7d001_schema_label"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "energy_invoices" in insp.get_table_names():
        return

    op.create_table(
        "energy_invoices",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id", ondelete="CASCADE"), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("total_cost_gross", sa.Numeric(12, 2), nullable=False),
        sa.Column("total_cost_net", sa.Numeric(12, 2), nullable=True),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("base_fee", sa.Numeric(10, 2), nullable=True),
        sa.Column("total_consumption", sa.Numeric(12, 2), nullable=True),
        sa.Column("invoice_number", sa.String(100), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_energy_invoices_meter_id", "energy_invoices", ["meter_id"])
    op.create_index("ix_energy_invoices_period", "energy_invoices", ["meter_id", "period_start", "period_end"])


def downgrade() -> None:
    op.drop_index("ix_energy_invoices_period")
    op.drop_index("ix_energy_invoices_meter_id")
    op.drop_table("energy_invoices")

"""Energielieferverträge (energy_contracts Tabelle).

Revision ID: 2024_01_12_001
Revises: 2024_01_11_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_12_001"
down_revision = "2024_01_11_001"


def upgrade() -> None:
    bind = op.get_bind()
    tables = inspect(bind).get_table_names()
    if "energy_contracts" in tables:
        return  # Idempotent

    op.create_table(
        "energy_contracts",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("contract_number", sa.String(100), nullable=True),
        sa.Column("supplier", sa.String(255), nullable=False),
        sa.Column("energy_type", sa.String(50), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("notice_period_days", sa.Numeric(6, 0), nullable=True),
        sa.Column("auto_renewal", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("contracted_annual_kwh", sa.Numeric(16, 2), nullable=True),
        sa.Column("contracted_annual_m3", sa.Numeric(16, 4), nullable=True),
        sa.Column("price_per_kwh", sa.Numeric(10, 6), nullable=True),
        sa.Column("price_per_m3", sa.Numeric(10, 6), nullable=True),
        sa.Column("base_fee_monthly", sa.Numeric(10, 2), nullable=True),
        sa.Column("peak_demand_fee", sa.Numeric(10, 4), nullable=True),
        sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True),
        sa.Column("max_demand_kw", sa.Numeric(10, 2), nullable=True),
        sa.Column("voltage_level", sa.String(50), nullable=True),
        sa.Column("renewable_share_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("co2_g_per_kwh", sa.Numeric(10, 4), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("document_path", sa.String(500), nullable=True),
        sa.Column("additional_data", sa.JSON(), nullable=True),
        sa.Column("meter_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_energy_contracts_energy_type", "energy_contracts", ["energy_type"])
    op.create_index("ix_energy_contracts_is_active", "energy_contracts", ["is_active"])


def downgrade() -> None:
    op.drop_index("ix_energy_contracts_is_active", "energy_contracts")
    op.drop_index("ix_energy_contracts_energy_type", "energy_contracts")
    op.drop_table("energy_contracts")

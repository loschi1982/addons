"""Fernwärmeversorger-Tabelle + district_cooling-Faktoren entfernen

Revision ID: 2024_01_17_001
Revises: 2024_01_16_001
Create Date: 2024-01-17 00:00:00.000000

Neue Tabelle für deutsche Fernwärmeversorger mit FW-309-zertifizierten
CO₂-Emissionsfaktoren und Primärenergiefaktoren.
Entfernt falsche district_cooling Emissionsfaktoren (kein CO₂ berechenbar).
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers
revision = "2024_01_17_001"
down_revision = "2024_01_16_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "district_heating_providers",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("city", sa.String(255), nullable=False),
        sa.Column("state", sa.String(100), nullable=True),
        sa.Column("co2_g_per_kwh", sa.Numeric(10, 2), nullable=False),
        sa.Column("primary_energy_factor", sa.Numeric(5, 3), nullable=True),
        sa.Column("certification_year", sa.Integer, nullable=False),
        sa.Column("renewable_share_pct", sa.Numeric(5, 1), nullable=True),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
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
    )

    # district_cooling Emissionsfaktoren entfernen (kein CO₂ berechenbar)
    op.execute("DELETE FROM emission_factors WHERE energy_type = 'district_cooling'")


def downgrade() -> None:
    op.drop_table("district_heating_providers")

"""Zähler-Flag: is_delivery_based für Lieferungserfassung (Pellets, Heizöl etc.)

Revision ID: a4d001_delivery
Revises: a3d001_virtual
Create Date: 2024-01-04 00:00:00.000000
"""

from alembic import op
import sqlalchemy as sa

revision = "a4d001_delivery"
down_revision = "003_meter_virtual"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meters",
        sa.Column("is_delivery_based", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )


def downgrade() -> None:
    op.drop_column("meters", "is_delivery_based")

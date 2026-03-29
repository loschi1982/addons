"""Verbraucher-Lebenszyklus: Gerätedaten + Inbetriebnahme/Außerbetriebnahme.

Revision ID: 2024_01_09_001
Revises: 2024_01_08_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_09_001"
down_revision = "2024_01_08_001"


def upgrade() -> None:
    bind = op.get_bind()
    columns = [c["name"] for c in inspect(bind).get_columns("consumers")]

    if "manufacturer" not in columns:
        op.add_column("consumers", sa.Column("manufacturer", sa.String(255), nullable=True))
    if "model" not in columns:
        op.add_column("consumers", sa.Column("model", sa.String(255), nullable=True))
    if "serial_number" not in columns:
        op.add_column("consumers", sa.Column("serial_number", sa.String(255), nullable=True))
    if "commissioned_at" not in columns:
        op.add_column("consumers", sa.Column("commissioned_at", sa.Date, nullable=True))
    if "decommissioned_at" not in columns:
        op.add_column("consumers", sa.Column("decommissioned_at", sa.Date, nullable=True))
    if "replaced_by_id" not in columns:
        op.add_column(
            "consumers",
            sa.Column("replaced_by_id", sa.Uuid, sa.ForeignKey("consumers.id"), nullable=True),
        )


def downgrade() -> None:
    op.drop_column("consumers", "replaced_by_id")
    op.drop_column("consumers", "decommissioned_at")
    op.drop_column("consumers", "commissioned_at")
    op.drop_column("consumers", "serial_number")
    op.drop_column("consumers", "model")
    op.drop_column("consumers", "manufacturer")

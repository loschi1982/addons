"""Meter: display_name, serial_number, installation_date, removal_date, calibration_date.

Revision ID: 2024_01_14_001
Revises: 2024_01_13_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_14_001"
down_revision = "2024_01_13_001"


def upgrade() -> None:
    bind = op.get_bind()
    cols = {c["name"] for c in inspect(bind).get_columns("meters")}

    if "display_name" not in cols:
        op.add_column("meters", sa.Column("display_name", sa.String(255), nullable=True))
    if "serial_number" not in cols:
        op.add_column("meters", sa.Column("serial_number", sa.String(100), nullable=True))
    if "installation_date" not in cols:
        op.add_column("meters", sa.Column("installation_date", sa.Date(), nullable=True))
    if "removal_date" not in cols:
        op.add_column("meters", sa.Column("removal_date", sa.Date(), nullable=True))
    if "calibration_date" not in cols:
        op.add_column("meters", sa.Column("calibration_date", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("meters", "calibration_date")
    op.drop_column("meters", "removal_date")
    op.drop_column("meters", "installation_date")
    op.drop_column("meters", "serial_number")
    op.drop_column("meters", "display_name")

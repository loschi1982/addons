"""Meter: schema_label für Betrachtungspunkte im Energieschema

Revision ID: a7d001_schema_label
Revises: a6d001_energy_review
Create Date: 2024-01-07
"""

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa

revision = "a7d001_schema_label"
down_revision = "a6d001_energy_review"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = [c["name"] for c in inspect(bind).get_columns("meters")]
    if "schema_label" not in columns:
        op.add_column("meters", sa.Column("schema_label", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("meters", "schema_label")

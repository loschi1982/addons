"""Consumer: Wirtschaftlichkeitsfelder (Anschaffungskosten, Amortisation).

Revision ID: 2024_01_11_001
Revises: 2024_01_10_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_11_001"
down_revision = "2024_01_10_001"


def upgrade() -> None:
    bind = op.get_bind()
    columns = [c["name"] for c in inspect(bind).get_columns("consumers")]
    if "purchase_cost" not in columns:
        op.add_column("consumers", sa.Column("purchase_cost", sa.Numeric(12, 2), nullable=True))
    if "installation_cost" not in columns:
        op.add_column("consumers", sa.Column("installation_cost", sa.Numeric(12, 2), nullable=True))
    if "annual_maintenance_cost" not in columns:
        op.add_column("consumers", sa.Column("annual_maintenance_cost", sa.Numeric(10, 2), nullable=True))
    if "expected_lifetime_years" not in columns:
        op.add_column("consumers", sa.Column("expected_lifetime_years", sa.Integer, nullable=True))


def downgrade() -> None:
    op.drop_column("consumers", "expected_lifetime_years")
    op.drop_column("consumers", "annual_maintenance_cost")
    op.drop_column("consumers", "installation_cost")
    op.drop_column("consumers", "purchase_cost")

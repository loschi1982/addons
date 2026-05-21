"""Feld spie_import_excluded an meters-Tabelle hinzufügen

Revision ID: 2026_05_21_001
Revises: 2026_05_20_001
Create Date: 2026-05-21 00:00:00.000000

Ermöglicht das Ausschließen einzelner Zähler vom automatischen SPIE-Import.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_05_21_001"
down_revision = "2026_05_20_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "meters",
        sa.Column(
            "spie_import_excluded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.create_index("ix_meters_spie_import_excluded", "meters", ["spie_import_excluded"])


def downgrade() -> None:
    op.drop_index("ix_meters_spie_import_excluded", table_name="meters")
    op.drop_column("meters", "spie_import_excluded")

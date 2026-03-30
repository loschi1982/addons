"""Import-Batch: Dateiinhalt speichern für verzögertes Processing.

Revision ID: 2024_01_10_001
Revises: 2024_01_09_001
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "2024_01_10_001"
down_revision = "2024_01_09_001"


def upgrade() -> None:
    bind = op.get_bind()
    columns = [c["name"] for c in inspect(bind).get_columns("import_batches")]
    if "file_content" not in columns:
        op.add_column("import_batches", sa.Column("file_content", sa.LargeBinary, nullable=True))


def downgrade() -> None:
    op.drop_column("import_batches", "file_content")

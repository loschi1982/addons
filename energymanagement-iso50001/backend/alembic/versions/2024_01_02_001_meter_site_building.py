"""Zähler-Zuordnung auf Standort- und Gebäude-Ebene.

Erweitert die meters-Tabelle um site_id und building_id, damit Zähler
nicht nur Nutzungseinheiten, sondern auch direkt Gebäuden oder Standorten
zugeordnet werden können. Ermöglicht Differenzmessungen:
Standort-Zähler minus Gebäude-Zähler = Restverbrauch.

Revision ID: 002_meter_hierarchy
Revises: 001
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers
revision = "002_meter_hierarchy"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Neue Spalten für direkte Standort-/Gebäude-Zuordnung
    op.add_column("meters", sa.Column("site_id", UUID(as_uuid=True), nullable=True))
    op.add_column("meters", sa.Column("building_id", UUID(as_uuid=True), nullable=True))

    # Foreign Keys
    op.create_foreign_key(
        "fk_meters_site_id", "meters", "sites",
        ["site_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_meters_building_id", "meters", "buildings",
        ["building_id"], ["id"]
    )

    # Indizes für schnelle Abfragen
    op.create_index("ix_meters_site_id", "meters", ["site_id"])
    op.create_index("ix_meters_building_id", "meters", ["building_id"])


def downgrade() -> None:
    op.drop_index("ix_meters_building_id", table_name="meters")
    op.drop_index("ix_meters_site_id", table_name="meters")
    op.drop_constraint("fk_meters_building_id", "meters", type_="foreignkey")
    op.drop_constraint("fk_meters_site_id", "meters", type_="foreignkey")
    op.drop_column("meters", "building_id")
    op.drop_column("meters", "site_id")

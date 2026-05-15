"""Klimasensoren – Standort/Gebäude-Zuordnung ergänzen

Revision ID: 2026_05_15_001
Revises: 2026_05_14_001
Create Date: 2026-05-15 00:00:00.000000

Bisher hatten Klimasensoren nur eine Zuordnung zur Nutzungseinheit
(`usage_unit_id`). Zur konsistenten Hierarchie-Behandlung — analog zu
Zählern — werden nun auch `site_id` und `building_id` ergänzt. Damit
können Sensoren ganzen Standorten oder Gebäuden zugeordnet und in
Auswertungen entsprechend gefiltert werden.
"""

import sqlalchemy as sa
from alembic import op

revision = "2026_05_15_001"
down_revision = "2026_05_14_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "climate_sensors",
        sa.Column(
            "site_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sites.id"),
            nullable=True,
        ),
    )
    op.add_column(
        "climate_sensors",
        sa.Column(
            "building_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("buildings.id"),
            nullable=True,
        ),
    )
    op.create_index("ix_climate_sensors_site_id", "climate_sensors", ["site_id"])
    op.create_index("ix_climate_sensors_building_id", "climate_sensors", ["building_id"])
    op.create_index("ix_climate_sensors_usage_unit_id", "climate_sensors", ["usage_unit_id"])


def downgrade() -> None:
    op.drop_index("ix_climate_sensors_usage_unit_id", "climate_sensors")
    op.drop_index("ix_climate_sensors_building_id", "climate_sensors")
    op.drop_index("ix_climate_sensors_site_id", "climate_sensors")
    op.drop_column("climate_sensors", "building_id")
    op.drop_column("climate_sensors", "site_id")

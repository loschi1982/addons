"""Unique Constraint auf (meter_id, timestamp) in meter_readings

Doppelte Messwerte zum gleichen Zeitpunkt führen zu falscher Verbrauchsberechnung.
Vor dem Setzen des Constraints werden bestehende Duplikate bereinigt:
Es wird jeweils der neueste Datensatz (höchste created_at) behalten.

Revision ID: 2024_01_15_001
Revises: 2024_01_14_001
Create Date: 2024-01-15
"""

from alembic import op
import sqlalchemy as sa

revision = "2024_01_15_001"
down_revision = "2024_01_14_001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Duplikate entfernen: bei gleichem meter_id + timestamp den ältesten Eintrag löschen
    op.execute("""
        DELETE FROM meter_readings
        WHERE id IN (
            SELECT id FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY meter_id, timestamp
                        ORDER BY created_at DESC
                    ) AS rn
                FROM meter_readings
            ) ranked
            WHERE rn > 1
        )
    """)

    # Unique Constraint setzen
    op.create_unique_constraint(
        "uq_meter_readings_meter_timestamp",
        "meter_readings",
        ["meter_id", "timestamp"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_meter_readings_meter_timestamp",
        "meter_readings",
        type_="unique",
    )

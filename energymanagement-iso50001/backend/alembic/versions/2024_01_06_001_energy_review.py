"""Energiebewertung: SEU, EnPI, Baseline, Variablen

Revision ID: a6d001_energy_review
Revises: a5d001_costs
Create Date: 2024-01-06
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision = "a6d001_energy_review"
down_revision = "a5d001_costs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Relevante Variablen
    op.create_table(
        "relevant_variables",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("variable_type", sa.String(50), nullable=False),
        sa.Column("unit", sa.String(50), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("data_source", sa.String(100), nullable=True),
        sa.Column("source_config", JSON, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "relevant_variable_values",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("variable_id", UUID(as_uuid=True), sa.ForeignKey("relevant_variables.id"), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("value", sa.Numeric(16, 4), nullable=False),
        sa.Column("source", sa.String(50), default="manual"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Wesentliche Energieeinsätze (SEU)
    op.create_table(
        "significant_energy_uses",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("consumer_id", UUID(as_uuid=True), sa.ForeignKey("consumers.id"), nullable=True, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("energy_type", sa.String(50), nullable=False),
        sa.Column("determination_method", sa.String(50), default="manual"),
        sa.Column("determination_criteria", sa.Text, nullable=True),
        sa.Column("consumption_share_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("annual_consumption_kwh", sa.Numeric(16, 4), nullable=True),
        sa.Column("monitoring_requirements", JSON, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("review_date", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "seu_relevant_variables",
        sa.Column("seu_id", UUID(as_uuid=True), sa.ForeignKey("significant_energy_uses.id"), primary_key=True),
        sa.Column("variable_id", UUID(as_uuid=True), sa.ForeignKey("relevant_variables.id"), primary_key=True),
    )

    # Energieleistungskennzahlen (EnPI)
    op.create_table(
        "energy_performance_indicators",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("formula_type", sa.String(50), default="specific"),
        sa.Column("unit", sa.String(50), nullable=False),
        sa.Column("numerator_meter_ids", JSON, default=list),
        sa.Column("denominator_variable_id", UUID(as_uuid=True), sa.ForeignKey("relevant_variables.id"), nullable=True),
        sa.Column("denominator_fixed_value", sa.Numeric(16, 4), nullable=True),
        sa.Column("seu_id", UUID(as_uuid=True), sa.ForeignKey("significant_energy_uses.id"), nullable=True),
        sa.Column("target_value", sa.Numeric(16, 4), nullable=True),
        sa.Column("target_direction", sa.String(10), default="lower"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "enpi_values",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("enpi_id", UUID(as_uuid=True), sa.ForeignKey("energy_performance_indicators.id"), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("numerator_value", sa.Numeric(16, 4), nullable=False),
        sa.Column("denominator_value", sa.Numeric(16, 4), nullable=True),
        sa.Column("enpi_value", sa.Numeric(16, 4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Energetische Ausgangsbasis (EnB)
    op.create_table(
        "energy_baselines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("enpi_id", UUID(as_uuid=True), sa.ForeignKey("energy_performance_indicators.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("baseline_value", sa.Numeric(16, 4), nullable=False),
        sa.Column("total_consumption_kwh", sa.Numeric(16, 4), nullable=True),
        sa.Column("adjustment_factors", JSON, nullable=True),
        sa.Column("adjusted_baseline_value", sa.Numeric(16, 4), nullable=True),
        sa.Column("is_current", sa.Boolean, default=True),
        sa.Column("revision_reason", sa.Text, nullable=True),
        sa.Column("superseded_by_id", UUID(as_uuid=True), sa.ForeignKey("energy_baselines.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("energy_baselines")
    op.drop_table("enpi_values")
    op.drop_table("energy_performance_indicators")
    op.drop_table("seu_relevant_variables")
    op.drop_table("significant_energy_uses")
    op.drop_table("relevant_variable_values")
    op.drop_table("relevant_variables")

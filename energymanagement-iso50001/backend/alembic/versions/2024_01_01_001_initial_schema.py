"""Initiale Datenbank-Migration – alle Tabellen.

Revision ID: 001
Revises: –
Create Date: 2024-01-01

Erstellt alle Tabellen für das Energy Management System:
- Benutzer, Rollen, Berechtigungen
- Standorte, Gebäude, Nutzungseinheiten
- Zähler, Zählerstände, Verbraucher
- Energieschema
- Wetterdaten, Klimasensoren
- CO₂-Emissionen
- Witterungskorrektur
- ISO 50001 (13 Tabellen)
- Berichte
- Einstellungen
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSON

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Rollen & Berechtigungen ──

    op.create_table(
        "roles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(100), unique=True, nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_system_role", sa.Boolean, default=False),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "permissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("module", sa.String(100), nullable=False),
        sa.Column("action", sa.String(50), nullable=False),
        sa.Column("resource_scope", sa.String(50), default="all"),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("role_id", UUID(as_uuid=True), sa.ForeignKey("roles.id"), nullable=False),
        sa.Column("permission_id", UUID(as_uuid=True), sa.ForeignKey("permissions.id"), nullable=False),
    )

    # ── Benutzer ──

    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(100), unique=True, index=True, nullable=False),
        sa.Column("email", sa.String(255), unique=True, index=True, nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role_id", UUID(as_uuid=True), sa.ForeignKey("roles.id"), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("is_locked", sa.Boolean, default=False),
        sa.Column("failed_login_attempts", sa.Integer, default=0),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("must_change_password", sa.Boolean, default=False),
        sa.Column("language", sa.String(5), default="de"),
        sa.Column("allowed_locations", JSON, nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "user_permission_overrides",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("permission_id", UUID(as_uuid=True), sa.ForeignKey("permissions.id"), nullable=False),
        sa.Column("override_type", sa.String(10), nullable=False),
        sa.Column("reason", sa.Text, nullable=True),
        sa.Column("granted_by", UUID(as_uuid=True), nullable=False),
        sa.Column("valid_from", sa.Date, nullable=True),
        sa.Column("valid_to", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "user_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("user_agent", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_revoked", sa.Boolean, default=False),
    )

    op.create_table(
        "audit_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(100), nullable=False),
        sa.Column("resource_type", sa.String(100), nullable=True),
        sa.Column("resource_id", UUID(as_uuid=True), nullable=True),
        sa.Column("details", JSON, nullable=True),
        sa.Column("ip_address", sa.String(45), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.func.now(), index=True),
    )

    # ── Wetterstationen (vor Sites, da FK) ──

    op.create_table(
        "weather_stations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("dwd_station_id", sa.String(20), nullable=True),
        sa.Column("latitude", sa.Float, nullable=False),
        sa.Column("longitude", sa.Float, nullable=False),
        sa.Column("altitude", sa.Float, nullable=True),
        sa.Column("data_source", sa.String(50), nullable=False),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "weather_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("station_id", UUID(as_uuid=True), sa.ForeignKey("weather_stations.id"), index=True),
        sa.Column("date", sa.Date, index=True, nullable=False),
        sa.Column("temp_avg", sa.Numeric(5, 2), nullable=False),
        sa.Column("temp_min", sa.Numeric(5, 2), nullable=True),
        sa.Column("temp_max", sa.Numeric(5, 2), nullable=True),
        sa.Column("heating_degree_days", sa.Numeric(6, 2), nullable=True),
        sa.Column("cooling_degree_days", sa.Numeric(6, 2), nullable=True),
        sa.Column("sunshine_hours", sa.Numeric(4, 1), nullable=True),
        sa.Column("precipitation_mm", sa.Numeric(6, 1), nullable=True),
        sa.Column("wind_speed_avg", sa.Numeric(5, 1), nullable=True),
        sa.Column("source", sa.String(50), nullable=False),
    )

    op.create_table(
        "monthly_degree_days",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("station_id", UUID(as_uuid=True), sa.ForeignKey("weather_stations.id"), index=True),
        sa.Column("year", sa.Integer, nullable=False),
        sa.Column("month", sa.Integer, nullable=False),
        sa.Column("heating_degree_days", sa.Numeric(8, 2), nullable=False),
        sa.Column("cooling_degree_days", sa.Numeric(8, 2), nullable=False),
        sa.Column("avg_temperature", sa.Numeric(5, 2), nullable=False),
        sa.Column("heating_days", sa.Integer, nullable=False),
        sa.Column("long_term_avg_hdd", sa.Numeric(8, 2), nullable=True),
    )

    # ── Standorte, Gebäude, Nutzungseinheiten ──

    op.create_table(
        "sites",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("street", sa.String(255), nullable=True),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("city", sa.String(255), nullable=True),
        sa.Column("state", sa.String(255), nullable=True),
        sa.Column("country", sa.String(5), default="DE"),
        sa.Column("latitude", sa.Float, nullable=True),
        sa.Column("longitude", sa.Float, nullable=True),
        sa.Column("weather_station_id", UUID(as_uuid=True), sa.ForeignKey("weather_stations.id"), nullable=True),
        sa.Column("co2_region", sa.String(10), default="DE"),
        sa.Column("electricity_maps_zone", sa.String(50), nullable=True),
        sa.Column("timezone", sa.String(50), default="Europe/Berlin"),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "buildings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("site_id", UUID(as_uuid=True), sa.ForeignKey("sites.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("building_type", sa.String(100), nullable=True),
        sa.Column("gross_floor_area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("net_floor_area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("heated_area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("cooled_area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("building_year", sa.Integer, nullable=True),
        sa.Column("floors_above_ground", sa.Integer, nullable=True),
        sa.Column("floors_below_ground", sa.Integer, nullable=True),
        sa.Column("energy_certificate_class", sa.String(5), nullable=True),
        sa.Column("energy_certificate_value", sa.Numeric(8, 2), nullable=True),
        sa.Column("street", sa.String(255), nullable=True),
        sa.Column("postal_code", sa.String(20), nullable=True),
        sa.Column("city", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "usage_units",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("code", sa.String(50), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("usage_type", sa.String(50), nullable=False),
        sa.Column("floor", sa.String(20), nullable=True),
        sa.Column("area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("heated_area_m2", sa.Numeric(12, 2), nullable=True),
        sa.Column("occupants", sa.Integer, nullable=True),
        sa.Column("operating_hours_per_week", sa.Numeric(5, 1), nullable=True),
        sa.Column("tenant_name", sa.String(255), nullable=True),
        sa.Column("tenant_id", sa.String(100), nullable=True),
        sa.Column("lease_start", sa.Date, nullable=True),
        sa.Column("lease_end", sa.Date, nullable=True),
        sa.Column("target_enpi_kwh_per_m2", sa.Numeric(10, 2), nullable=True),
        sa.Column("target_co2_kg_per_m2", sa.Numeric(10, 2), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Zähler ──

    op.create_table(
        "meters",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("meter_number", sa.String(100), nullable=True),
        sa.Column("energy_type", sa.String(50), nullable=False),
        sa.Column("unit", sa.String(20), nullable=False),
        sa.Column("data_source", sa.String(50), nullable=False),
        sa.Column("source_config", JSON, nullable=True),
        sa.Column("parent_meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), nullable=True),
        sa.Column("usage_unit_id", UUID(as_uuid=True), sa.ForeignKey("usage_units.id"), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("cost_center", sa.String(100), nullable=True),
        sa.Column("tariff_info", JSON, nullable=True),
        sa.Column("is_weather_corrected", sa.Boolean, default=False),
        sa.Column("co2_factor_override", sa.Numeric(10, 4), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Zählerstände ──

    op.create_table(
        "meter_readings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), index=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), index=True, nullable=False),
        sa.Column("value", sa.Numeric(16, 4), nullable=False),
        sa.Column("consumption", sa.Numeric(16, 4), nullable=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("quality", sa.String(50), default="measured"),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("import_batch_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "import_batches",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("filename", sa.String(500), nullable=False),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("file_size_bytes", sa.Integer, nullable=False),
        sa.Column("mapping_profile", sa.String(255), nullable=True),
        sa.Column("column_mapping", JSON, nullable=False),
        sa.Column("import_settings", JSON, nullable=False),
        sa.Column("meter_mapping", JSON, nullable=False),
        sa.Column("total_rows", sa.Integer, nullable=False),
        sa.Column("imported_count", sa.Integer, default=0),
        sa.Column("skipped_count", sa.Integer, default=0),
        sa.Column("error_count", sa.Integer, default=0),
        sa.Column("warning_count", sa.Integer, default=0),
        sa.Column("meter_changes_detected", sa.Integer, default=0),
        sa.Column("period_start", sa.Date, nullable=True),
        sa.Column("period_end", sa.Date, nullable=True),
        sa.Column("affected_meter_ids", JSON, nullable=True),
        sa.Column("status", sa.String(50), default="pending"),
        sa.Column("error_details", JSON, nullable=True),
        sa.Column("imported_by", UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "import_mapping_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), unique=True, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("file_type", sa.String(20), nullable=False),
        sa.Column("column_mapping", JSON, nullable=False),
        sa.Column("import_settings", JSON, nullable=False),
        sa.Column("meter_mapping", JSON, nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=False),
        sa.Column("last_used", sa.DateTime(timezone=True), nullable=True),
        sa.Column("use_count", sa.Integer, default=0),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "meter_changes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), nullable=False),
        sa.Column("change_date", sa.Date, nullable=False),
        sa.Column("old_meter_number", sa.String(100), nullable=True),
        sa.Column("new_meter_number", sa.String(100), nullable=True),
        sa.Column("final_reading_old", sa.Numeric(16, 4), nullable=True),
        sa.Column("initial_reading_new", sa.Numeric(16, 4), nullable=True),
        sa.Column("reason", sa.String(255), nullable=True),
        sa.Column("detected_by", sa.String(50), nullable=False),
        sa.Column("import_batch_id", UUID(as_uuid=True), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Verbraucher (n:m mit Zähler) ──

    op.create_table(
        "consumers",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("rated_power", sa.Numeric(10, 2), nullable=True),
        sa.Column("operating_hours", sa.Numeric(8, 1), nullable=True),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("usage_unit_id", UUID(as_uuid=True), sa.ForeignKey("usage_units.id"), nullable=True),
        sa.Column("priority", sa.Integer, default=0),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "meter_consumer",
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), primary_key=True),
        sa.Column("consumer_id", UUID(as_uuid=True), sa.ForeignKey("consumers.id"), primary_key=True),
    )

    # ── Energieschema ──

    op.create_table(
        "energy_schemas",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("schema_type", sa.String(100), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("is_default", sa.Boolean, default=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "schema_positions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("schema_id", UUID(as_uuid=True), sa.ForeignKey("energy_schemas.id"), nullable=False),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), nullable=False),
        sa.Column("x", sa.Float, nullable=False),
        sa.Column("y", sa.Float, nullable=False),
        sa.Column("width", sa.Float, default=200),
        sa.Column("height", sa.Float, default=100),
        sa.Column("style_config", JSON, nullable=True),
        sa.Column("connections", JSON, nullable=True),
    )

    # ── Emissionsfaktoren & CO₂ ──

    op.create_table(
        "emission_factor_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("source_type", sa.String(50), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("url", sa.String(500), nullable=True),
        sa.Column("is_default", sa.Boolean, default=False),
        sa.Column("last_updated", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        "emission_factors",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("emission_factor_sources.id"), nullable=False),
        sa.Column("energy_type", sa.String(50), index=True, nullable=False),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column("month", sa.Integer, nullable=True),
        sa.Column("region", sa.String(10), default="DE"),
        sa.Column("co2_g_per_kwh", sa.Numeric(10, 4), nullable=False),
        sa.Column("co2eq_g_per_kwh", sa.Numeric(10, 4), nullable=True),
        sa.Column("includes_upstream", sa.Boolean, default=False),
        sa.Column("scope", sa.String(20), default="scope_2"),
        sa.Column("valid_from", sa.Date, nullable=True),
        sa.Column("valid_to", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
    )

    op.create_table(
        "co2_calculations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), index=True, nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("consumption_kwh", sa.Numeric(16, 4), nullable=False),
        sa.Column("emission_factor_id", UUID(as_uuid=True), sa.ForeignKey("emission_factors.id"), nullable=False),
        sa.Column("co2_kg", sa.Numeric(12, 4), nullable=False),
        sa.Column("co2eq_kg", sa.Numeric(12, 4), nullable=True),
        sa.Column("calculation_method", sa.String(50), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Witterungskorrektur ──

    op.create_table(
        "weather_correction_configs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), unique=True, nullable=False),
        sa.Column("station_id", UUID(as_uuid=True), sa.ForeignKey("weather_stations.id"), nullable=False),
        sa.Column("method", sa.String(50), nullable=False),
        sa.Column("indoor_temp", sa.Numeric(4, 1), default=20.0),
        sa.Column("heating_limit", sa.Numeric(4, 1), default=15.0),
        sa.Column("cooling_limit", sa.Numeric(4, 1), default=24.0),
        sa.Column("reference_year", sa.Integer, nullable=True),
        sa.Column("reference_hdd", sa.Numeric(8, 2), nullable=True),
        sa.Column("base_load_percent", sa.Numeric(5, 2), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
    )

    op.create_table(
        "weather_corrected_consumption",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("meter_id", UUID(as_uuid=True), sa.ForeignKey("meters.id"), index=True, nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("raw_consumption", sa.Numeric(16, 4), nullable=False),
        sa.Column("corrected_consumption", sa.Numeric(16, 4), nullable=False),
        sa.Column("correction_factor", sa.Numeric(8, 6), nullable=False),
        sa.Column("actual_hdd", sa.Numeric(8, 2), nullable=False),
        sa.Column("reference_hdd", sa.Numeric(8, 2), nullable=False),
        sa.Column("method", sa.String(50), nullable=False),
        sa.Column("calculated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Klimasensoren ──

    op.create_table(
        "climate_sensors",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("sensor_type", sa.String(50), nullable=False),
        sa.Column("location", sa.String(255), nullable=True),
        sa.Column("zone", sa.String(100), nullable=True),
        sa.Column("usage_unit_id", UUID(as_uuid=True), sa.ForeignKey("usage_units.id"), nullable=True),
        sa.Column("ha_entity_id_temp", sa.String(255), nullable=True),
        sa.Column("ha_entity_id_humidity", sa.String(255), nullable=True),
        sa.Column("data_source", sa.String(50), nullable=False),
        sa.Column("source_config", JSON, nullable=True),
        sa.Column("target_temp_min", sa.Numeric(4, 1), nullable=True),
        sa.Column("target_temp_max", sa.Numeric(4, 1), nullable=True),
        sa.Column("target_humidity_min", sa.Numeric(5, 1), nullable=True),
        sa.Column("target_humidity_max", sa.Numeric(5, 1), nullable=True),
        sa.Column("associated_meter_ids", JSON, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "climate_readings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("sensor_id", UUID(as_uuid=True), sa.ForeignKey("climate_sensors.id"), index=True, nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), index=True, nullable=False),
        sa.Column("temperature", sa.Numeric(5, 2), nullable=True),
        sa.Column("humidity", sa.Numeric(5, 1), nullable=True),
        sa.Column("dew_point", sa.Numeric(5, 2), nullable=True),
        sa.Column("source", sa.String(50), nullable=False),
        sa.Column("quality", sa.String(50), default="measured"),
    )

    op.create_table(
        "climate_zone_summaries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("zone", sa.String(100), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("avg_temperature", sa.Numeric(5, 2), nullable=False),
        sa.Column("min_temperature", sa.Numeric(5, 2), nullable=False),
        sa.Column("max_temperature", sa.Numeric(5, 2), nullable=False),
        sa.Column("avg_humidity", sa.Numeric(5, 1), nullable=False),
        sa.Column("min_humidity", sa.Numeric(5, 1), nullable=False),
        sa.Column("max_humidity", sa.Numeric(5, 1), nullable=False),
        sa.Column("hours_below_target_temp", sa.Numeric(8, 1), nullable=False),
        sa.Column("hours_above_target_temp", sa.Numeric(8, 1), nullable=False),
        sa.Column("hours_outside_target_humidity", sa.Numeric(8, 1), nullable=False),
        sa.Column("comfort_score", sa.Numeric(5, 1), nullable=True),
    )

    # ── ISO 50001 ──

    op.create_table(
        "organization_context",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("scope_description", sa.Text, nullable=False),
        sa.Column("scope_boundaries", JSON, nullable=True),
        sa.Column("internal_issues", JSON, default=[]),
        sa.Column("external_issues", JSON, default=[]),
        sa.Column("interested_parties", JSON, default=[]),
        sa.Column("energy_types_excluded", JSON, nullable=True),
        sa.Column("last_reviewed", sa.Date, nullable=False),
        sa.Column("version", sa.Integer, default=1),
    )

    op.create_table(
        "energy_policies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("approved_by", sa.String(255), nullable=True),
        sa.Column("approved_date", sa.Date, nullable=True),
        sa.Column("valid_from", sa.Date, nullable=True),
        sa.Column("valid_to", sa.Date, nullable=True),
        sa.Column("is_current", sa.Boolean, default=True),
        sa.Column("pdf_path", sa.String(500), nullable=True),
        sa.Column("version", sa.Integer, default=1),
    )

    op.create_table(
        "enms_roles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("role_name", sa.String(255), nullable=False),
        sa.Column("person_name", sa.String(255), nullable=False),
        sa.Column("department", sa.String(255), nullable=True),
        sa.Column("responsibilities", JSON, default=[]),
        sa.Column("authorities", JSON, default=[]),
        sa.Column("appointed_date", sa.Date, nullable=True),
        sa.Column("appointed_by", sa.String(255), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
    )

    op.create_table(
        "energy_objectives",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("target_type", sa.String(50), nullable=True),
        sa.Column("target_value", sa.Numeric(16, 4), nullable=False),
        sa.Column("target_unit", sa.String(50), nullable=True),
        sa.Column("baseline_value", sa.Numeric(16, 4), nullable=False),
        sa.Column("baseline_period", sa.String(50), nullable=True),
        sa.Column("target_date", sa.Date, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("status", sa.String(50), default="planned"),
        sa.Column("related_meter_ids", JSON, nullable=True),
        sa.Column("current_value", sa.Numeric(16, 4), nullable=True),
        sa.Column("progress_percent", sa.Numeric(5, 1), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "action_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("objective_id", UUID(as_uuid=True), sa.ForeignKey("energy_objectives.id"), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=False),
        sa.Column("resources_required", sa.Text, nullable=True),
        sa.Column("investment_cost", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_savings_kwh", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_savings_eur", sa.Numeric(12, 2), nullable=True),
        sa.Column("expected_savings_co2_kg", sa.Numeric(12, 2), nullable=True),
        sa.Column("start_date", sa.Date, nullable=True),
        sa.Column("target_date", sa.Date, nullable=True),
        sa.Column("completion_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(50), default="planned"),
        sa.Column("verification_method", sa.Text, nullable=True),
        sa.Column("actual_savings_kwh", sa.Numeric(12, 2), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "risks_opportunities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.String(20), nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("category", sa.String(100), nullable=False),
        sa.Column("likelihood", sa.Integer, nullable=False),
        sa.Column("impact", sa.Integer, nullable=False),
        sa.Column("risk_score", sa.Integer, nullable=False),
        sa.Column("mitigation_action", sa.Text, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("status", sa.String(50), default="open"),
        sa.Column("review_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "documents",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("document_type", sa.String(50), nullable=False),
        sa.Column("category", sa.String(100), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("file_path", sa.String(500), nullable=True),
        sa.Column("file_type", sa.String(20), nullable=True),
        sa.Column("version", sa.String(20), default="1.0"),
        sa.Column("status", sa.String(50), default="draft"),
        sa.Column("author", sa.String(255), nullable=True),
        sa.Column("approved_by", sa.String(255), nullable=True),
        sa.Column("approved_date", sa.Date, nullable=True),
        sa.Column("review_due_date", sa.Date, nullable=True),
        sa.Column("retention_period_months", sa.Integer, nullable=True),
        sa.Column("iso_clause_reference", sa.String(20), nullable=True),
        sa.Column("tags", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "document_revisions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("document_id", UUID(as_uuid=True), sa.ForeignKey("documents.id"), nullable=False),
        sa.Column("version", sa.String(20), nullable=False),
        sa.Column("change_description", sa.Text, nullable=False),
        sa.Column("changed_by", sa.String(255), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("file_path", sa.String(500), nullable=True),
    )

    op.create_table(
        "legal_requirements",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("category", sa.String(50), nullable=False),
        sa.Column("jurisdiction", sa.String(50), nullable=True),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("relevance", sa.Text, nullable=True),
        sa.Column("compliance_status", sa.String(50), default="not_assessed"),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("last_assessment_date", sa.Date, nullable=True),
        sa.Column("next_review_date", sa.Date, nullable=True),
        sa.Column("source_url", sa.String(500), nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("is_active", sa.Boolean, default=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "internal_audits",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("audit_type", sa.String(50), nullable=False),
        sa.Column("scope", sa.Text, nullable=True),
        sa.Column("planned_date", sa.Date, nullable=True),
        sa.Column("actual_date", sa.Date, nullable=True),
        sa.Column("lead_auditor", sa.String(255), nullable=True),
        sa.Column("audit_team", JSON, nullable=True),
        sa.Column("status", sa.String(50), default="planned"),
        sa.Column("overall_result", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "audit_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("audit_id", UUID(as_uuid=True), sa.ForeignKey("internal_audits.id"), nullable=False),
        sa.Column("finding_type", sa.String(50), nullable=False),
        sa.Column("iso_clause", sa.String(20), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("evidence", sa.Text, nullable=True),
        sa.Column("corrective_action", sa.Text, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("completion_date", sa.Date, nullable=True),
        sa.Column("verification_result", sa.Text, nullable=True),
        sa.Column("status", sa.String(50), default="open"),
    )

    op.create_table(
        "management_reviews",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("review_date", sa.Date, nullable=False),
        sa.Column("participants", JSON, default=[]),
        sa.Column("period_start", sa.Date, nullable=True),
        sa.Column("period_end", sa.Date, nullable=True),
        sa.Column("previous_review_actions", sa.Text, nullable=True),
        sa.Column("energy_policy_adequacy", sa.Text, nullable=True),
        sa.Column("enpi_performance", sa.Text, nullable=True),
        sa.Column("compliance_status", sa.Text, nullable=True),
        sa.Column("audit_results_summary", sa.Text, nullable=True),
        sa.Column("nonconformities_summary", sa.Text, nullable=True),
        sa.Column("external_changes", sa.Text, nullable=True),
        sa.Column("resource_adequacy", sa.Text, nullable=True),
        sa.Column("improvement_opportunities", sa.Text, nullable=True),
        sa.Column("decisions", JSON, nullable=True),
        sa.Column("action_items", JSON, nullable=True),
        sa.Column("policy_changes_needed", sa.Boolean, default=False),
        sa.Column("resource_changes_needed", sa.Text, nullable=True),
        sa.Column("next_review_date", sa.Date, nullable=True),
        sa.Column("status", sa.String(50), default="planned"),
        sa.Column("protocol_document_id", UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "nonconformities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("source", sa.String(50), nullable=True),
        sa.Column("source_reference_id", UUID(as_uuid=True), nullable=True),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("root_cause", sa.Text, nullable=True),
        sa.Column("immediate_action", sa.Text, nullable=True),
        sa.Column("corrective_action", sa.Text, nullable=True),
        sa.Column("responsible_person", sa.String(255), nullable=True),
        sa.Column("due_date", sa.Date, nullable=True),
        sa.Column("completion_date", sa.Date, nullable=True),
        sa.Column("effectiveness_verified", sa.Boolean, default=False),
        sa.Column("verification_date", sa.Date, nullable=True),
        sa.Column("verification_notes", sa.Text, nullable=True),
        sa.Column("status", sa.String(50), default="open"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Berichte ──

    op.create_table(
        "audit_reports",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("report_type", sa.String(50), nullable=False),
        sa.Column("period_start", sa.Date, nullable=False),
        sa.Column("period_end", sa.Date, nullable=False),
        sa.Column("scope", JSON, nullable=True),
        sa.Column("status", sa.String(50), default="pending"),
        sa.Column("data_snapshot", JSON, nullable=True),
        sa.Column("summary", sa.Text, nullable=True),
        sa.Column("co2_summary", JSON, nullable=True),
        sa.Column("weather_correction_applied", sa.Boolean, default=False),
        sa.Column("findings", JSON, nullable=True),
        sa.Column("recommendations", JSON, nullable=True),
        sa.Column("pdf_path", sa.String(500), nullable=True),
        sa.Column("generated_by_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # ── Einstellungen ──

    op.create_table(
        "app_settings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(100), unique=True, index=True, nullable=False),
        sa.Column("value", JSON, nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("category", sa.String(50), default="general"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    # In umgekehrter Reihenfolge löschen (wegen Foreign Keys)
    op.drop_table("app_settings")
    op.drop_table("audit_reports")
    op.drop_table("nonconformities")
    op.drop_table("management_reviews")
    op.drop_table("audit_findings")
    op.drop_table("internal_audits")
    op.drop_table("legal_requirements")
    op.drop_table("document_revisions")
    op.drop_table("documents")
    op.drop_table("risks_opportunities")
    op.drop_table("action_plans")
    op.drop_table("energy_objectives")
    op.drop_table("enms_roles")
    op.drop_table("energy_policies")
    op.drop_table("organization_context")
    op.drop_table("climate_zone_summaries")
    op.drop_table("climate_readings")
    op.drop_table("climate_sensors")
    op.drop_table("weather_corrected_consumption")
    op.drop_table("weather_correction_configs")
    op.drop_table("co2_calculations")
    op.drop_table("emission_factors")
    op.drop_table("emission_factor_sources")
    op.drop_table("schema_positions")
    op.drop_table("energy_schemas")
    op.drop_table("meter_consumer")
    op.drop_table("consumers")
    op.drop_table("meter_changes")
    op.drop_table("import_mapping_profiles")
    op.drop_table("import_batches")
    op.drop_table("meter_readings")
    op.drop_table("meters")
    op.drop_table("usage_units")
    op.drop_table("buildings")
    op.drop_table("sites")
    op.drop_table("monthly_degree_days")
    op.drop_table("weather_records")
    op.drop_table("weather_stations")
    op.drop_table("audit_logs")
    op.drop_table("user_sessions")
    op.drop_table("user_permission_overrides")
    op.drop_table("users")
    op.drop_table("role_permissions")
    op.drop_table("permissions")
    op.drop_table("roles")

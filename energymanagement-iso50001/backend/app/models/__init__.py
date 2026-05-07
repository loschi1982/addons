"""
models/__init__.py – Importiert alle Datenbankmodelle.

Dieser Import ist wichtig, damit Alembic und SQLAlchemy alle Modelle
kennen und die Datenbanktabellen erstellen können. Wenn ein Modell
hier nicht importiert wird, wird seine Tabelle nicht angelegt.
"""

from app.core.database import Base  # noqa: F401

from app.models.enums import *  # noqa: F401, F403
from app.models.user import User, UserSession, AuditLog  # noqa: F401
from app.models.role import Role, Permission, RolePermission, UserPermissionOverride  # noqa: F401
from app.models.site import Site, Building, UsageUnit  # noqa: F401
from app.models.meter import Meter  # noqa: F401
from app.models.allocation import MeterUnitAllocation  # noqa: F401
from app.models.reading import MeterReading, ImportBatch, ImportMappingProfile, MeterChange  # noqa: F401
from app.models.consumer import Consumer, meter_consumer  # noqa: F401
from app.models.schema import EnergySchema, SchemaPosition  # noqa: F401
from app.models.weather import WeatherStation, WeatherRecord, MonthlyDegreeDays  # noqa: F401
from app.models.emission import EmissionFactorSource, EmissionFactor, CO2Calculation  # noqa: F401
from app.models.correction import WeatherCorrectionConfig, WeatherCorrectedConsumption  # noqa: F401
from app.models.climate import ClimateSensor, ClimateReading, ClimateZoneSummary  # noqa: F401
from app.models.report import AuditReport  # noqa: F401
from app.models.settings import AppSetting  # noqa: F401
from app.models.iso import (  # noqa: F401
    OrganizationContext, EnergyPolicy, EnMSRole,
    EnergyObjective, ActionPlan, RiskOpportunity,
    Document, DocumentRevision, LegalRequirement,
    InternalAudit, AuditFinding, ManagementReview, Nonconformity,
)
from app.models.invoice import EnergyInvoice  # noqa: F401
from app.models.district_heating_provider import DistrictHeatingProvider  # noqa: F401
from app.models.energy_review import (  # noqa: F401
    RelevantVariable, RelevantVariableValue,
    SignificantEnergyUse, seu_relevant_variables,
    EnergyPerformanceIndicator, EnPIValue,
    EnergyBaseline,
)

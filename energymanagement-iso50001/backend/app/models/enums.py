"""
enums.py – Aufzählungstypen (Enums) für das gesamte Datenmodell.

Enums definieren eine feste Menge erlaubter Werte für bestimmte Felder.
Beispiel: Ein Zähler kann nur die Energietypen "ELECTRICITY", "GAS" usw.
haben – keine beliebigen Texte. Das verhindert Tippfehler und macht
Abfragen zuverlässiger.

Durch die Kombination mit str (class EnergyType(str, Enum)) werden die
Werte als Strings in der Datenbank gespeichert und können in JSON-Antworten
direkt als Text ausgegeben werden.
"""

from enum import Enum


class EnergyType(str, Enum):
    """Arten von Energieträgern, die das System erfassen kann."""
    ELECTRICITY = "electricity"             # Strom
    NATURAL_GAS = "natural_gas"             # Erdgas
    HEATING_OIL = "heating_oil"             # Heizöl
    DISTRICT_HEATING = "district_heating"   # Fernwärme
    DISTRICT_COOLING = "district_cooling"   # Kälte (Fernkälte, Klimaanlage)
    WATER = "water"                         # Wasser
    SOLAR = "solar"                         # Solar (Eigenproduktion)
    LPG = "lpg"                             # Flüssiggas
    WOOD_PELLETS = "wood_pellets"           # Holzpellets
    COMPRESSED_AIR = "compressed_air"       # Druckluft
    STEAM = "steam"                         # Dampf
    OTHER = "other"                         # Sonstige


class DataSource(str, Enum):
    """Woher kommen die Messdaten eines Zählers?"""
    SHELLY = "shelly"                         # Shelly Smart Plug / Pro
    MODBUS = "modbus"                         # Modbus TCP/RTU Protokoll
    KNX = "knx"                               # KNX/IP Gebäudeautomation
    HOME_ASSISTANT_ENTITY = "home_assistant"   # HA-Sensor (z.B. sensor.strom_eg)
    MANUAL = "manual"                         # Manuelle Eingabe im Frontend
    CSV_IMPORT = "csv_import"                 # Import aus CSV/Excel-Datei
    API = "api"                               # Externe API


class ReadingSource(str, Enum):
    """Wie wurde ein einzelner Zählerstand erfasst?"""
    AUTOMATIC = "automatic"   # Automatisch durch Integration (Shelly, Modbus, etc.)
    MANUAL = "manual"         # Manuell vom Benutzer eingegeben
    IMPORT = "import"         # Aus Datei-Import (CSV/Excel)
    BILLING = "billing"       # Aus Abrechnung (Versorger, Hausverwaltung)


class DataQuality(str, Enum):
    """Qualitätsstufe eines Messwerts."""
    MEASURED = "measured"     # Tatsächlich gemessen (höchste Qualität)
    ESTIMATED = "estimated"   # Geschätzt (z.B. bei Datenlücken)
    CORRECTED = "corrected"   # Nachträglich korrigiert


class ReportType(str, Enum):
    """Art des Audit-/Energieberichts."""
    MONTHLY = "monthly"       # Monatsbericht
    QUARTERLY = "quarterly"   # Quartalsbericht
    ANNUAL = "annual"         # Jahresbericht
    CUSTOM = "custom"         # Benutzerdefinierter Zeitraum
    AUDIT = "audit"           # Energieaudit (ISO 50001)


class ReportStatus(str, Enum):
    """Status der Berichtsgenerierung."""
    DRAFT = "draft"           # Entwurf (noch nicht generiert)
    GENERATING = "generating" # Wird gerade generiert (Hintergrund-Task)
    COMPLETED = "completed"   # Fertig – PDF steht zum Download bereit
    FAILED = "failed"         # Generierung fehlgeschlagen


class ClimateSensorType(str, Enum):
    """Art des Klimasensors."""
    TEMPERATURE = "temperature"                       # Nur Temperatur
    HUMIDITY = "humidity"                              # Nur Luftfeuchtigkeit
    TEMPERATURE_HUMIDITY_COMBO = "temp_humidity_combo" # Kombi-Sensor (beides)


class ImportStatus(str, Enum):
    """Status eines Datei-Imports."""
    PENDING = "pending"           # Hochgeladen, noch nicht verarbeitet
    VALIDATING = "validating"     # Wird gerade validiert
    IMPORTING = "importing"       # Import läuft
    COMPLETED = "completed"       # Erfolgreich importiert
    FAILED = "failed"             # Import fehlgeschlagen
    ROLLED_BACK = "rolled_back"   # Import wurde rückgängig gemacht


class UsageType(str, Enum):
    """Nutzungsart einer Nutzungseinheit (Raum/Fläche)."""
    RESIDENTIAL = "residential"       # Wohnung
    OFFICE = "office"                 # Büro
    RETAIL = "retail"                 # Einzelhandel/Laden
    PRODUCTION = "production"         # Produktion/Fertigung
    WAREHOUSE = "warehouse"           # Lager
    SERVER_ROOM = "server_room"       # Serverraum
    COMMON_AREA = "common_area"       # Gemeinschaftsfläche (Flur, Treppenhaus)
    KITCHEN_CANTEEN = "kitchen"       # Küche/Kantine
    LABORATORY = "laboratory"         # Labor
    OTHER = "other"                   # Sonstige

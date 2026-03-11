# Datenbankmodell für Benutzer (Personal, Techniker, Admins).
# Besucher werden nicht in dieser Tabelle gespeichert – sie nutzen QR-Tokens.

from sqlalchemy import Integer, String
from typing import Optional
from sqlalchemy.orm import Mapped, mapped_column

from backend.database import Base


class User(Base):
    """Repräsentiert einen registrierten Benutzer mit PIN-Login."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Benutzername, z.B. "admin" oder "max.mustermann"
    username: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)

    # bcrypt-Hash des 4-stelligen PINs – NULL bedeutet: noch kein PIN gesetzt (Erst-Setup)
    pin_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Rolle: staff, technician oder admin (visitor hat keinen DB-Eintrag)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="staff")
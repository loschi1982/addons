"""
security.py – Sicherheitsfunktionen: JWT-Tokens und Passwort-Hashing.

Dieses Modul stellt zwei zentrale Sicherheitsmechanismen bereit:

1. **JWT-Tokens:** Wie ein Ausweis für API-Anfragen. Nach dem Login
   erhält der Benutzer einen Token, den er bei jeder Anfrage mitschickt.
   Der Server prüft den Token, ohne die Datenbank abfragen zu müssen.

2. **Passwort-Hashing:** Passwörter werden nie im Klartext gespeichert.
   Stattdessen wird ein Hash berechnet – eine Einweg-Verschlüsselung,
   die sich nicht zurückrechnen lässt. Beim Login wird der Hash des
   eingegebenen Passworts mit dem gespeicherten Hash verglichen.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import get_settings

# ── Passwort-Hashing mit bcrypt ──
# bcrypt ist ein bewährter Hashing-Algorithmus, der absichtlich langsam ist.
# Das macht Brute-Force-Angriffe (alle Kombinationen durchprobieren) unpraktikabel.
# Der "schemes"-Parameter legt fest, welcher Algorithmus verwendet wird.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# JWT-Algorithmus: HMAC-SHA256 – signiert den Token mit dem Secret Key
ALGORITHM = "HS256"


def hash_password(password: str) -> str:
    """
    Erstellt einen bcrypt-Hash aus einem Klartext-Passwort.

    Args:
        password: Das Passwort im Klartext (z.B. "MeinSicheresPasswort123")

    Returns:
        Der bcrypt-Hash (z.B. "$2b$12$LJ3m4...")
        Dieser Hash wird in der Datenbank gespeichert.
    """
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Prüft ob ein Passwort zum gespeicherten Hash passt.

    Args:
        plain_password: Das eingegebene Passwort (Klartext)
        hashed_password: Der in der Datenbank gespeicherte Hash

    Returns:
        True wenn das Passwort korrekt ist, sonst False
    """
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: UUID, role: str, extra_claims: dict | None = None) -> str:
    """
    Erstellt einen kurzlebigen Access Token (JWT).

    Der Access Token wird bei jeder API-Anfrage im Header mitgeschickt:
        Authorization: Bearer <token>

    Er enthält die User-ID und Rolle, damit der Server den Benutzer
    identifizieren kann, ohne die Datenbank abzufragen.

    Args:
        user_id: Die UUID des Benutzers
        role: Der Rollenname (z.B. "administrator", "viewer")
        extra_claims: Optionale zusätzliche Daten im Token

    Returns:
        Der signierte JWT-String
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user_id),       # Subject: Wer ist der Benutzer?
        "role": role,               # Rolle für schnelle Berechtigungsprüfung
        "type": "access",           # Token-Typ (access vs. refresh)
        "iat": now,                 # Issued At: Wann wurde der Token erstellt?
        "exp": now + timedelta(minutes=settings.access_token_expire_minutes),
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def create_refresh_token(user_id: UUID) -> str:
    """
    Erstellt einen langlebigen Refresh Token.

    Der Refresh Token wird verwendet, um einen neuen Access Token zu
    bekommen, wenn der alte abgelaufen ist. Der Benutzer muss sich
    dadurch nicht erneut einloggen.

    Refresh Tokens sind länger gültig (7 Tage Standard), werden aber
    in der Datenbank gespeichert und können widerrufen werden.
    """
    settings = get_settings()
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": now,
        "exp": now + timedelta(days=settings.refresh_token_expire_days),
    }

    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> dict | None:
    """
    Prüft und dekodiert einen JWT-Token.

    Args:
        token: Der JWT-String aus dem Authorization-Header

    Returns:
        Die Token-Daten (Payload) als Dictionary, oder None wenn
        der Token ungültig oder abgelaufen ist.

    Der Token ist ungültig wenn:
    - Er manipuliert wurde (Signatur stimmt nicht)
    - Er abgelaufen ist (exp < jetzt)
    - Er ein falsches Format hat
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None

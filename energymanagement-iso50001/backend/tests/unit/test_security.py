"""
test_security.py – Tests für Passwort-Hashing und JWT-Tokens.
"""

from app.core.security import create_access_token, hash_password, verify_password, verify_token


def test_hash_password():
    """Passwort-Hash erstellen und verifizieren."""
    password = "MeinSicheresPasswort123!"
    hashed = hash_password(password)
    assert hashed != password
    assert verify_password(password, hashed)


def test_verify_password_wrong():
    """Falsches Passwort wird abgelehnt."""
    hashed = hash_password("richtig")
    assert not verify_password("falsch", hashed)


def test_create_and_verify_token():
    """JWT-Token erstellen und verifizieren."""
    import uuid
    user_id = uuid.uuid4()
    token = create_access_token(user_id, "admin")
    decoded = verify_token(token)
    assert decoded is not None
    assert decoded["sub"] == str(user_id)
    assert decoded["role"] == "admin"


def test_invalid_token():
    """Ungültiger Token wird abgelehnt."""
    decoded = verify_token("invalid.token.here")
    assert decoded is None

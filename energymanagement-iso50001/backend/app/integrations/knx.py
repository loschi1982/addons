"""
knx.py – KNX-Integration.

Liest Energiedaten über KNX/IP (via xknx-Bibliothek).
KNX wird häufig in Gewerbegebäuden für Gebäudeautomation eingesetzt.
"""

from decimal import Decimal

import structlog

logger = structlog.get_logger()


class KNXClient:
    """Client für KNX/IP-Kommunikation."""

    def __init__(self, gateway_ip: str, gateway_port: int = 3671):
        self.gateway_ip = gateway_ip
        self.gateway_port = gateway_port

    async def connect(self) -> None:
        """Verbindung zum KNX/IP-Gateway herstellen."""
        # TODO: xknx-Bibliothek verwenden
        raise NotImplementedError

    async def disconnect(self) -> None:
        """Verbindung trennen."""
        raise NotImplementedError

    async def read_group_address(self, group_address: str) -> Decimal:
        """Wert von einer KNX-Gruppenadresse lesen."""
        # TODO: Implementierung mit xknx
        raise NotImplementedError

    async def subscribe_group_address(self, group_address: str, callback) -> None:
        """Änderungen auf einer Gruppenadresse abonnieren."""
        raise NotImplementedError

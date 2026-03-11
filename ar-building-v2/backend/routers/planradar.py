# Router für den PlanRadar-Proxy und die PlanRadar-Konfiguration.
# Endpunkte:
#   GET  /api/planradar/projects                              – Projekte abrufen (Proxy)
#   GET  /api/planradar/projects/{project_id}/list-fields     – NEU: Listenfelder eines Projekts (Hilfsendpunkt)
#   GET  /api/planradar/lists                                 – Listen eines Projekts abrufen (Proxy)
#   GET  /api/planradar/lists/{list_id}/entries               – Listeneinträge abrufen (Proxy)
#   GET  /api/planradar/project-roles                         – Rollenzuordnungen laden (DB)
#   PUT  /api/planradar/project-roles                         – Rollenzuordnungen speichern (DB)
#   GET  /api/planradar/mappings                              – Marker-Mappings laden (DB)
#   POST /api/planradar/mappings                              – Marker-Mapping anlegen/aktualisieren (DB)
#   DELETE /api/planradar/mappings/{mapping_id}               – Mapping löschen (DB)
#   GET  /api/planradar/tickets                               – Tickets laden (Proxy, mit marker_id-Logik)
#   PUT  /api/planradar/tickets/{ticket_id}/status            – Ticket-Status setzen (Proxy)

import aiohttp
import aiohttp.resolver
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from backend.auth import require_roles, require_admin
from backend.config import load_settings
from backend.database import get_db
from backend.models.planradar import PlanRadarProjectRole, PlanRadarMapping
from backend.schemas.planradar import (
    PlanRadarProject,
    PlanRadarList,
    PlanRadarListEntry,
    PlanRadarProjectRole as PlanRadarProjectRoleSchema,
    PlanRadarMappingCreate,
    PlanRadarMapping as PlanRadarMappingSchema,
)

router = APIRouter()

# In-Memory-Cache: ticket_uuid → planradar_project_id.
# Wird beim Laden der Tickets (GET /tickets) befüllt.
# Ermöglicht Status- und Kommentar-Endpunkten die project_id nachzuschlagen
# ohne dass das Frontend sie mitschicken muss.
# Kein persistenter Speicher nötig — die project_id ändert sich nie für ein Ticket.
_ticket_project_cache: dict[str, str] = {}

PLANRADAR_API_V1 = "https://planradar.com/api/v1"
PLANRADAR_API_V2 = "https://planradar.com/api/v2"

# Eigener DNS-Resolver mit externem DNS (Google + Cloudflare).
_resolver = aiohttp.resolver.AsyncResolver(nameservers=["8.8.8.8", "1.1.1.1"])
_connector = aiohttp.TCPConnector(resolver=_resolver, force_close=False)
_TIMEOUT = aiohttp.ClientTimeout(connect=10, total=30)


def _make_session() -> aiohttp.ClientSession:
    """Erstellt eine aiohttp-Session mit dem externen DNS-Connector."""
    return aiohttp.ClientSession(
        connector=_connector,
        connector_owner=False,
        timeout=_TIMEOUT,
    )


# Status-Mapping: Unser lesbarer Status → PlanRadar-interner Status-Code
REVERSE_STATUS_MAP = {
    "open":        "lm",
    "in_progress": "ol",
    "resolved":    "ma",
    "feedback":    "ex",
    "closed":      "gk",
    "rejected":    "ky",
}

# Status-Mapping: PlanRadar-interner Status-Code → Unser lesbarer Status
STATUS_MAP = {v: k for k, v in REVERSE_STATUS_MAP.items()}


# ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

def get_planradar_config() -> tuple[str, str, dict]:
    """Liest Token, Customer-ID und API-Header aus den Einstellungen.
    Wirft 400 wenn Token oder Customer-ID fehlen."""
    settings = load_settings()
    token = settings.get("planradar_token", "")
    customer_id = settings.get("planradar_customer_id", "")
    if not token or not customer_id:
        raise HTTPException(
            status_code=400,
            detail="PlanRadar-Token oder Customer-ID nicht konfiguriert",
        )
    headers = {
        "X-PlanRadar-API-Key": token,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    return token, customer_id, headers


def normalize_project(raw: dict) -> dict:
    """Wandelt ein PlanRadar-Projekt im JSON:API-Format in unser Schema um."""
    attrs = raw.get("attributes", {})
    return {
        "id":     raw.get("id", ""),
        "name":   attrs.get("name", ""),
        "active": attrs.get("active", True),
    }


def normalize_list(raw: dict) -> dict:
    """Wandelt eine PlanRadar-Liste im JSON:API-Format in unser Schema um."""
    attrs = raw.get("attributes", {})
    return {
        "id":   raw.get("id", ""),
        "name": attrs.get("name", ""),
    }


def normalize_entry(raw: dict) -> dict:
    """Wandelt einen PlanRadar-Listeneintrag im JSON:API-Format in unser Schema um."""
    attrs = raw.get("attributes", {})
    return {
        "uuid": attrs.get("uuid") or raw.get("id", ""),
        "name": attrs.get("name", ""),
    }


# Prioritäts-Mapping: PlanRadar-interner Code → lesbarer String
PRIORITY_MAP = {
    "1": "low",
    "2": "normal",
    "3": "high",
    1:   "low",
    2:   "normal",
    3:   "high",
}


def normalize_ticket(raw: dict, project_id: str = "") -> dict:
    """Wandelt ein PlanRadar-Ticket im JSON:API-Format in unser Schema um.
    Liefert alle darstellbaren Felder — project_id wird mitgeliefert damit das
    Frontend sie für Status- und Kommentar-Calls zurückschicken kann."""
    attrs = raw.get("attributes", {})
    status_id   = attrs.get("status-id", "")
    priority_id = attrs.get("priority-id") or attrs.get("priority_id")

    # Zugewiesene Person: entweder Objekt mit name-Feld oder nur ID-String
    assigned = attrs.get("assigned-to") or attrs.get("assigned_to")
    assignee_name = None
    if isinstance(assigned, dict):
        assignee_name = assigned.get("name") or assigned.get("full-name")
    elif isinstance(assigned, str):
        assignee_name = assigned

    # Ersteller: analog zu assignee
    author_raw = attrs.get("author") or attrs.get("created-by")
    author_name = None
    if isinstance(author_raw, dict):
        author_name = author_raw.get("name") or author_raw.get("full-name")
    elif isinstance(author_raw, str):
        author_name = author_raw

    return {
        "id":          attrs.get("uuid") or raw.get("id", ""),
        "title":       attrs.get("subject", ""),
        "description": attrs.get("description") or "",
        "status":      STATUS_MAP.get(status_id, "open"),
        "priority":    PRIORITY_MAP.get(priority_id, "normal"),
        "progress":    attrs.get("progress"),           # 0–100 oder None
        "due_date":    attrs.get("due-date"),           # ISO-String oder None
        "created_at":  attrs.get("created-at", ""),
        "updated_at":  attrs.get("updated-at"),         # ISO-String oder None
        "closed_at":   attrs.get("closed-at"),          # ISO-String oder None
        "assignee":    assignee_name,
        "author":      author_name,
        "project_id":  project_id,
    }


def map_ticket(raw: dict) -> dict:
    """Wandelt ein rohes PlanRadar-Ticket in unser Schema um.
    Unterstützt JSON:API- und Legacy-Format."""
    if "attributes" in raw:
        return normalize_ticket(raw)
    return {
        "id":          str(raw.get("id", "")),
        "title":       raw.get("title", ""),
        "description": raw.get("description", "") or "",
        "status":      raw.get("status", ""),
        "created_at":  raw.get("created_at", ""),
        "assignee":    raw.get("assignee", {}).get("name")
                       if isinstance(raw.get("assignee"), dict) else raw.get("assignee"),
    }


async def resolve_marker_to_project(
    db: AsyncSession,
    marker_id: str,
    user_role: str,
) -> Optional[PlanRadarMapping]:
    """Sucht das Marker-Mapping in der DB und prüft die Rollenberechtigung.
    Gibt None zurück wenn kein Mapping existiert oder die Rolle keinen Zugriff hat."""
    result = await db.execute(
        select(PlanRadarMapping).where(PlanRadarMapping.ar_marker_id == marker_id)
    )
    mapping = result.scalar_one_or_none()
    if not mapping:
        return None

    # Mapping-eigene Rollen haben Vorrang vor Projekt-Rollen.
    mapping_roles = mapping.roles_list
    if mapping_roles:
        if user_role not in mapping_roles:
            return None
        return mapping

    # Keine Mapping-eigenen Rollen → Projekt-Rollenzuordnung prüfen.
    role_result = await db.execute(
        select(PlanRadarProjectRole).where(
            PlanRadarProjectRole.planradar_project_id == mapping.planradar_project_id
        )
    )
    project_role = role_result.scalar_one_or_none()
    if project_role:
        configured_roles = project_role.roles_list
        if configured_roles and user_role not in configured_roles:
            return None

    return mapping


async def fetch_list_field_key(
    customer_id: str,
    project_id: str,
    list_id: str,
    headers: dict,
) -> Optional[str]:
    """Ermittelt automatisch den typed-values-Feldschlüssel (z.B. 'tf37e04757...')
    für eine bestimmte Liste innerhalb eines Projekts.

    Ablauf:
    1. Alle Ticket-Typen des Projekts laden (inkl. verknüpfter Listen).
    2. In den 'included'-Einträgen nach dem Eintrag suchen, dessen list-id
       zu unserer list_id passt.
    3. Den zugehörigen field-name zurückgeben — das ist der Key in typed-values.

    Gibt None zurück wenn kein passender Feldschlüssel gefunden wurde."""
    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{project_id}/ticket_types/lists/"
    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, ssl=True) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
    except aiohttp.ClientError:
        return None

    # Die API liefert eine Liste von Ticket-Type-Projekten mit 'included'-Einträgen.
    # Jeder 'included'-Eintrag vom Typ 'lists-ticket-types' enthält list-id + field-name.
    items = data if isinstance(data, list) else data.get("data", [])
    for item in items:
        included = item.get("included", []) if isinstance(item, dict) else []
        for inc in included:
            if not isinstance(inc, dict):
                continue
            attrs = inc.get("attributes", {})
            if attrs.get("list-id") == list_id:
                field_name = attrs.get("field-name")
                if field_name:
                    return field_name

    return None


# ─── 1. Projekte abrufen ──────────────────────────────────────────────────────

@router.get("/projects", response_model=list[PlanRadarProject])
async def get_projects(_user=Depends(require_admin())):
    """Alle PlanRadar-Projekte des Accounts abrufen."""
    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V1}/{customer_id}/projects"
    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="Ungültiger PlanRadar API-Key")
                if resp.status == 429:
                    raise HTTPException(status_code=502, detail="PlanRadar Rate Limit erreicht")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"PlanRadar nicht erreichbar: {e}")

    items = data.get("data", data) if isinstance(data, dict) else data
    return [normalize_project(p) for p in items]


# ─── 1b. Listenfelder eines Projekts abrufen (Hilfsendpunkt für Admin) ────────

@router.get("/projects/{project_id}/list-fields")
async def get_project_list_fields(
    project_id: str,
    _user=Depends(require_admin()),
):
    """NEU: Alle Listen-Formularfelder eines Projekts abrufen.
    Gibt für jedes Custom-List-Feld den field-name (typed-values-Key),
    die list-id und den lesbaren Namen zurück.

    Der Admin benötigt diese Infos beim Anlegen eines Mappings:
    Er sieht welches Feld ('Raum', 'Anlage', ...) zu welcher Liste gehört
    und kann das Mapping korrekt konfigurieren.

    Beispielantwort:
    [
      { "field_key": "tf37e04757dabbca63", "list_id": "ab12", "field_label": "Raum" }
    ]
    """
    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{project_id}/ticket_types/lists/"
    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="Ungültiger PlanRadar API-Key")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Projekt nicht gefunden")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"PlanRadar nicht erreichbar: {e}")

    # Alle included-Einträge vom Typ 'lists-ticket-types' sammeln.
    # Jeder Eintrag beschreibt ein Formularfeld, das auf eine Custom-Liste zeigt.
    fields = []
    seen_keys: set[str] = set()  # Duplikate vermeiden (mehrere Ticket-Typen können dieselbe Liste nutzen)

    items = data if isinstance(data, list) else data.get("data", [])
    for item in items:
        included = item.get("included", []) if isinstance(item, dict) else []
        for inc in included:
            if not isinstance(inc, dict):
                continue
            attrs = inc.get("attributes", {})
            field_key = attrs.get("field-name", "")
            list_id   = attrs.get("list-id", "")
            if not field_key or field_key in seen_keys:
                continue
            seen_keys.add(field_key)
            fields.append({
                "field_key":   field_key,   # z.B. "tf37e04757dabbca63" — wird zum Filtern genutzt
                "list_id":     list_id,     # z.B. "ab12" — entspricht planradar_list_id im Mapping
                "field_label": attrs.get("name", field_key),  # lesbarer Name des Feldes
            })

    return fields


# ─── 2. Listen abrufen ────────────────────────────────────────────────────────

@router.get("/lists", response_model=list[PlanRadarList])
async def get_lists(
    project_id: Optional[str] = Query(None),
    _user=Depends(require_admin()),
):
    """Alle Custom-Listen eines PlanRadar-Projekts abrufen."""
    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V1}/{customer_id}/lists/"
    params = {}
    if project_id:
        params["project_id"] = project_id
    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, params=params, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="Ungültiger PlanRadar API-Key")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"PlanRadar nicht erreichbar: {e}")

    items = data.get("data", data) if isinstance(data, dict) else data
    return [normalize_list(lst) for lst in items]


# ─── 3. Listeneinträge abrufen ────────────────────────────────────────────────

@router.get("/lists/{list_id}/entries", response_model=list[PlanRadarListEntry])
async def get_list_entries(
    list_id: str,
    _user=Depends(require_admin()),
):
    """Alle Einträge einer PlanRadar-Liste abrufen (z.B. einzelne Räume oder Anlagen)."""
    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V1}/{customer_id}/lists/{list_id}"
    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="Ungültiger PlanRadar API-Key")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Liste nicht gefunden")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"PlanRadar nicht erreichbar: {e}")

    # PlanRadar gibt Einträge in "included" zurück, nicht in "data".
    candidates: list = []
    if isinstance(data, dict):
        included = data.get("included")
        if isinstance(included, list) and included:
            candidates = included
        else:
            for key in ("data", "entries", "list_entries", "items"):
                val = data.get(key)
                if isinstance(val, list) and val:
                    candidates = val
                    break
    elif isinstance(data, list):
        candidates = data

    return [normalize_entry(item) for item in candidates if isinstance(item, dict)]


# ─── 4. Projekt-Rollenzuordnungen laden ───────────────────────────────────────

@router.get("/project-roles", response_model=list[PlanRadarProjectRoleSchema])
async def get_project_roles(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Alle gespeicherten Rollenzuordnungen für PlanRadar-Projekte laden."""
    result = await db.execute(select(PlanRadarProjectRole))
    rows = result.scalars().all()
    return [
        PlanRadarProjectRoleSchema(
            project_id=r.planradar_project_id,
            visible_to_roles=r.roles_list,
        )
        for r in rows
    ]


# ─── 5. Projekt-Rollenzuordnungen speichern (Upsert) ─────────────────────────

@router.put("/project-roles", response_model=list[PlanRadarProjectRoleSchema])
async def save_project_roles(
    body: list[PlanRadarProjectRoleSchema],
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Rollenzuordnungen speichern. Bestehende werden überschrieben (Upsert per project_id)."""
    for item in body:
        result = await db.execute(
            select(PlanRadarProjectRole).where(
                PlanRadarProjectRole.planradar_project_id == item.project_id
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.roles_list = item.visible_to_roles
        else:
            new_role = PlanRadarProjectRole(planradar_project_id=item.project_id)
            new_role.roles_list = item.visible_to_roles
            db.add(new_role)

    await db.commit()

    result = await db.execute(select(PlanRadarProjectRole))
    rows = result.scalars().all()
    return [
        PlanRadarProjectRoleSchema(
            project_id=r.planradar_project_id,
            visible_to_roles=r.roles_list,
        )
        for r in rows
    ]


# ─── 6. Marker-Mappings laden ─────────────────────────────────────────────────

@router.get("/mappings", response_model=list[PlanRadarMappingSchema])
async def get_mappings(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Alle gespeicherten Marker-Mappings laden (PlanRadar-Eintrag ↔ AR-Marker)."""
    result = await db.execute(select(PlanRadarMapping))
    rows = result.scalars().all()
    return [
        PlanRadarMappingSchema(
            id=r.id,
            planradar_project_id=r.planradar_project_id,
            planradar_list_id=r.planradar_list_id,
            planradar_entry_uuid=r.planradar_entry_uuid,
            planradar_entry_name=r.planradar_entry_name,
            ar_marker_id=r.ar_marker_id,
            visible_to_roles=r.roles_list,
        )
        for r in rows
    ]


# ─── 7. Marker-Mapping anlegen / aktualisieren (Upsert) ──────────────────────

@router.post("/mappings", response_model=PlanRadarMappingSchema, status_code=201)
async def create_or_update_mapping(
    body: PlanRadarMappingCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Mapping anlegen oder aktualisieren (Upsert per ar_marker_id)."""
    result = await db.execute(
        select(PlanRadarMapping).where(PlanRadarMapping.ar_marker_id == body.ar_marker_id)
    )
    existing = result.scalar_one_or_none()

    if existing:
        existing.planradar_project_id  = body.planradar_project_id
        existing.planradar_list_id     = body.planradar_list_id
        existing.planradar_entry_uuid  = body.planradar_entry_uuid
        existing.planradar_entry_name  = body.planradar_entry_name
        existing.roles_list            = body.visible_to_roles
        await db.commit()
        mapping = existing
    else:
        mapping = PlanRadarMapping(
            planradar_project_id = body.planradar_project_id,
            planradar_list_id    = body.planradar_list_id,
            planradar_entry_uuid = body.planradar_entry_uuid,
            planradar_entry_name = body.planradar_entry_name,
            ar_marker_id         = body.ar_marker_id,
        )
        mapping.roles_list = body.visible_to_roles
        db.add(mapping)
        await db.commit()

    return PlanRadarMappingSchema(
        id=mapping.id,
        planradar_project_id=mapping.planradar_project_id,
        planradar_list_id=mapping.planradar_list_id,
        planradar_entry_uuid=mapping.planradar_entry_uuid,
        planradar_entry_name=mapping.planradar_entry_name,
        ar_marker_id=mapping.ar_marker_id,
        visible_to_roles=mapping.roles_list,
    )


# ─── 8. Mapping löschen ───────────────────────────────────────────────────────

@router.delete("/mappings/{mapping_id}", status_code=204)
async def delete_mapping(
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Mapping löschen. Gibt 204 No Content zurück."""
    result = await db.execute(
        select(PlanRadarMapping).where(PlanRadarMapping.id == mapping_id)
    )
    mapping = result.scalar_one_or_none()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.delete(mapping)
    await db.commit()


# ─── 9. Tickets laden (mit marker_id-Logik + Listeneintrag-Filter) ────────────

@router.get("/tickets")
async def get_tickets(
    marker_id: Optional[str] = Query(None),
    room_id: Optional[int] = Query(None),
    object_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_roles("staff", "technician", "admin")),
):
    """PlanRadar-Tickets laden.

    Bei marker_id (neue Logik):
      1. Mapping in planradar_mappings nachschlagen
      2. Kein Mapping → leere Liste (kein Fehler)
      3. Rollencheck — kein Zugriff → leere Liste (kein Fehler)
      4. typed-values-Feldschlüssel für planradar_list_id automatisch ermitteln
      5. Alle Tickets des Projekts laden
      6. Nach planradar_entry_uuid im ermittelten Feld filtern
         Falls kein Feldschlüssel gefunden → alle Tickets des Projekts zurückgeben

    Bei room_id / object_id: Legacy-Logik (unverändert).
    """
    user_role = current_user.get("role") if isinstance(current_user, dict) else getattr(current_user, "role", None)

    # ── Neue Logik: marker_id übergeben ──────────────────────────────────────
    if marker_id is not None:
        # Schritt 1+2: Mapping nachschlagen, Rollencheck
        mapping = await resolve_marker_to_project(db, marker_id, user_role)
        if mapping is None:
            # Kein Mapping oder keine Berechtigung → leere Liste, kein Fehler
            return []

        _, customer_id, headers = get_planradar_config()

        # Schritt 3: typed-values-Feldschlüssel für die im Mapping hinterlegte Liste ermitteln.
        # Das ist der projektspezifische Hash (z.B. "tf37e04757dabbca63"), der im Ticket
        # unter typed-values als Key für den Raumwert steht.
        field_key = None
        if mapping.planradar_list_id:
            field_key = await fetch_list_field_key(
                customer_id=customer_id,
                project_id=mapping.planradar_project_id,
                list_id=mapping.planradar_list_id,
                headers=headers,
            )

        # Schritt 4: Alle Tickets des Projekts laden.
        url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{mapping.planradar_project_id}/tickets"
        try:
            async with _make_session() as session:
                async with session.get(url, headers=headers, ssl=True) as resp:
                    if resp.status == 401:
                        raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                    if resp.status != 200:
                        raise HTTPException(status_code=502, detail="PlanRadar API error")
                    data = await resp.json()
        except aiohttp.ClientError as e:
            raise HTTPException(status_code=502, detail=f"Cannot reach PlanRadar: {e}")

        items = data.get("data", data) if isinstance(data, dict) else data

        # Schritt 5: Clientseitig nach Listeneintrag filtern.
        if field_key and mapping.planradar_entry_uuid:
            # Nur Tickets zurückgeben, bei denen typed-values[field_key] == planradar_entry_uuid.
            # PlanRadar speichert den Listeneintrag als UUID-String im typed-values-Objekt.
            filtered = []
            for t in items:
                typed = t.get("attributes", {}).get("typed-values", {})
                if typed.get(field_key) == mapping.planradar_entry_uuid:
                    filtered.append(t)
            items = filtered
        # Kein field_key gefunden → Fallback: alle Tickets des Projekts zurückgeben (kein Filter)

        pid = mapping.planradar_project_id
        result = [normalize_ticket(t, project_id=pid) for t in items]

        # Cache befüllen: ticket_uuid → project_id.
        # Damit braucht das Frontend project_id nicht mitzuschicken.
        for t in result:
            if t.get("id"):
                _ticket_project_cache[t["id"]] = pid

        return result

    # ── Legacy-Logik: room_id / object_id ────────────────────────────────────
    settings = load_settings()
    token = settings.get("planradar_token", "")
    if not token:
        raise HTTPException(status_code=503, detail="PlanRadar not configured")

    params: dict = {}
    if room_id is not None:
        params["room_id"] = room_id
    if object_id is not None:
        params["object_id"] = object_id

    legacy_headers = {"Authorization": f"Token {token}", "Content-Type": "application/json"}
    try:
        async with _make_session() as session:
            async with session.get(
                f"{PLANRADAR_API_V2}/tickets",
                headers=legacy_headers,
                params=params,
                ssl=True,
            ) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=503, detail=f"Cannot reach PlanRadar: {e}")

    tickets_raw = data if isinstance(data, list) else data.get("tickets", data.get("data", []))
    return [map_ticket(t) for t in tickets_raw]


@router.put("/tickets/{ticket_id}/status")
async def update_ticket_status(
    ticket_id: str,
    body: dict,
    project_id: Optional[str] = Query(None),
    _user=Depends(require_roles("technician", "admin")),
):
    """Setzt den Status eines PlanRadar-Tickets.
    Mappt unseren lesbaren Status (z.B. 'open') auf den PlanRadar-internen Code (z.B. 'lm').

    project_id kann als Query-Parameter übergeben werden.
    Falls nicht, wird sie aus dem In-Memory-Cache nachgeschlagen (befüllt beim Ticket-Laden)."""
    new_status = body.get("status")
    if new_status not in REVERSE_STATUS_MAP:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status value. Allowed: {', '.join(REVERSE_STATUS_MAP.keys())}",
        )

    # project_id aus Cache holen falls nicht als Parameter übergeben.
    pid = project_id or _ticket_project_cache.get(ticket_id)
    if not pid:
        raise HTTPException(
            status_code=400,
            detail="project_id nicht bekannt — bitte Tickets neu laden und erneut versuchen",
        )

    _, customer_id, headers = get_planradar_config()
    planradar_status = REVERSE_STATUS_MAP[new_status]

    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{pid}/tickets/{ticket_id}"
    payload = {"data": {"attributes": {"status-id": planradar_status}}}

    try:
        async with _make_session() as session:
            async with session.put(url, headers=headers, json=payload, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Ticket not found")
                if resp.status not in (200, 204):
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                if resp.status == 200:
                    data = await resp.json()
                    raw = data.get("data", data)
                    return normalize_ticket(raw, project_id=pid)
                return {"id": ticket_id, "status": new_status, "project_id": pid}
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach PlanRadar: {e}")


# ─── 12. Journals / Kommentare eines Tickets laden ────────────────────────────

@router.get("/tickets/{ticket_id}/journals")
async def get_ticket_journals(
    ticket_id: str,
    project_id: Optional[str] = Query(None),
    filter: Optional[str] = Query(None, description="1=Kommentare, 2=Medien, 3=Änderungshistorie"),
    _user=Depends(require_roles("staff", "technician", "admin")),
):
    """Journals (Kommentare + Änderungshistorie) eines Tickets laden.
    Wird vom Frontend beim Öffnen eines Tickets aufgerufen.

    project_id kann als Query-Parameter übergeben werden.
    Falls nicht, wird sie aus dem In-Memory-Cache nachgeschlagen.

    filter-Werte: 1=nur Kommentare, 2=nur Medien, 3=nur Änderungshistorie.
    Ohne filter: alle Journal-Einträge.

    Gibt normalisierte Journal-Objekte zurück:
    { id, type, text, author, created_at }
    """
    pid = project_id or _ticket_project_cache.get(ticket_id)
    if not pid:
        raise HTTPException(
            status_code=400,
            detail="project_id nicht bekannt — bitte Tickets neu laden und erneut versuchen",
        )

    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{pid}/tickets/{ticket_id}/journals"
    params = {"pagesize": 500}
    if filter:
        params["filter"] = filter

    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, params=params, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Ticket not found")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach PlanRadar: {e}")

    items = data.get("data", data) if isinstance(data, dict) else data

    # Journal-Einträge normalisieren.
    # PlanRadar unterscheidet: type 1=Kommentar, 2=Medien-Upload, 3=Statusänderung etc.
    result = []
    for j in items:
        if not isinstance(j, dict):
            continue
        attrs = j.get("attributes", j)  # Fallback falls kein JSON:API-Format
        author_raw = attrs.get("author") or attrs.get("created-by", {})
        author_name = (
            author_raw.get("name") or author_raw.get("full-name")
            if isinstance(author_raw, dict) else str(author_raw or "")
        )
        result.append({
            "id":         str(j.get("id", "")),
            "type":       attrs.get("journal-type") or attrs.get("type"),  # 1/2/3
            "text":       attrs.get("comment") or attrs.get("notes") or "",
            "author":     author_name,
            "created_at": attrs.get("created-on") or attrs.get("created-at", ""),
        })

    return result


# ─── 13. Attachments eines Tickets laden ──────────────────────────────────────

@router.get("/tickets/{ticket_id}/attachments")
async def get_ticket_attachments(
    ticket_id: str,
    project_id: Optional[str] = Query(None),
    types: Optional[str] = Query(None, description="Kommagetrennt: images,audios,videos,documents"),
    _user=Depends(require_roles("staff", "technician", "admin")),
):
    """Attachments (Bilder, Dokumente, Audio, Video) eines Tickets laden.
    Wird vom Frontend beim Öffnen eines Tickets aufgerufen.

    project_id kann als Query-Parameter übergeben werden.
    Falls nicht, wird sie aus dem In-Memory-Cache nachgeschlagen.

    types: kommagetrennte Liste z.B. 'images,documents' — ohne Angabe alle Typen.

    Gibt normalisierte Attachment-Objekte zurück:
    { id, type, filename, url, caption, created_at }
    """
    pid = project_id or _ticket_project_cache.get(ticket_id)
    if not pid:
        raise HTTPException(
            status_code=400,
            detail="project_id nicht bekannt — bitte Tickets neu laden und erneut versuchen",
        )

    _, customer_id, headers = get_planradar_config()
    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{pid}/tickets/{ticket_id}/attachments"
    params: dict = {"pagesize": 500, "only_ticket_attachments": "true"}
    if types:
        # PlanRadar erwartet types[] als wiederholten Query-Parameter.
        # aiohttp unterstützt das über eine Liste von Tuples.
        params = [
            ("pagesize", "500"),
            ("only_ticket_attachments", "true"),
            *[("types[]", t.strip()) for t in types.split(",") if t.strip()],
        ]

    try:
        async with _make_session() as session:
            async with session.get(url, headers=headers, params=params, ssl=True) as resp:
                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Ticket not found")
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="PlanRadar API error")
                data = await resp.json()
    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach PlanRadar: {e}")

    items = data.get("data", data) if isinstance(data, dict) else data

    # Attachments normalisieren.
    result = []
    for a in items:
        if not isinstance(a, dict):
            continue
        attrs = a.get("attributes", a)
        result.append({
            "id":         str(a.get("id", "")),
            "type":       attrs.get("attachable-type") or attrs.get("attachment-type", ""),
            "filename":   attrs.get("attachment-file-name") or attrs.get("filename", ""),
            "url":        attrs.get("attachment-url") or attrs.get("url") or attrs.get("file-url", ""),
            "caption":    attrs.get("caption", ""),
            "created_at": attrs.get("created-at", ""),
        })

    return result


# ─── 11. Kommentar zu einem Ticket hinzufügen ─────────────────────────────────

@router.post("/tickets/{ticket_id}/comment", status_code=201)
async def add_ticket_comment(
    ticket_id: str,
    body: dict,
    project_id: Optional[str] = Query(None),
    _user=Depends(require_roles("staff", "technician", "admin")),
):
    """Fügt einen Kommentar zu einem PlanRadar-Ticket hinzu.

    PlanRadar stellt keinen separaten /comment-Endpunkt bereit (liefert HTML-404).
    Kommentare werden stattdessen über den Ticket-Update-Endpunkt (PUT) gesetzt,
    indem 'notes' im Attribut-Objekt mitgeschickt wird — das erzeugt einen
    Journal-Eintrag vom Typ 1 (Kommentar).

    project_id kann als Query-Parameter übergeben werden.
    Falls nicht, wird sie aus dem In-Memory-Cache nachgeschlagen.

    Request-Body: { "comment": "Text des Kommentars" }"""
    comment_text = body.get("comment", "")
    if not comment_text:
        raise HTTPException(status_code=400, detail="Kommentartext fehlt")

    pid = project_id or _ticket_project_cache.get(ticket_id)
    if not pid:
        raise HTTPException(
            status_code=400,
            detail="project_id nicht bekannt — bitte Tickets neu laden und erneut versuchen",
        )

    _, customer_id, headers = get_planradar_config()

    # PlanRadar-Kommentar = 'notes'-Feld im Ticket-PUT.
    # Das erzeugt intern einen Journal-Eintrag (Typ 1 = Kommentar).
    url = f"{PLANRADAR_API_V2}/{customer_id}/projects/{pid}/tickets/{ticket_id}"
    payload = {"data": {"attributes": {"notes": comment_text}}}

    try:
        async with _make_session() as session:
            async with session.put(url, headers=headers, json=payload, ssl=True) as resp:
                raw_body = await resp.text()

                import logging
                logging.getLogger("planradar").info(
                    "comment via PUT | url=%s status=%s", url, resp.status
                )

                if resp.status == 401:
                    raise HTTPException(status_code=502, detail="PlanRadar authentication failed")
                if resp.status == 404:
                    raise HTTPException(status_code=404, detail="Ticket not found")
                if resp.status not in (200, 201, 204):
                    raise HTTPException(
                        status_code=502,
                        detail=f"PlanRadar API error {resp.status}: {raw_body[:200]}",
                    )

                try:
                    import json as _json
                    data = _json.loads(raw_body)
                    raw = data.get("data", data)
                    if isinstance(raw, dict) and "attributes" in raw:
                        return normalize_ticket(raw, project_id=pid)
                except Exception:
                    pass

                return {"ticket_id": ticket_id, "comment": comment_text, "project_id": pid}

    except aiohttp.ClientError as e:
        raise HTTPException(status_code=502, detail=f"Cannot reach PlanRadar: {e}")
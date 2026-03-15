# Router für das CAFM-Modul (Technische Anlagen, Wartung, Dokumente).

import os
import shutil
from datetime import datetime, date
from dateutil.relativedelta import relativedelta

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from backend.database import get_db
from backend.auth import require_any_role, require_admin, require_roles
from backend.models.object import Object
from backend.models.cafm import PlantData, PlantDocument, MaintenanceSchedule, MaintenanceLog
from backend.schemas.cafm import (
    PlantDataRead, PlantDataCreate,
    PlantDocumentRead,
    ScheduleRead, ScheduleCreate,
    LogRead, LogCreate,
    VDMATemplate,
)
from backend.vdma_templates import (
    get_template_for_kg, get_all_templates,
    get_varianten_for_kg, get_checklist_for_variante,
)

router = APIRouter(redirect_slashes=False)

UPLOAD_BASE = "/data/uploads/cafm"


# ─── Hilfsfunktionen ─────────────────────────────────────────────────────────

async def _get_plant(db: AsyncSession, object_id: int) -> PlantData:
    """Lädt PlantData für ein Objekt oder wirft 404."""
    result = await db.execute(
        select(PlantData)
        .options(
            selectinload(PlantData.documents),
            selectinload(PlantData.schedules).selectinload(MaintenanceSchedule.logs),
            selectinload(PlantData.logs),
        )
        .where(PlantData.object_id == object_id)
    )
    plant = result.scalar_one_or_none()
    if plant is None:
        raise HTTPException(status_code=404, detail="Keine Anlagendaten für dieses Objekt")
    return plant


async def _get_schedule(db: AsyncSession, schedule_id: int) -> MaintenanceSchedule:
    result = await db.execute(
        select(MaintenanceSchedule)
        .options(selectinload(MaintenanceSchedule.logs))
        .where(MaintenanceSchedule.id == schedule_id)
    )
    schedule = result.scalar_one_or_none()
    if schedule is None:
        raise HTTPException(status_code=404, detail="Wartungsplan nicht gefunden")
    return schedule


# ─── VDMA-Vorlagen ───────────────────────────────────────────────────────────

@router.get("/vdma-templates", response_model=list[VDMATemplate])
async def list_vdma_templates(_user=Depends(require_any_role())):
    """Alle VDMA-Vorlagen mit Checklisten."""
    return get_all_templates()


@router.get("/vdma-templates/{kg}", response_model=VDMATemplate)
async def get_vdma_template(kg: str, _user=Depends(require_any_role())):
    """VDMA-Vorlage für eine bestimmte Kostengruppe."""
    tpl = get_template_for_kg(kg)
    if tpl is None:
        raise HTTPException(status_code=404, detail=f"Keine Vorlage für KG {kg}")
    return tpl


@router.get("/vdma-templates/{kg}/varianten/{variante_key}")
async def get_vdma_variante_checklist(
    kg: str, variante_key: str,
    _user=Depends(require_any_role()),
):
    """Wartungscheckliste für eine bestimmte Anlagenvariante."""
    checklist = get_checklist_for_variante(kg, variante_key)
    if checklist is None:
        raise HTTPException(
            status_code=404,
            detail=f"Keine Variante '{variante_key}' für KG {kg}",
        )
    return checklist


# ─── Anlagenstammdaten ───────────────────────────────────────────────────────

@router.get("/plants", response_model=list[PlantDataRead])
async def list_plants(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    """Alle Anlagen mit Dokumenten, Wartungsplänen und Protokollen."""
    result = await db.execute(
        select(PlantData)
        .options(
            selectinload(PlantData.documents),
            selectinload(PlantData.schedules),
            selectinload(PlantData.logs),
        )
    )
    return result.scalars().all()


@router.get("/plants/{object_id}", response_model=PlantDataRead)
async def get_plant(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Anlagendaten eines Objekts."""
    return await _get_plant(db, object_id)


@router.post("/plants/{object_id}", response_model=PlantDataRead, status_code=201)
async def create_plant(
    object_id: int,
    body: PlantDataCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Anlagendaten für ein Objekt anlegen."""
    # Prüfen ob Objekt existiert.
    obj_result = await db.execute(select(Object).where(Object.id == object_id))
    if obj_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Objekt nicht gefunden")

    # Prüfen ob bereits Anlagendaten existieren.
    existing = await db.execute(select(PlantData).where(PlantData.object_id == object_id))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Anlagendaten existieren bereits")

    plant = PlantData(object_id=object_id, **body.model_dump())
    db.add(plant)
    await db.commit()
    return await _get_plant(db, object_id)


@router.put("/plants/{object_id}", response_model=PlantDataRead)
async def update_plant(
    object_id: int,
    body: PlantDataCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Anlagendaten bearbeiten."""
    plant = await _get_plant(db, object_id)
    for key, value in body.model_dump().items():
        setattr(plant, key, value)
    await db.commit()
    return await _get_plant(db, object_id)


@router.delete("/plants/{object_id}", status_code=204)
async def delete_plant(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Anlagendaten löschen (inkl. Dokumente, Wartungspläne, Protokolle)."""
    plant = await _get_plant(db, object_id)
    # Dateien vom Dateisystem löschen.
    plant_dir = os.path.join(UPLOAD_BASE, str(object_id))
    if os.path.isdir(plant_dir):
        shutil.rmtree(plant_dir, ignore_errors=True)
    await db.delete(plant)
    await db.commit()


# ─── Dokumente ───────────────────────────────────────────────────────────────

@router.get("/plants/{object_id}/documents", response_model=list[PlantDocumentRead])
async def list_documents(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    plant = await _get_plant(db, object_id)
    return plant.documents


@router.post("/plants/{object_id}/documents", response_model=PlantDocumentRead, status_code=201)
async def upload_document(
    object_id: int,
    file: UploadFile = File(...),
    category: str = Form(...),
    description: str = Form(""),
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Dokument hochladen (category: 'anlagendoku' oder 'wartung')."""
    if category not in ("anlagendoku", "wartung"):
        raise HTTPException(status_code=400, detail="category muss 'anlagendoku' oder 'wartung' sein")

    plant = await _get_plant(db, object_id)

    # Datei speichern.
    sub_dir = "doku" if category == "anlagendoku" else "wartung"
    upload_dir = os.path.join(UPLOAD_BASE, str(object_id), sub_dir)
    os.makedirs(upload_dir, exist_ok=True)

    safe_name = file.filename.replace("/", "_").replace("\\", "_")
    file_path = os.path.join(upload_dir, safe_name)
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Relativer Pfad für die DB (wird über /uploads ausgeliefert).
    rel_path = f"/uploads/cafm/{object_id}/{sub_dir}/{safe_name}"

    doc = PlantDocument(
        plant_id=plant.id,
        category=category,
        filename=safe_name,
        file_path=rel_path,
        uploaded_at=datetime.now().isoformat(timespec="seconds"),
        description=description,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return doc


@router.delete("/documents/{doc_id}", status_code=204)
async def delete_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    result = await db.execute(select(PlantDocument).where(PlantDocument.id == doc_id))
    doc = result.scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Dokument nicht gefunden")

    # Datei löschen.
    abs_path = f"/data{doc.file_path}"
    if os.path.exists(abs_path):
        os.remove(abs_path)

    await db.delete(doc)
    await db.commit()


# ─── Wartungspläne ───────────────────────────────────────────────────────────

@router.get("/plants/{object_id}/schedules", response_model=list[ScheduleRead])
async def list_schedules(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    plant = await _get_plant(db, object_id)
    return plant.schedules


@router.post("/plants/{object_id}/schedules", response_model=ScheduleRead, status_code=201)
async def create_schedule(
    object_id: int,
    body: ScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    """Wartungsplan anlegen. Wenn keine Checkliste angegeben, wird die VDMA-Vorlage verwendet."""
    plant = await _get_plant(db, object_id)

    checklist = body.checklist
    if not checklist and plant.din276_kg:
        # Variante-spezifische Checkliste laden
        if plant.anlagen_variante:
            cl = get_checklist_for_variante(
                plant.din276_kg, plant.anlagen_variante
            )
            if cl:
                checklist = cl
        if not checklist:
            tpl = get_template_for_kg(plant.din276_kg)
            if tpl:
                checklist = tpl["checklist"]

    schedule = MaintenanceSchedule(
        plant_id=plant.id,
        title=body.title,
        interval_months=body.interval_months,
        next_due=body.next_due,
        active=body.active,
    )
    schedule.checklist = checklist
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    return schedule


@router.put("/schedules/{schedule_id}", response_model=ScheduleRead)
async def update_schedule(
    schedule_id: int,
    body: ScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    schedule = await _get_schedule(db, schedule_id)
    schedule.title = body.title
    schedule.interval_months = body.interval_months
    schedule.next_due = body.next_due
    schedule.active = body.active
    schedule.checklist = body.checklist
    await db.commit()
    return await _get_schedule(db, schedule_id)


@router.delete("/schedules/{schedule_id}", status_code=204)
async def delete_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_admin()),
):
    schedule = await _get_schedule(db, schedule_id)
    await db.delete(schedule)
    await db.commit()


# ─── Fällige Wartungen ───────────────────────────────────────────────────────

@router.get("/plants/{object_id}/due", response_model=list[ScheduleRead])
async def get_due_for_plant(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_any_role()),
):
    """Fällige Wartungen einer Anlage."""
    plant = await _get_plant(db, object_id)
    today = date.today().isoformat()
    return [s for s in plant.schedules if s.active and s.next_due <= today]


@router.get("/due", response_model=list[dict])
async def get_all_due(
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    """Alle fälligen Wartungen über alle Anlagen."""
    today = date.today().isoformat()
    result = await db.execute(
        select(MaintenanceSchedule)
        .options(selectinload(MaintenanceSchedule.plant))
        .where(MaintenanceSchedule.active == True)
        .where(MaintenanceSchedule.next_due <= today)
    )
    schedules = result.scalars().all()
    out = []
    for s in schedules:
        out.append({
            "schedule_id": s.id,
            "plant_id": s.plant_id,
            "object_id": s.plant.object_id if s.plant else None,
            "title": s.title,
            "next_due": s.next_due,
            "interval_months": s.interval_months,
        })
    return out


# ─── Wartung abschließen ─────────────────────────────────────────────────────

@router.post("/schedules/{schedule_id}/complete", response_model=LogRead)
async def complete_schedule(
    schedule_id: int,
    body: LogCreate,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles("technician", "admin")),
):
    """Wartungsprotokoll abschließen → PDF generieren, nächste Fälligkeit berechnen."""
    schedule = await _get_schedule(db, schedule_id)

    now_str = datetime.now().isoformat(timespec="seconds")
    today_str = date.today().isoformat()

    log = MaintenanceLog(
        plant_id=schedule.plant_id,
        schedule_id=schedule.id,
        technician=user["username"],
        performed_at=now_str,
        notes=body.notes,
    )
    log.results = body.results
    db.add(log)

    # Nächste Fälligkeit berechnen.
    try:
        next_due = date.fromisoformat(schedule.next_due) + relativedelta(months=schedule.interval_months)
    except Exception:
        next_due = date.today() + relativedelta(months=schedule.interval_months)
    schedule.next_due = next_due.isoformat()
    schedule.last_completed = today_str

    await db.commit()
    await db.refresh(log)

    # PDF generieren.
    try:
        from backend.pdf_generator import generate_maintenance_pdf

        # PlantData laden für PDF.
        plant_result = await db.execute(
            select(PlantData).where(PlantData.id == schedule.plant_id)
        )
        plant = plant_result.scalar_one_or_none()

        pdf_path = generate_maintenance_pdf(log, schedule, plant)
        log.pdf_path = pdf_path

        # PDF auch als Dokument in plant_documents ablegen.
        if plant:
            pdf_doc = PlantDocument(
                plant_id=plant.id,
                category="wartung",
                filename=os.path.basename(pdf_path),
                file_path=pdf_path,
                uploaded_at=now_str,
                description=f"Wartungsprotokoll: {schedule.title} ({today_str})",
            )
            db.add(pdf_doc)

        await db.commit()
        await db.refresh(log)
    except Exception as e:
        print(f"WARNUNG: PDF-Generierung fehlgeschlagen: {e}")

    return log


# ─── Wartungshistorie ────────────────────────────────────────────────────────

@router.get("/plants/{object_id}/logs", response_model=list[LogRead])
async def list_logs(
    object_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    plant = await _get_plant(db, object_id)
    return plant.logs


@router.get("/logs/{log_id}/pdf")
async def download_log_pdf(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    _user=Depends(require_roles("technician", "admin")),
):
    """PDF eines Wartungsprotokolls herunterladen."""
    result = await db.execute(select(MaintenanceLog).where(MaintenanceLog.id == log_id))
    log = result.scalar_one_or_none()
    if log is None:
        raise HTTPException(status_code=404, detail="Protokoll nicht gefunden")
    if not log.pdf_path:
        raise HTTPException(status_code=404, detail="Kein PDF vorhanden")

    abs_path = f"/data{log.pdf_path}"
    if not os.path.exists(abs_path):
        raise HTTPException(status_code=404, detail="PDF-Datei nicht gefunden")

    return FileResponse(abs_path, media_type="application/pdf", filename=os.path.basename(log.pdf_path))


# ─── PDF-Branding-Einstellungen ──────────────────────────────────────────────

PDF_SETTINGS_PATH = "/data/cafm_pdf_settings.json"

DEFAULT_PDF_SETTINGS = {
    "company_name": "",
    "header_line1": "",
    "header_line2": "",
    "footer_text": "Erstellt mit AR Building CAFM",
    "logo_path": "",
    "show_logo": True,
    "show_header": True,
    "show_footer": True,
}


def _load_pdf_settings() -> dict:
    import json as _json
    if os.path.exists(PDF_SETTINGS_PATH):
        try:
            with open(PDF_SETTINGS_PATH, "r") as f:
                data = _json.load(f)
            for k, v in DEFAULT_PDF_SETTINGS.items():
                if k not in data:
                    data[k] = v
            return data
        except Exception:
            pass
    return DEFAULT_PDF_SETTINGS.copy()


def _save_pdf_settings(settings: dict) -> dict:
    import json as _json
    os.makedirs(os.path.dirname(PDF_SETTINGS_PATH) or "/data", exist_ok=True)
    with open(PDF_SETTINGS_PATH, "w") as f:
        _json.dump(settings, f, indent=2)
    return settings


@router.get("/pdf-settings")
async def get_pdf_settings(_user=Depends(require_admin())):
    """PDF-Branding-Einstellungen laden."""
    return _load_pdf_settings()


@router.put("/pdf-settings")
async def update_pdf_settings(
    body: dict,
    _user=Depends(require_admin()),
):
    """PDF-Branding-Einstellungen speichern."""
    current = _load_pdf_settings()
    for key in DEFAULT_PDF_SETTINGS:
        if key in body:
            current[key] = body[key]
    return _save_pdf_settings(current)


@router.post("/pdf-settings/logo", status_code=201)
async def upload_pdf_logo(
    file: UploadFile = File(...),
    _user=Depends(require_admin()),
):
    """Logo für PDF-Protokolle hochladen (PNG/JPG, max 2 MB)."""
    if file.content_type not in ("image/png", "image/jpeg", "image/jpg"):
        raise HTTPException(status_code=400, detail="Nur PNG oder JPG erlaubt")

    content = await file.read()
    if len(content) > 2 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Datei zu groß (max. 2 MB)")

    logo_dir = "/data/uploads/cafm/branding"
    os.makedirs(logo_dir, exist_ok=True)

    ext = "png" if "png" in file.content_type else "jpg"
    logo_path = os.path.join(logo_dir, f"logo.{ext}")

    # Alte Logos entfernen.
    for old in ("logo.png", "logo.jpg"):
        old_path = os.path.join(logo_dir, old)
        if os.path.exists(old_path):
            os.remove(old_path)

    with open(logo_path, "wb") as f:
        f.write(content)

    # Pfad in Einstellungen speichern.
    settings = _load_pdf_settings()
    settings["logo_path"] = f"/uploads/cafm/branding/logo.{ext}"
    _save_pdf_settings(settings)

    return {"logo_path": settings["logo_path"]}


@router.delete("/pdf-settings/logo", status_code=204)
async def delete_pdf_logo(_user=Depends(require_admin())):
    """Logo löschen."""
    logo_dir = "/data/uploads/cafm/branding"
    for name in ("logo.png", "logo.jpg"):
        path = os.path.join(logo_dir, name)
        if os.path.exists(path):
            os.remove(path)
    settings = _load_pdf_settings()
    settings["logo_path"] = ""
    _save_pdf_settings(settings)

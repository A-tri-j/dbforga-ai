from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import ImportExecuteIn, ImportOut, ImportReport, ProfileOut
from app.core.config import settings
from app.core.db import get_db
from app.domain.models import DbConnection, User
from app.services import importer, introspection
from app.services.connections import friendly_error, get_engine

router = APIRouter(prefix="/imports", tags=["imports"])


def _meta(import_id: str, user: User) -> importer.ImportMeta:
    meta = importer.get_meta(import_id, user.id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Upload not found or expired. Upload the file again.")
    return meta


@router.post("", response_model=ImportOut, status_code=201)
async def upload(file: UploadFile, user: User = Depends(get_current_user)):
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.max_upload_mb} MB")
    try:
        meta = importer.save_upload(user.id, file.filename or "upload", data)
    except importer.ImportInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ImportOut(import_id=meta.id, filename=meta.filename, kind=meta.kind)


@router.get("/{import_id}/profile", response_model=ProfileOut)
def profile(import_id: str, sheet: str | None = None, user: User = Depends(get_current_user)):
    meta = _meta(import_id, user)
    try:
        df, info = importer.load_frame(meta, sheet)
    except importer.ImportInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return ProfileOut(
        import_id=meta.id, filename=meta.filename, kind=meta.kind,
        suggested_table_name=importer.suggest_table_name(meta.filename),
        **info, **importer.profile_frame(df, meta.kind),
    )


@router.post("/{import_id}/execute", response_model=ImportReport)
def execute(import_id: str, body: ImportExecuteIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required before writing to the database")
    meta = _meta(import_id, user)
    row = db.get(DbConnection, body.connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    try:
        df, _ = importer.load_frame(meta, body.sheet)
    except importer.ImportInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if any(m.source_index >= df.shape[1] for m in body.columns):
        raise HTTPException(status_code=400, detail="A mapped column does not exist in the file")
    targets = [m.target.lower() for m in body.columns]
    if len(set(targets)) != len(targets):
        raise HTTPException(status_code=400, detail="Two columns map to the same target column")

    try:
        engine = get_engine(row)
        if body.schema_name not in introspection.list_schemas(engine, row.engine):
            raise HTTPException(status_code=404, detail="Schema not found")
        sa_schema = body.schema_name if row.engine == "postgresql" else None
        display = f"{body.schema_name}.{body.table_name}" if row.engine == "postgresql" else body.table_name
        report = importer.run_import(
            engine=engine, kind=row.engine, sa_schema=sa_schema, display_table=display,
            table_name=body.table_name, mode=body.mode, df=df, maps=body.columns, on_error=body.on_error,
        )
    except HTTPException:
        raise
    except importer.ImportInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))
    return ImportReport(**report)


@router.delete("/{import_id}", status_code=204)
def remove(import_id: str, user: User = Depends(get_current_user)):
    importer.delete_import(import_id, user.id)
    return Response(status_code=204)

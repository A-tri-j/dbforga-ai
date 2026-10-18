from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.schemas import (
    ImportColumnMap, ImportReport, PdfConfirmIn, PdfConfirmOut, PdfExtractOut,
    PdfPreviewOut, PdfTableIn,
)
from app.core.config import settings
from app.core.db import get_db
from app.domain.models import DbConnection, User
from app.api.ratelimit import limit_user
from app.api.policy import require_writable
from app.services import importer, introspection, pdf_tables
from app.services.connections import friendly_error, get_engine

router = APIRouter(prefix="/pdf", tags=["pdf"])

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/extract", response_model=PdfExtractOut, dependencies=[Depends(limit_user("upload", 20, 600))])
async def extract(file: UploadFile, user: User = Depends(get_current_user)):
    limit = settings.max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.max_upload_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="This is not a PDF file")
    try:
        result = await run_in_threadpool(pdf_tables.extract_tables, data)  # the PDF is never stored
    except pdf_tables.PdfInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return PdfExtractOut(filename=Path(file.filename or "upload.pdf").name[:120], **result)


@router.post("/preview", response_model=PdfPreviewOut)
def preview(body: PdfTableIn, user: User = Depends(get_current_user)):
    try:
        df = pdf_tables.build_frame(body.headers, body.rows)
    except pdf_tables.PdfInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    prof = importer.profile_frame(df, "csv")
    return PdfPreviewOut(
        row_count=prof["row_count"], duplicate_row_count=prof["duplicate_row_count"],
        columns=prof["columns"], key_candidates=prof["key_candidates"],
    )


@router.post("/confirm", response_model=PdfConfirmOut)
def confirm(body: PdfConfirmIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Confirmation is required before writing to the database")
    require_writable(db, user.id, "PDF import")
    row = db.get(DbConnection, body.connection_id)
    if row is None or row.user_id != user.id:
        raise HTTPException(status_code=404, detail="Connection not found")
    try:
        # 1) table -> Excel file
        df = pdf_tables.build_frame(body.headers, body.rows)
        types = [c["inferred_type"] for c in importer.profile_frame(df, "csv")["columns"]]
        meta = importer.save_upload(user.id, f"{body.table_name}.xlsx", pdf_tables.build_xlsx(df, types))

        # 2) Excel file -> database table (same verified import as Day 7)
        df2, _ = importer.load_frame(meta)
        prof = importer.profile_frame(df2, "xlsx")
        maps = [ImportColumnMap(source_index=c["index"], target=c["name"], type=c["inferred_type"]) for c in prof["columns"]]
        engine = get_engine(row)
        if body.schema_name not in introspection.list_schemas(engine, row.engine):
            raise HTTPException(status_code=404, detail="Schema not found")
        sa_schema = body.schema_name if row.engine == "postgresql" else None
        display = f"{body.schema_name}.{body.table_name}" if row.engine == "postgresql" else body.table_name
        report = importer.run_import(
            engine=engine, kind=row.engine, sa_schema=sa_schema, display_table=display,
            table_name=body.table_name, mode="create", df=df2, maps=maps, on_error=body.on_error,
        )
    except HTTPException:
        raise
    except (pdf_tables.PdfInputError, importer.ImportInputError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=friendly_error(exc))

    queries = []
    if report["status"] == "ok":
        queries = pdf_tables.starter_queries(row.engine, body.schema_name, body.table_name, prof["columns"], prof["row_count"])
    return PdfConfirmOut(report=ImportReport(**report), xlsx_import_id=meta.id, table_name=body.table_name, queries=queries)


@router.get("/xlsx/{import_id}")
def download_xlsx(import_id: str, user: User = Depends(get_current_user)):
    meta = importer.get_meta(import_id, user.id)
    if meta is None or meta.kind != "xlsx":
        raise HTTPException(status_code=404, detail="File not found or expired")
    return FileResponse(meta.path, media_type=XLSX_MIME, filename=meta.filename)

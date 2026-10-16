from app.services import importer, pdf_tables as pt


def test_normalize_drops_empty_rows_and_columns():
    raw = [["Name", None, "Age"], ["A", None, "3"], [None, None, None], ["B\nx"]]
    assert pt.normalize_table(raw) == [["Name", "Age"], ["A", "3"], ["B x", ""]]


def test_guess_header():
    assert pt.guess_header([["id", "name"], ["1", "a"]])
    assert not pt.guess_header([["1", "2"], ["3", "4"]])
    assert not pt.guess_header([["a", "a"], ["1", "2"]])


def test_excel_roundtrip_keeps_text_and_never_makes_formulas():
    df = pt.build_frame(["id", "name", "note"], [["1", "A", "=1+1"], ["2", "B", ""]])
    types = [c["inferred_type"] for c in importer.profile_frame(df, "csv")["columns"]]
    meta = importer.save_upload(1, "t.xlsx", pt.build_xlsx(df, types))
    try:
        back, _ = importer.load_frame(meta)
        assert back["id"].tolist() == ["1", "2"]
        assert back["note"].tolist() == ["=1+1", ""]
    finally:
        importer.delete_import(meta.id, 1)


def test_starter_queries_quote_and_use_real_columns():
    cols = [
        {"name": "city", "inferred_type": "varchar", "distinct_count": 3, "null_count": 0},
        {"name": "price", "inferred_type": "float", "distinct_count": 9, "null_count": 1},
    ]
    pg = pt.starter_queries("postgresql", "public", "sales", cols, 10)
    assert pg[0]["sql"] == 'SELECT * FROM "public"."sales" LIMIT 100'
    assert any('MIN("price")' in q["sql"] for q in pg)
    assert any('GROUP BY "city"' in q["sql"] for q in pg)
    my = pt.starter_queries("mysql", "db", "sales", cols, 10)
    assert my[0]["sql"] == "SELECT * FROM `sales` LIMIT 100"


def test_confirm_needs_confirmation(client, auth):
    body = {"connection_id": 1, "schema_name": "public", "table_name": "t",
            "headers": ["a"], "rows": [["1"]], "confirm": False}
    assert client.post("/api/pdf/confirm", json=body, headers=auth).status_code == 400


def test_extract_rejects_non_pdf(client, auth):
    r = client.post("/api/pdf/extract", headers=auth, files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 400

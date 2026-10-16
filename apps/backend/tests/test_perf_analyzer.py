import json

from app.services import perf_analyzer as pa

PG_PLAN = json.dumps([{
    "Plan": {
        "Node Type": "Seq Scan", "Relation Name": "orders", "Schema": "public", "Total Cost": 5200.5,
        "Plan Rows": 40, "Actual Rows": 4000, "Actual Loops": 1, "Actual Total Time": 80.2,
        "Filter": "((orders.status)::text = 'open'::text)", "Rows Removed by Filter": 120000,
    },
    "Planning Time": 0.3, "Execution Time": 81.0,
}])


def test_parse_pg_plan():
    nodes, summary, raw = pa.parse_plan("postgresql", [[PG_PLAN]], True)
    assert raw is None and len(nodes) == 1
    assert nodes[0]["is_full_scan"] and nodes[0]["relation"] == "orders"
    assert summary["execution_ms"] == 81.0 and summary["total_cost"] == 5200.5


def test_full_scan_estimate_and_recommendation(monkeypatch):
    monkeypatch.setattr(pa, "_table_info", lambda e, s, t: (["id", "status", "total"], [["id"]]))
    nodes, _, _ = pa.parse_plan("postgresql", [[PG_PLAN]], True)
    findings, recs, counts = pa.build_findings(None, "postgresql", "public", nodes, True)
    titles = [f["title"] for f in findings]
    assert "Full scan on orders" in titles and "Row estimate is far off" in titles
    assert counts["health"] == "attention" and counts["full_scans"] == 1
    assert recs[0]["columns"] == ["status"]
    assert recs[0]["sql"].startswith('CREATE INDEX "dbforge_idx_orders_status" ON "public"."orders"')


def test_existing_index_means_no_recommendation(monkeypatch):
    monkeypatch.setattr(pa, "_table_info", lambda e, s, t: (["id", "status"], [["status", "id"]]))
    nodes, _, _ = pa.parse_plan("postgresql", [[PG_PLAN]], False)
    findings, recs, _ = pa.build_findings(None, "postgresql", "public", nodes, False)
    assert recs == []
    assert any("already starts with" in f["title"] for f in findings)


def test_mysql_plan_full_scan():
    doc = {"query_block": {"cost_info": {"query_cost": "12.5"}, "table": {
        "table_name": "student", "access_type": "ALL", "rows_examined_per_scan": 500,
        "cost_info": {"prefix_cost": "60.1"}, "attached_condition": "(`db`.`student`.`name` = 'x')"}}}
    nodes, summary, _ = pa.parse_plan("mysql", [[json.dumps(doc)]], False)
    assert nodes[0]["is_full_scan"] and summary["total_cost"] == 12.5


def test_identifiers_are_quoted():
    _, sql = pa.index_ddl("postgresql", "public", 'we"ird', ["a b"])
    assert '"we""ird"' in sql and '"a b"' in sql
    _, sql = pa.index_ddl("mysql", "db", "t`x", ["c"])
    assert "`t``x`" in sql


def test_create_index_needs_confirmation(client, auth):
    r = client.post("/api/connections/1/indexes", headers=auth,
                    json={"schema_name": "public", "table": "t", "columns": ["a"], "confirm": False})
    assert r.status_code == 400

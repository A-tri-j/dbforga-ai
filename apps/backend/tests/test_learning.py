def test_progress_roundtrip_and_isolation(client, auth):
    assert client.put("/api/learn/progress/sql-joins", headers=auth).status_code == 204
    assert client.put("/api/learn/progress/sql-joins", headers=auth).status_code == 204  # idempotent
    assert client.get("/api/learn/progress", headers=auth).json() == ["sql-joins"]
    assert client.delete("/api/learn/progress/sql-joins", headers=auth).status_code == 204
    assert client.get("/api/learn/progress", headers=auth).json() == []


def test_invalid_id_and_auth(client, auth):
    assert client.put("/api/learn/progress/Bad%20Id", headers=auth).status_code == 400
    assert client.get("/api/learn/progress").status_code == 401

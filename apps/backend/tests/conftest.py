import os
import tempfile
import uuid

from cryptography.fernet import Fernet

# Must be set before the app is imported so tests never touch your dev database.
_tmp = tempfile.mkdtemp()
os.environ["DBFORGE_DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["DBFORGE_JWT_SECRET"] = "test-secret-not-for-production"
os.environ["DBFORGE_ALLOW_PRIVATE_HOSTS"] = "false"
os.environ["DBFORGE_APP_MODE"] = "web"
os.environ["DBFORGE_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def auth(client):
    email = f"{uuid.uuid4().hex[:8]}@testmail.io"
    creds = {"email": email, "password": "password123"}
    assert client.post("/api/auth/register", json=creds).status_code == 201
    token = client.post("/api/auth/login", json=creds).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

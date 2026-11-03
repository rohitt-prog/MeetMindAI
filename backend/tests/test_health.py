from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_health_check():
    """
    Test that the health endpoint returns 200 OK with expected payload.
    """
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "app": "MeetMind AI"
    }

def test_root_endpoint():
    """
    Test root welcome endpoint.
    """
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert data["health"] == "/api/health"

def test_cors_headers():
    """
    Test that CORS headers are appropriately returned for allowed origins.
    """
    response = client.get(
        "/api/health",
        headers={"Origin": "http://localhost:5173"}
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:5173"

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_answers_200_for_the_alb():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_valid_correlation_id_is_reused_and_echoed():
    res = client.get("/", headers={"x-correlation-id": "abc-123"})
    assert res.headers["x-correlation-id"] == "abc-123"
    assert res.json()["correlation_id"] == "abc-123"


def test_malformed_correlation_id_is_replaced():
    res = client.get("/", headers={"x-correlation-id": "bad id"})
    assert len(res.headers["x-correlation-id"]) == 36

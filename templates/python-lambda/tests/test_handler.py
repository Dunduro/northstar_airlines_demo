import json
from types import SimpleNamespace

from app.handler import handler

CTX = SimpleNamespace(aws_request_id="r1")


def event(path, headers=None):
    return {"rawPath": path, "headers": headers or {}, "requestContext": {"http": {"method": "GET"}, "requestId": "apigw-1"}}


def test_health_answers_200():
    res = handler(event("/health"), CTX)
    assert res["statusCode"] == 200
    assert json.loads(res["body"])["status"] == "ok"


def test_valid_correlation_id_is_reused_and_echoed():
    assert handler(event("/", {"x-correlation-id": "abc-123"}), CTX)["headers"]["x-correlation-id"] == "abc-123"


def test_without_one_the_api_gateway_request_id_is_used():
    assert handler(event("/", {"x-correlation-id": "bad id"}), CTX)["headers"]["x-correlation-id"] == "apigw-1"


def test_unknown_routes_answer_404():
    assert handler(event("/nope"), CTX)["statusCode"] == 404

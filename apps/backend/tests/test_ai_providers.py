import httpx
import pytest

from app.adapters import ai_providers as ap

KEY = "sk-test-SECRET-1234"


def transport(handler):
    return httpx.MockTransport(handler)


def test_list_models_success():
    def handler(request):
        assert request.headers["Authorization"] == f"Bearer {KEY}"
        return httpx.Response(200, json={"data": [{"id": "b"}, {"id": "a"}]})

    assert ap.list_models("openai", KEY, transport=transport(handler)) == ["a", "b"]


def test_invalid_key_message_hides_key():
    with pytest.raises(ap.ProviderError) as exc:
        ap.list_models("groq", KEY, transport=transport(lambda r: httpx.Response(401, json={})))
    assert exc.value.code == "invalid_key"
    assert KEY not in exc.value.message


def test_chat_success_and_no_sampling_params():
    seen = {}

    def handler(request):
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"choices": [{"message": {"content": " hello "}}]})

    assert ap.chat("xai", KEY, "m", [{"role": "user", "content": "hi"}], transport=transport(handler)) == "hello"
    assert "temperature" not in seen["body"] and "max_tokens" not in seen["body"]


def test_rate_limit():
    with pytest.raises(ap.ProviderError) as exc:
        ap.chat("openai", KEY, "m", [], transport=transport(lambda r: httpx.Response(429, json={})))
    assert exc.value.code == "rate_limited"


def test_timeout():
    def handler(request):
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(ap.ProviderError) as exc:
        ap.chat("openai", KEY, "m", [], transport=transport(handler))
    assert exc.value.code == "timeout"


@pytest.mark.parametrize("payload", [{}, {"choices": []}, {"choices": [{"message": {"content": ""}}]}])
def test_malformed_reply(payload):
    with pytest.raises(ap.ProviderError) as exc:
        ap.chat("openai", KEY, "m", [], transport=transport(lambda r: httpx.Response(200, json=payload)))
    assert exc.value.code == "bad_response"


def test_error_detail_masks_key():
    body = {"error": {"message": f"bad model for key {KEY}"}}
    with pytest.raises(ap.ProviderError) as exc:
        ap.chat("openai", KEY, "m", [], transport=transport(lambda r: httpx.Response(400, json=body)))
    assert KEY not in exc.value.message

from dataclasses import dataclass

import httpx


@dataclass(frozen=True)
class ProviderInfo:
    key: str
    label: str
    base_url: str
    suggested_model: str  # only a suggestion; model names change, pick from the provider's list


PROVIDERS: dict[str, ProviderInfo] = {
    "openai": ProviderInfo("openai", "OpenAI (ChatGPT)", "https://api.openai.com/v1", "gpt-4o-mini"),
    "groq": ProviderInfo("groq", "Groq", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"),
    "xai": ProviderInfo("xai", "xAI (Grok)", "https://api.x.ai/v1", "grok-3-mini"),
}


class ProviderError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _error_text(resp: httpx.Response, api_key: str) -> str:
    try:
        msg = resp.json()["error"]["message"]
    except Exception:
        return ""
    return msg.replace(api_key, "***")[:200] if isinstance(msg, str) else ""


def _request(method: str, url: str, api_key: str, json: dict | None = None,
             transport: httpx.BaseTransport | None = None):
    try:
        with httpx.Client(transport=transport, timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            resp = client.request(method, url, headers={"Authorization": f"Bearer {api_key}"}, json=json)
    except httpx.TimeoutException:
        raise ProviderError("timeout", "The AI provider did not respond in time")
    except httpx.HTTPError:
        raise ProviderError("unreachable", "Could not reach the AI provider")

    if resp.status_code in (401, 403):
        raise ProviderError("invalid_key", "The provider rejected this API key")
    if resp.status_code == 429:
        raise ProviderError("rate_limited", "Rate limit or quota exceeded at the provider")
    if resp.status_code >= 500:
        raise ProviderError("provider_error", "The AI provider had an internal error. Try again later")
    if resp.status_code >= 400:
        detail = _error_text(resp, api_key)
        raise ProviderError("bad_request", "The provider rejected the request" + (f": {detail}" if detail else ""))
    try:
        return resp.json()
    except ValueError:
        raise ProviderError("bad_response", "The provider returned an unreadable response")


def list_models(provider: str, api_key: str, transport: httpx.BaseTransport | None = None) -> list[str]:
    data = _request("GET", f"{PROVIDERS[provider].base_url}/models", api_key, transport=transport)
    items = data.get("data") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ProviderError("bad_response", "The provider returned an unexpected model list")
    return sorted({m["id"] for m in items if isinstance(m, dict) and isinstance(m.get("id"), str)})


def chat(provider: str, api_key: str, model: str, messages: list[dict],
         transport: httpx.BaseTransport | None = None) -> str:
    # No temperature / max-token parameters on purpose: some models reject them.
    data = _request("POST", f"{PROVIDERS[provider].base_url}/chat/completions", api_key,
                    json={"model": model, "messages": messages}, transport=transport)
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ProviderError("bad_response", "The provider returned an unexpected reply")
    if not isinstance(content, str) or not content.strip():
        raise ProviderError("bad_response", "The provider returned an empty reply")
    return content.strip()

import logging
import re
import sys

from app.core.config import settings

_PATTERNS = [
    (re.compile(r"(?i)\b(postgres(?:ql)?(?:\+\w+)?|mysql(?:\+\w+)?|mongodb(?:\+srv)?)://([^:/@\s]+):([^@\s]+)@"), r"\1://\2:***@"),
    (re.compile(r"(?i)bearer\s+[a-z0-9._\-]+"), "Bearer ***"),
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}"), "sk-***"),
    (re.compile(r"\bgsk_[A-Za-z0-9]{8,}"), "gsk_***"),
    (re.compile(r"\bxai-[A-Za-z0-9]{8,}"), "xai-***"),
    (re.compile(r"(?i)(password|passwd|pwd|secret|api[_-]?key|token)(\"?\s*[:=]\s*\"?)[^\s\"&,;]+"), r"\1\2***"),
]


def redact(text: str) -> str:
    for pattern, replacement in _PATTERNS:
        text = pattern.sub(replacement, text)
    return text


class RedactingFormatter(logging.Formatter):
    """Scrubs the final text, tracebacks included."""

    def format(self, record: logging.LogRecord) -> str:
        return redact(super().format(record))


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(RedactingFormatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(settings.log_level.upper())

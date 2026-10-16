import ipaddress
import socket

from app.core.config import settings


def assert_host_allowed(host: str, port: int) -> None:
    """Block private/local targets unless explicitly allowed (SSRF safeguard)."""
    if settings.allow_private_hosts:
        return
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError("Host could not be resolved") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise ValueError("Connections to private or local addresses are disabled on this server")

"""HTTPS client for the portal's controller protocol (outbound only: no port is
opened on the Pi, so no tunnel or port-forward is needed).

  POST /api/controller/commands          heartbeat + fetch next command
  POST /api/controller/commands/{id}/ack report the outcome of a command

Contract read from app/api/controller/commands/route.ts and
app/api/controller/commands/[id]/ack/route.ts in this repository.
"""

from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional

from . import __version__


class PortalError(Exception):
    def __init__(self, message: str, status: Optional[int] = None) -> None:
        super().__init__(message)
        self.status = status


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """urllib follows redirects and re-sends the Authorization header to the new
    location. The controller credential must only ever go to PORTAL_URL, so a
    redirect is reported as an HTTP error (e.g. "HTTP 301": fix PORTAL_URL)."""

    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:  # type: ignore[override]
        return None


class PortalClient:
    def __init__(self, base_url: str, gate_id: str, token: str, ca_file: Optional[str] = None, timeout_s: float = 8.0) -> None:
        self.base = base_url
        self.gate_id = gate_id
        self._token = token
        self._timeout = timeout_s
        self._ssl = ssl.create_default_context(cafile=ca_file) if base_url.startswith("https://") else None
        self._opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=self._ssl), _NoRedirect())

    def _post(self, path: str, body: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(body).encode("utf-8")
        request = urllib.request.Request(self.base + path, data=data, method="POST", headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self._token}",
            "User-Agent": f"balwyn-gate-controller/{__version__}",
        })
        try:
            with self._opener.open(request, timeout=self._timeout) as response:
                body = json.loads(response.read(65536).decode("utf-8") or "{}")
            if not isinstance(body, dict):
                # A proxy or captive-portal page can answer 200 with other JSON;
                # treat it as unreachable instead of crashing the control loop.
                raise PortalError("portal answered with an unexpected body")
            return body
        except urllib.error.HTTPError as error:
            # Never log the token; the portal's error text is short and safe.
            try:
                message = json.loads(error.read(4096).decode("utf-8")).get("error", "")
            except (ValueError, OSError):
                message = ""
            raise PortalError(message or f"HTTP {error.code}", error.code) from None
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as error:
            raise PortalError(f"portal unreachable: {type(error).__name__}") from None

    def poll(self, position: str, safety_ok: bool, faults: List[str], schedule_control: bool) -> Dict[str, Any]:
        return self._post("/api/controller/commands", {
            "gateId": self.gate_id, "position": position, "safetyOk": safety_ok,
            "faults": faults[:8], "softwareVersion": f"balwyn-gate-controller {__version__}",
            "scheduleControl": schedule_control,
        })

    def ack(self, command_id: int, state: str, position: str, safety_ok: bool, detail: str) -> None:
        self._post(f"/api/controller/commands/{int(command_id)}/ack", {
            "gateId": self.gate_id, "state": state, "position": position, "safetyOk": safety_ok, "detail": detail[:500],
        })

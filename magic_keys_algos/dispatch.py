"""Event layer: verify, then route a webhook event to the right algorithm.

Order (fail-closed, project instructions s3):
    1. HMAC. The secret is read at CALL time from the environment variable whose
       NAME the keys file gives (compassHmacEnv / guardianHmacEnv). A missing or
       empty variable rejects the event: no secret means nothing is verifiable.
       A rejection reports HMAC_REJECT to the noise matrix and pulses nothing.
    2. Event type must exist in keys.events (else BAD_EVENT).
    3. requiresDoorId events must name a known door (else UNKNOWN_DOOR / BAD_EVENT).
    4. Route by the event's `action`:
         PULSE_DOOR          -> PulseController.pulse_door
         INHIBIT_ALL_PULSES  -> LockdownMachine.apply(LOCKDOWN)
         CLEAR_INHIBIT       -> LockdownMachine.apply(ALL_CLEAR)
         NOISE_ALERT         -> NoiseMatrix.report(event_type, door_id)

TRUTH_GAP (signature wire format): the project files do not say which header
carries the Compass / Guardian signature, its encoding, or whether a timestamp
is signed (replay protection). verify_hmac() therefore takes an already
extracted hex signature (optionally "sha256="-prefixed) and verifies
HMAC-SHA256 over the raw request body. The HTTP adapter that extracts the
header and the payload field names (event_id, door_id, timestamp) is NOT
written here because those facts are unknown; supply them, or paste one real
sample request (secrets redacted).
"""

from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any, Callable, Dict, Mapping, Optional

from .keys import Keys
from .lockdown import LockdownMachine
from .noise import NoiseMatrix
from .pulse import PulseController

SOURCE_ENV_KEY = {"compass": "compassHmacEnv", "guardian": "guardianHmacEnv"}


def verify_hmac(secret: bytes, body: bytes, signature: str) -> bool:
    """Constant-time HMAC-SHA256 check of body against a hex signature. Empty secret or signature never verifies."""
    if not secret or not isinstance(signature, str) or not signature:
        return False
    given = signature.strip().lower()
    if given.startswith("sha256="):
        given = given[len("sha256="):]
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, given)


class EventDispatcher:
    def __init__(self, keys: Keys, pulse: PulseController, lockdown: LockdownMachine, noise: NoiseMatrix, *,
                 env: Optional[Mapping[str, str]] = None, audit: Callable[[str, Dict[str, Any]], None] = lambda e, f: None) -> None:
        self.keys = keys
        self._pulse = pulse
        self._lockdown = lockdown
        self._noise = noise
        self._env = os.environ if env is None else env
        self._audit = audit

    def handle(self, source: str, event_type: str, door_id: Optional[str], event_id: str, event_ts: float,
               body: bytes, signature: str) -> Dict[str, Any]:
        if not self._authentic(source, body, signature):
            self._noise.report("HMAC_REJECT")
            self._audit("event_rejected", {"source": source, "type": event_type, "id": event_id, "error": "HMAC_REJECT"})
            return {"ok": False, "error": "HMAC_REJECT", "detail": None}

        spec = self.keys.events.get(event_type)
        if spec is None:
            return self._bad(event_type, event_id, "BAD_EVENT", "unknown event type")
        if spec["requiresDoorId"]:
            if not door_id:
                return self._bad(event_type, event_id, "BAD_EVENT", "door id required")
            if self.keys.door(door_id) is None:
                return self._bad(event_type, event_id, "UNKNOWN_DOOR", "no such door")

        action = spec["action"]
        if action == "PULSE_DOOR":
            result = self._pulse.pulse_door(door_id, f"{event_type}:{event_id}", source)
            return {"ok": result["ok"], "error": result["error"], "detail": result}
        if action in {"INHIBIT_ALL_PULSES", "CLEAR_INHIBIT"}:
            kind = "LOCKDOWN" if action == "INHIBIT_ALL_PULSES" else "ALL_CLEAR"
            outcome = self._lockdown.apply(kind, event_id, event_ts)
            accepted = outcome["applied"] or outcome["reason"] == "DUPLICATE"
            return {"ok": accepted, "error": None if accepted else "BAD_EVENT", "detail": outcome}
        if action == "NOISE_ALERT":
            known = self._noise.report(event_type, door_id)
            return {"ok": known, "error": None if known else "BAD_EVENT", "detail": {"reported": known}}
        return self._bad(event_type, event_id, "BAD_EVENT", "unhandled action")

    def _authentic(self, source: str, body: bytes, signature: str) -> bool:
        key_name = SOURCE_ENV_KEY.get(source)
        env_name = self.keys.auth_env.get(key_name) if key_name else None
        secret = self._env.get(env_name, "") if env_name else ""
        return verify_hmac(secret.encode("utf-8"), body, signature)

    def _bad(self, event_type: str, event_id: str, error: str, detail: str) -> Dict[str, Any]:
        self._audit("event_rejected", {"type": event_type, "id": event_id, "error": error, "detail": detail})
        return {"ok": False, "error": error, "detail": detail}

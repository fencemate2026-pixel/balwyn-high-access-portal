#!/usr/bin/env python3
"""Compass ACB-004 isolated relay triggers. Open only; no position feedback."""
from __future__ import annotations

import hmac
import json
import logging
import os
import re
import signal
import socket
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOG = logging.getLogger("compass-door-open")


def sd_notify(message: str) -> None:
    """Minimal systemd notify (READY=1 / WATCHDOG=1). No dependency; never raises.

    Same pattern as gate-controller/balwyn_gate_controller/sdnotify.py and
    controller-agent/balwyn_relay_agent.py: a no-op outside systemd (tests,
    local runs), and a failed notify never takes the HTTP server down.
    """
    address = os.environ.get("NOTIFY_SOCKET")
    if not address or not hasattr(socket, "AF_UNIX"):
        return
    if address.startswith("@"):
        address = "\0" + address[1:]
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM) as sock:
            sock.connect(address)
            sock.sendall(message.encode("utf-8"))
    except OSError:
        pass


@dataclass(frozen=True)
class Config:
    token: str
    pins: tuple[int, ...]
    pulse_ms: int = 500
    mode: str = "mock"
    active_low: bool = True
    chip: int = 0
    journal: str = "door-open-state.sqlite3"

    def __post_init__(self):
        if len(self.token) < 32 or not self.token.isascii() or any(c.isspace() for c in self.token) or self.token.startswith("REPLACE_"):
            raise ValueError("DOOR_API_TOKEN must be an ASCII token of at least 32 characters")
        if len(self.pins) != 4 or len(set(self.pins)) != 4 or any(type(p) is not int or not 2 <= p <= 27 for p in self.pins):
            raise ValueError("DOOR_GPIO_PINS requires four distinct BCM pins in door 1,2,3,4 order (2..27)")
        if type(self.pulse_ms) is not int or not 300 <= self.pulse_ms <= 800:
            raise ValueError("DOOR_PULSE_MS must be an integer between 300 and 800")
        if self.mode not in {"mock", "dry-run", "hardware"}:
            raise ValueError("DOOR_MODE must be mock, dry-run or hardware")
        if type(self.active_low) is not bool or type(self.chip) is not int or self.chip < 0:
            raise ValueError("Invalid GPIO polarity or chip")

    @classmethod
    def from_env(cls):
        mode = os.environ.get("DOOR_MODE", "mock")
        if mode == "hardware" and (not os.environ.get("DOOR_GPIO_PINS") or os.environ.get("DOOR_ACTIVE_LOW") not in {"true", "false"}):
            raise ValueError("Hardware mode requires explicit verified DOOR_GPIO_PINS and DOOR_ACTIVE_LOW")
        return cls(
            token=os.environ.get("DOOR_API_TOKEN", ""),
            pins=tuple(int(p.strip()) for p in os.environ.get("DOOR_GPIO_PINS", "17,27,22,23").split(",")),
            pulse_ms=int(os.environ.get("DOOR_PULSE_MS", "500")), mode=mode,
            active_low=os.environ.get("DOOR_ACTIVE_LOW", "true") == "true",
            chip=int(os.environ.get("DOOR_GPIO_CHIP", "0")),
            journal=os.environ.get("DOOR_JOURNAL", "door-open-state.sqlite3"),
        )


class MockOutputs:
    def __init__(self, config: Config):
        self.states = {pin: False for pin in config.pins}

    def write(self, pin: int, active: bool):
        self.states[pin] = active

    def close(self):
        for pin in self.states:
            self.write(pin, False)


class GpioOutputs:
    def __init__(self, config: Config):
        import lgpio  # Imported only for an explicitly configured hardware run.
        self.gpio, self.config, self.claimed = lgpio, config, []
        self.handle = lgpio.gpiochip_open(config.chip)
        try:
            for pin in config.pins:
                lgpio.gpio_claim_output(self.handle, pin, int(config.active_low))
                self.claimed.append(pin)
        except BaseException:
            self.close()
            raise

    def write(self, pin: int, active: bool):
        level = int(not active) if self.config.active_low else int(active)
        self.gpio.gpio_write(self.handle, pin, level)

    def close(self):
        error = None
        for pin in self.claimed:
            try:
                self.write(pin, False)
                self.gpio.gpio_free(self.handle, pin)
            except Exception as exc:
                error = exc
        self.claimed.clear()
        self.gpio.gpiochip_close(self.handle)
        if error:
            raise RuntimeError("GPIO cleanup failed; inspect relay outputs locally") from error


class DoorController:
    def __init__(self, config: Config, outputs=None):
        self.config = config
        self.outputs = outputs or (GpioOutputs(config) if config.mode == "hardware" else MockOutputs(config))
        self.lock = threading.Lock()
        self.stopping = threading.Event()
        self.faulted = False
        try:
            Path(config.journal).parent.mkdir(parents=True, exist_ok=True)
            with self.database() as db:
                db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, door INTEGER NOT NULL, result TEXT)")
            os.chmod(config.journal, 0o600)
        except BaseException:
            self.outputs.close()
            raise

    @contextmanager
    def database(self):
        db = sqlite3.connect(self.config.journal, timeout=2)
        try:
            with db:
                yield db
        finally:
            db.close()

    def open(self, door: int, request_id: str):
        if type(door) is not int or door not in range(1, 5):
            return 404, {"error": "Door must be 1, 2, 3 or 4"}
        try:
            if str(uuid.UUID(request_id)) != request_id:
                raise ValueError()
        except (ValueError, AttributeError):
            return 400, {"error": "A canonical UUID Idempotency-Key is required"}
        if not self.lock.acquire(blocking=False):
            return 409, {"error": "A relay pulse is already in progress; no command was queued"}
        try:
            if self.stopping.is_set() or self.faulted:
                return 503, {"error": "Relay service stopped or faulted; inspect locally"}
            with self.database() as db:
                row = db.execute("SELECT door, result FROM requests WHERE id = ?", (request_id,)).fetchone()
                if row:
                    if row[0] != door or row[1] is None:
                        return 409, {"error": "Request already reserved; no repeat pulse. Inspect the original result locally"}
                    code, result = json.loads(row[1])
                    return code, {**result, "replayed": True}
                # Commit before touching hardware, including across a Pi restart.
                db.execute("INSERT INTO requests (id, door) VALUES (?, ?)", (request_id, door))
            pin = self.config.pins[door - 1]
            LOG.info("event=open_started request_id=%s door=%d mode=%s pulse_ms=%d", request_id, door, self.config.mode, self.config.pulse_ms)
            try:
                try:
                    self.outputs.write(pin, True)
                    interrupted = self.stopping.wait(self.config.pulse_ms / 1000)
                finally:
                    self.outputs.write(pin, False)
                if interrupted:
                    raise RuntimeError("Shutdown interrupted the pulse")
                code = 200
                result = {"status": "pulsed" if self.config.mode == "hardware" else "dry_run", "door": door,
                          "pulse_ms": self.config.pulse_ms, "position": "unknown", "sensor_feedback": False,
                          "request_id": request_id}
            except Exception:
                self.faulted = True
                code, result = 503, {"error": "Pulse failed or interrupted; physical outcome unknown. Inspect locally", "request_id": request_id}
                LOG.error("event=open_failed request_id=%s door=%d", request_id, door)
            with self.database() as db:
                db.execute("UPDATE requests SET result = ? WHERE id = ?", (json.dumps([code, result]), request_id))
            LOG.info("event=open_finished request_id=%s door=%d http_status=%d", request_id, door, code)
            return code, result
        except sqlite3.Error:
            self.faulted = True
            LOG.error("event=journal_failed request_id=%s door=%d", request_id, door)
            return 503, {"error": "Execution journal unavailable; no automatic retry. Inspect locally"}
        finally:
            self.lock.release()

    def close(self):
        self.stopping.set()
        with self.lock:
            self.outputs.close()


def make_handler(controller: DoorController):
    class Handler(BaseHTTPRequestHandler):
        server_version = "DoorOpen/1"

        def setup(self):
            super().setup()
            self.connection.settimeout(5)

        def log_message(self, *args):
            pass  # Never log raw URLs, tokens or user-supplied headers.

        def respond(self, status: int, payload: dict):
            encoded = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(encoded)

        def do_POST(self):
            headers = self.headers.get_all("Authorization", [])
            valid = len(headers) == 1 and hmac.compare_digest(headers[0].encode(), ("Bearer " + controller.config.token).encode())
            if not valid:
                LOG.warning("event=unauthorized")
                return self.respond(401, {"error": "Unauthorized"})
            match = re.fullmatch(r"/doors/([1-4])/open", self.path)
            if not match:
                return self.respond(404, {"error": "Only POST /doors/{1-4}/open is supported"})
            # Commands have no tunable request body: pin, duration and polarity are local configuration.
            if self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0") != "0":
                return self.respond(400, {"error": "Send an empty body"})
            status, payload = controller.open(int(match[1]), self.headers.get("Idempotency-Key", ""))
            self.respond(status, payload)

        def do_GET(self):
            self.respond(405, {"error": "POST required; no sensor endpoint is available"})

        do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_GET

    return Handler


def doors_off():
    """systemd ExecStopPost: force every door output OFF whatever else is going on.

    Each relay pulse already returns its pin to false in a `finally` block, so
    in the normal case there is nothing to release. This exists for the
    abnormal case ExecStopPost is for: a hard kill (SIGKILL, OOM, `systemctl
    kill`) landing mid-pulse, where the process's own `finally` never runs.
    Intentionally synchronous and independent of the HTTP server/controller
    lock, so it can run even if the main process is the thing that is stuck.
    """
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = Config.from_env()
    outputs = GpioOutputs(config) if config.mode == "hardware" else MockOutputs(config)
    outputs.close()
    LOG.info("doors-off: all door outputs de-energised")


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    controller = DoorController(Config.from_env())
    try:
        server = ThreadingHTTPServer((os.environ.get("DOOR_BIND", "127.0.0.1"), int(os.environ.get("DOOR_PORT", "8080"))), make_handler(controller))
    except BaseException:
        controller.close()
        raise
    server.daemon_threads = False

    def stop(*_):
        controller.stopping.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)

    # serve_forever() blocks this thread, so the watchdog ping runs on its own
    # daemon thread. It stops itself once stopping is set (clean shutdown) or
    # the server's socket closes; the main thread's own exit (SIGKILL) is what
    # ExecStopPost=doors-off is for, since no Python code runs after that.
    watchdog_interval = 10

    def heartbeat():
        while not controller.stopping.wait(watchdog_interval):
            sd_notify("WATCHDOG=1")

    threading.Thread(target=heartbeat, daemon=True).start()

    LOG.info("event=service_started mode=%s", controller.config.mode)
    sd_notify("READY=1")
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        controller.close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "doors-off":
        doors_off()
    else:
        main()

"""Minimal systemd notify (READY=1 / WATCHDOG=1). No dependency; never raises."""

from __future__ import annotations

import os
import socket


def notify(message: str) -> None:
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

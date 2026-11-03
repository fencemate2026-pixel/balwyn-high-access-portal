#!/bin/sh
# Rollback: stops and removes ONLY the mirror unit and its files. Gate app and network untouched.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
systemctl disable --now mildura-mirror.service 2>/dev/null || true
rm -f /etc/systemd/system/mildura-mirror.service /etc/mildura-mirror.env
rm -rf /opt/mildura-mirror /var/lib/mildura-mirror
systemctl daemon-reload
# the service user is the gate app user (rjlcommercial); it is NOT removed
echo "removed"

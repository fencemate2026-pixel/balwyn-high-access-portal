#!/bin/sh
# Installs the Mildura mirror as its OWN systemd unit. Does not touch: the gate app, WiFi /
# NetworkManager, Tailscale, sshd, the watchdog, GPIO, or the gate database. Does not reboot.
# Needs: MIRROR_SECRET (>=32 chars, the device secret whose sha256 is stored in the cloud) and MIRROR_DB.
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
: "${MIRROR_DB:?set MIRROR_DB (path to the gate sqlite file)}"
# The device secret is generated ON the Pi and never leaves it. Only its sha256 is shown, for registration.
MIRROR_SECRET="${MIRROR_SECRET:-$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')}"
[ "${#MIRROR_SECRET}" -ge 32 ] || { echo "secret too short"; exit 1; }
[ -r "$MIRROR_DB" ] || { echo "cannot read $MIRROR_DB"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
id mildura-mirror >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin mildura-mirror
install -d -m 755 /opt/mildura-mirror
install -m 644 "$SRC/mildura_mirror.py" /opt/mildura-mirror/mildura_mirror.py
umask 077
cat > /etc/mildura-mirror.env <<EOF
MIRROR_URL=${MIRROR_URL:?set MIRROR_URL}
MIRROR_DEVICE_ID=mildura-001
MIRROR_SECRET=$MIRROR_SECRET
MIRROR_DB=$MIRROR_DB
EOF
chown root:mildura-mirror /etc/mildura-mirror.env; chmod 640 /etc/mildura-mirror.env
install -m 644 "$SRC/mildura-mirror.service" /etc/systemd/system/mildura-mirror.service
# The service user must be able to READ the database file, nothing more. Verify rather than assume:
sudo -u mildura-mirror test -r "$MIRROR_DB" || { echo "mildura-mirror cannot read $MIRROR_DB; aborting before enabling"; exit 1; }
systemctl daemon-reload
systemctl enable --now mildura-mirror.service
echo "register this hash in the cloud (it is not secret): $(printf %s "$MIRROR_SECRET" | sha256sum | cut -d' ' -f1)"
echo "installed. rollback: sudo systemctl disable --now mildura-mirror.service"

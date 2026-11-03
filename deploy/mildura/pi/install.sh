#!/bin/sh
# Installs / upgrades the Mildura mirror as its OWN systemd unit. Does not touch: the gate app, WiFi /
# NetworkManager, Tailscale, sshd, the watchdog, or GPIO. Does not reboot.
# Needs: MIRROR_URL, MIRROR_DB. Optional: MIRROR_SECRET (generated if absent; an upgrade keeps the existing one),
# MIRROR_CONTROL=1 to enable Phase 2 portal commands (writes to the gate database).
# MIRROR_GATE_ACTIONS=1 (with MIRROR_CONTROL=1) lets the portal's Open Gate / Lockdown call the gate app's
# OWN loopback routes. Needs the gate app's admin PIN, read here ON THE PI from (first found): GATE_ADMIN_PIN,
# the existing /etc/mildura-mirror.env, <db dir>/admin_pin.txt, boomgate.service ADMIN_PIN. Never printed,
# never uploaded; stored only in /etc/mildura-mirror.env (root:rjlcommercial 0640).
set -eu
[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }
: "${MIRROR_DB:?set MIRROR_DB (path to the gate sqlite file)}"
RUN_AS=rjlcommercial
OLD_ENV=/etc/mildura-mirror.env
if [ -z "${MIRROR_SECRET:-}" ] && [ -r "$OLD_ENV" ]; then MIRROR_SECRET="$(sed -n 's/^MIRROR_SECRET=//p' "$OLD_ENV")"; fi
# The device secret is generated ON the Pi and never leaves it. Only its sha256 is shown, for registration.
MIRROR_SECRET="${MIRROR_SECRET:-$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')}"
MIRROR_CONTROL="${MIRROR_CONTROL:-0}"
MIRROR_GATE_ACTIONS="${MIRROR_GATE_ACTIONS:-0}"
GATE_URL="${GATE_URL:-http://127.0.0.1:5000}"
if [ "$MIRROR_GATE_ACTIONS" = 1 ]; then
  [ -z "${GATE_ADMIN_PIN:-}" ] && [ -r "$OLD_ENV" ] && GATE_ADMIN_PIN="$(sed -n 's/^GATE_ADMIN_PIN=//p' "$OLD_ENV")"
  [ -z "${GATE_ADMIN_PIN:-}" ] && [ -r "$(dirname "$MIRROR_DB")/admin_pin.txt" ] && GATE_ADMIN_PIN="$(tr -d ' \r\n' < "$(dirname "$MIRROR_DB")/admin_pin.txt")"
  [ -z "${GATE_ADMIN_PIN:-}" ] && GATE_ADMIN_PIN="$(systemctl show boomgate.service -p Environment --value 2>/dev/null | tr ' ' '\n' | sed -n 's/^ADMIN_PIN=//p' | head -n1)"
  if [ -z "${GATE_ADMIN_PIN:-}" ]; then echo "gate admin PIN not found on this Pi; gate actions stay OFF"; MIRROR_GATE_ACTIONS=0; fi
  # The gate app must answer on loopback (it will not if it was re-bound to the Tailscale IP only).
  if [ "$MIRROR_GATE_ACTIONS" = 1 ] && ! python3 -c "import urllib.request,sys; urllib.request.urlopen(sys.argv[1]+'/login', timeout=5)" "$GATE_URL" 2>/dev/null; then
    echo "gate app not reachable at $GATE_URL/login; gate actions stay OFF"; MIRROR_GATE_ACTIONS=0
  fi
fi
[ "${#MIRROR_SECRET}" -ge 32 ] || { echo "secret too short"; exit 1; }
[ -r "$MIRROR_DB" ] || { echo "cannot read $MIRROR_DB"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
install -d -m 755 /opt/mildura-mirror
install -m 644 "$SRC/mildura_mirror.py" /opt/mildura-mirror/mildura_mirror.py
install -m 644 "$SRC/mildura_commands.py" /opt/mildura-mirror/mildura_commands.py
install -d -m 700 -o "$RUN_AS" -g "$RUN_AS" /var/lib/mildura-mirror
KEY=/var/lib/mildura-mirror/command_key.pem
if [ "$MIRROR_CONTROL" = 1 ]; then
  command -v openssl >/dev/null || { echo "openssl is required for MIRROR_CONTROL=1"; exit 1; }
  # Phase 2 keypair: private key stays here (0600, service user only); only the public key is uploaded.
  if [ ! -s "$KEY" ]; then
    (umask 077; openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$KEY")
    chown "$RUN_AS:$RUN_AS" "$KEY"; chmod 600 "$KEY"
  fi
  # Write access is required now. Verify rather than assume (db file AND its directory, for the journal).
  sudo -u "$RUN_AS" test -w "$MIRROR_DB" || { echo "$RUN_AS cannot write $MIRROR_DB; aborting"; exit 1; }
  sudo -u "$RUN_AS" test -w "$(dirname "$MIRROR_DB")" || { echo "$RUN_AS cannot write $(dirname "$MIRROR_DB"); aborting"; exit 1; }
fi
umask 077
cat > /etc/mildura-mirror.env <<EOT
MIRROR_URL=${MIRROR_URL:?set MIRROR_URL}
MIRROR_DEVICE_ID=mildura-001
MIRROR_SECRET=$MIRROR_SECRET
MIRROR_DB=$MIRROR_DB
MIRROR_CONTROL=$MIRROR_CONTROL
MIRROR_COMMAND_KEY=$KEY
MIRROR_GATE_ACTIONS=$MIRROR_GATE_ACTIONS
GATE_URL=$GATE_URL
GATE_ADMIN_PIN=${GATE_ADMIN_PIN:-}
EOT
chown "root:$RUN_AS" /etc/mildura-mirror.env; chmod 640 /etc/mildura-mirror.env
install -m 644 "$SRC/mildura-mirror.service" /etc/systemd/system/mildura-mirror.service
sudo -u "$RUN_AS" test -r "$MIRROR_DB" || { echo "$RUN_AS cannot read $MIRROR_DB; aborting before enabling"; exit 1; }
systemctl daemon-reload
systemctl enable mildura-mirror.service
systemctl restart mildura-mirror.service
echo "device secret hash (register in gd_units.secret_hash if new; not secret): $(printf %s "$MIRROR_SECRET" | sha256sum | cut -d' ' -f1)"
echo "control: $MIRROR_CONTROL  gate actions: $MIRROR_GATE_ACTIONS"
[ "$MIRROR_CONTROL" = 1 ] && echo "command key fingerprint (compare with the portal): $(openssl pkey -in "$KEY" -pubout | openssl dgst -sha256 | cut -d' ' -f2)"
echo "installed. disable commands: set MIRROR_CONTROL=0 in /etc/mildura-mirror.env and restart; full rollback: sudo sh uninstall.sh"

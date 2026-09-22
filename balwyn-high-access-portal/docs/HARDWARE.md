# Raspberry Pi and ACB-004 Relay Bridge

The backend deliberately models a safe relay-bridge workflow instead of assuming a proprietary controller socket protocol.

## Control path

1. Operator or automation issues a gate command.
2. `hardwareComm.ts` creates a `HardwareCommand` with gate ID, relay channel, action, timestamp, and checksum.
3. The command is delivered to the configured `HARDWARE_ENDPOINT` as JSON with protocol identifier `ACB-004-relay-bridge`.
4. A Raspberry Pi service converts the command to a short dry-contact pulse or maintained relay action for the assigned controller input.
5. The controller, safety loops, and door hardware remain authoritative for movement, interlocks, and emergency release.

## Recommended deployment notes

- Isolate the Pi relay contacts from lock power circuits.
- Keep watchdog heartbeat and audit logging enabled.
- Use per-gate relay channel mapping and unique hardware tokens.
- Verify fire release, lockdown, and obstacle responses on-site before live use.
- Do not expose the hardware endpoint directly to browsers.

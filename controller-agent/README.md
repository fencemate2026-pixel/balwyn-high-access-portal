# Balwyn relay controller agent

> **Superseded at Balwyn by `gate-controller/`. Do not install on the Balwyn gate Pi** (see
> `gate-controller/deploy/INSTALL.md` section 1d).

This service is the onsite half of the Magic Keys control path. It receives a
single command for its assigned gate, pulses the existing gate operator's
dedicated dry-contact `OPEN` or `CLOSE` input, waits for independent limit-switch
feedback, and acknowledges the result to the portal.

It deliberately refuses to start without separate open, close, open-limit,
closed-limit, safety-healthy and emergency-stop inputs. It does not support a
toggle/step-by-step/PP input because the requested direction cannot be proven
remotely. The relay outputs return to their inactive state on startup, shutdown,
network loss and exceptions.

Before any relay pulse, the agent writes an atomic execution journal. If the
process or Pi restarts mid-command, it keeps both relays off and never repeats
the pulse automatically. It acknowledges success only if the independent limit
input already confirms the target; otherwise it reports a blocked or failed
packet so an operator can inspect the gate and deliberately retry.

Before installation, a competent gate automation technician must verify the
operator's input voltage, dry-contact requirements, relay isolation, safety-edge
and photocell circuits, emergency stop, physical stops, manual release, force
settings and the school's approved emergency response. This software does not
replace those local controls.

Install `python3-lgpio`, create the unprivileged `balwyn-gate` service user, copy
the agent to `/opt/balwyn-relay-agent`, place the issued per-gate credential and
verified BCM pin assignments, signal polarity, input bias, pulse duration and
movement timeout in `/etc/balwyn-relay-agent.env`, then install the systemd
unit. The service rejects incomplete or placeholder electrical settings and any
non-HTTPS portal URL. Schedule control remains disabled until commissioning
sign-off.

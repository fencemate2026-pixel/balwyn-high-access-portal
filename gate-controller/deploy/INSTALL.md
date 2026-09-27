# Balwyn gate controller: install and commissioning

One Raspberry Pi can run one or both gates. Each gate is its own service
(`balwyn-gate@TF-ENTRY`, `balwyn-gate@SIDE-ENTRY`) with its own settings,
credential and log. The Pi only makes outgoing HTTPS calls to the portal:
no port is opened, no tunnel or port-forward is needed on the school network.

**Rule for every step below:** the relay is only ever operated on site, with an
RJL technician watching the gate. Remote testing uses `DRY_RUN=true` or the
bench simulator, never a live relay.

## 1. What is wired

| Pi input / output | Goes to | Notes |
|---|---|---|
| Relay module (RELAY_PIN) COM/NO | Operator **OPEN** input and its common | Confirm the terminals on the operator's own wiring diagram. Not a step-by-step input. |
| CLOSED_REED_PIN + GND | Magnetic reed at the **closed** position | Required. Made = fully closed. |
| OPEN_REED_PIN + GND | Magnetic reed at the **open** position | Fitted at Balwyn. Made = fully open. This is what lets the portal confirm an open. |
| SAFETY_INPUT + GND | Volt-free contact that is made while the operator's safety circuit is healthy | Without it the controller is monitor-only: it reports position, never moves the gate. **Which operator output to use is still to be decided on site.** |

**Reed switches.** Use normally-open reeds (contact closes when the magnet is
present), wired between the GPIO pin and GND with `INPUT_ACTIVE_LOW=true` and
`INPUT_PULL=up`. Set each magnet so the reed makes only in the last few
centimetres of travel: a reed that makes early reports "open" before the gate
is fully open. For cable runs longer than about 10 m, or runs beside operator
mains cabling, use shielded cable earthed at the Pi end only, or an
opto-isolated input board, so interference cannot be read as a reed change.
The controller also reports a fault if both reeds are ever made at once
(wiring fault or a stray magnet).

The relay contact is volt-free; the Pi never powers the operator. The
operator's own photo-eyes and force limits remain the safety authority. The
certified fire panel remains the life-safety authority for fire.

## 1a. Roger SLED operator with F70/IPU36 control unit (Balwyn)

Source: Roger F70/IPU36 manual IS247 Rev04 (printed page numbers): section 6 terminals, p.72-73; section 12 parameters, p.103-105.

| Pi | F70/IPU36 terminal | Manual says |
|---|---|---|
| Relay COM/NO | **34 (AP)** and **32 (COM)** | Open command, N.O. "Persistent activation of the opening command prevents automatic reclosure; the automatic reclosure time count is resumed when the opening command is released." This is exactly the pulse / hold behaviour the controller uses. |
| SAFETY_INPUT + GND | **19 (COR)** and **18** | Potential-free contact (p.72). With parameter **18 = 03** (p.104): closed when the control unit is not locked in alarm AND is not on a low battery / bAt LO alert; open if either occurs. A mains failure with a charged battery does not open it. |

F70/IPU36 parameters that must be set (check each on the display before commissioning):

| Parameter | Set to | Why |
|---|---|---|
| **A2** Automatic closure after pause time (p.103) | **not 00**: 01-15 = closing attempts allowed after a photocell trigger, then the gate stays open; 99 = keeps trying | Default is 00 = **disabled**. With 00 the gate never closes by itself after an open or after a hold is released, so "close when they have left" cannot work. RJL to choose the value on its site risk assessment. |
| **21** Automatic closing time (p.105) | measured need (default 30 s) | Pause at fully open before closing. Set `AUTO_CLOSE_TIMEOUT_S` above this plus close travel. |
| **22** Automatic reclosure exclusion (p.105) | **00** (default) | **01** excludes automatic reclosure after an AP open, which would stop every portal open from closing. (02 and 03 affect only PP and PED.) |
| **A7** Operator present (p.103) | **00** (default) | With 01 the gate only moves while AP is held, so a 1-second pulse would stop it moving. |
| **A3** Close after power outage (p.103) | **01** recommended | When mains returns and the gate is NOT completely open (e.g. stopped part-way), it closes after a 5-second warning. |
| **18** COR output (p.104) | **03** | Makes COR the safety-input signal above. COR can then no longer drive a courtesy light. |

What the safety input does and does not tell the portal: it reports that the F70/IPU36 is
not in alarm and has adequate power. It does **not** report whether a photocell beam is
clear; the F70's own photocells and obstacle detection keep protecting people on every movement.

## 2. Install (fresh Pi OS Lite 64-bit, Bookworm)

```
sudo apt update && sudo apt install -y python3 python3-lgpio
sudo useradd --system --no-create-home --groups gpio balwyn-gate
sudo mkdir -p /opt/balwyn-gate-controller /etc/balwyn-gate
sudo cp -r balwyn_gate_controller /opt/balwyn-gate-controller/
sudo cp deploy/balwyn-gate@.service /etc/systemd/system/
sudo systemctl daemon-reload
```

## 3. Credential and settings (per gate)

1. Portal: **Access & users → Separate controller commissioning → issue credential** for the gate.
   The credential is shown once.
2. On the Pi:
   ```
   sudo install -m 600 -o root -g root /dev/null /etc/balwyn-gate/TF-ENTRY.token
   sudo nano /etc/balwyn-gate/TF-ENTRY.token        # paste the credential, save
   sudo cp deploy/gate.env.example /etc/balwyn-gate/TF-ENTRY.env
   sudo nano /etc/balwyn-gate/TF-ENTRY.env          # pins, timings; keep DRY_RUN=true
   ```
3. Check the settings. With `DRY_RUN=true` still set, start the service once and read its first lines:
   ```
   sudo systemctl start balwyn-gate@TF-ENTRY
   journalctl -u balwyn-gate@TF-ENTRY -n 20 --no-pager
   ```
   The first line is either `OK: gate TF-ENTRY, relay GPIO17, ...` or `Configuration error: <SETTING> ...`,
   and a configuration error stops the service before any GPIO is touched.

## 4. Prove the inputs (relay stays OFF)

```
sudo systemctl stop balwyn-gate@TF-ENTRY
cd /opt/balwyn-gate-controller && sudo -u balwyn-gate env $(grep -v '^#' /etc/balwyn-gate/TF-ENTRY.env | xargs) \
  CONTROLLER_TOKEN=$(sudo cat /etc/balwyn-gate/TF-ENTRY.token) python3 -m balwyn_gate_controller read-inputs
```
Prints the reeds and safety input once a second for 30 s. Check by hand:
gate closed → `closed_reed=True`; open the gate with its own remote → `open_reed=True`;
block the safety device → `safety=False`. The relay is claimed OFF and never energised by this command.

## 5. Dry run against the live portal

```
sudo systemctl enable --now balwyn-gate@TF-ENTRY
journalctl -u balwyn-gate@TF-ENTRY -f
```
Within a few seconds the portal shows the gate **commissioned** (only if the
gate is closed and the safety input is healthy). Press OPEN on the dashboard:
the activity log must say **"Dry run: relay not operated"**.

## 6. Supervised commissioning (on site, technician at the gate, stopwatch)

Set `DRY_RUN=false`, then `sudo systemctl restart balwyn-gate@TF-ENTRY`.

| Test | Do | Pass when |
|---|---|---|
| C1 open cycle | Dashboard OPEN | Gate opens, portal shows **open confirmed**, gate auto-closes, portal shows closed. Record open travel and auto-close time; set `TRAVEL_TIMEOUT_S` and `AUTO_CLOSE_TIMEOUT_S` to measured + 50 %. |
| C2 hold window | Automation: one-off rule, 10-minute window starting in 2 minutes | Opens at the start, stays open past the auto-close time, releases and closes at the end. |
| C3 booking | Facility hire booking for the stadium, 10 minutes, lead/run-out 1 minute | Same as C2, and both show on the School scheduler. |
| C4 safety | Break the safety input while a hold is active; then press OPEN | Hold released and gate closes; OPEN refused as **blocked**; portal shows safety not healthy. |
| C5 network loss | Unplug the network during a hold | Hold released after `NETWORK_LOSS_RELEASE_S`; portal shows the gate offline, then back. |
| C6 fire | START FIRE / EVACUATION, then unplug the network for 2 minutes | Gate opens and **stays held** with the network down. Reconnect, clear fire, press CLOSE: released and closes. |
| C7 restart mid-window | During a C2 or C3 window, `sudo reboot` the Pi | Gate releases and auto-closes during the reboot; about 1 minute after the controller is back, the portal re-sends OPEN and the gate re-opens for the rest of the window (activity log: "Scheduled relay command re-sent"). If staff pressed CLOSE in that window, it must NOT re-open. |
| B3 reboot | Assert a hold, then `sudo reboot`. Meter across relay COM/NO | Contact opens at shutdown and **stays open through the whole boot**; gate auto-closes; controller comes back and reports closed. |

B3 is the test the design rests on: a Pi that restarts must never leave a gate held open.

## 7. Logs

* Service log: `journalctl -u balwyn-gate@TF-ENTRY`
* Audit trail (every relay action, command and portal outage): `/var/lib/balwyn-gate/TF-ENTRY/audit.jsonl`
* Portal: **Activity log** records every command and the controller's acknowledgement.

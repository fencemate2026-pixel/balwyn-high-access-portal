# Balwyn gate controller: install and commissioning

One Raspberry Pi can run one or both gates. Each gate is its own service
(`balwyn-gate@TF-ENTRY`, `balwyn-gate@SIDE-ENTRY`) with its own settings,
credential and log. The Pi only makes outgoing HTTPS calls to the portal:
no port is opened, no tunnel or port-forward is needed on the school network.

**Rule for every step below:** the relay is only ever operated on site, with an
RJL technician watching the gate. Remote testing uses `DRY_RUN=true` or the
bench simulator, never a live relay.

**Commands:** every command below is ONE line. Paste them one at a time (some
SSH apps, e.g. Termius, scramble multi-line pastes).

## 0. What to buy and check before site day

| Item | Requirement | Why |
|---|---|---|
| Raspberry Pi | Pi 4 or Pi 5, with the official Raspberry Pi power supply for that model (Pi 5: 27 W USB-C) | Under-voltage causes random resets, and every reset drops a hold. |
| OS | Raspberry Pi OS Lite 64-bit (Bookworm or Trixie), current updates | On a current kernel the 40-pin header is `/dev/gpiochip0` on both Pi 4 and Pi 5; the controller opens chip 0. |
| Relay board | Driven directly by ONE GPIO pin per channel, works with 3.3 V logic, opto-isolated, contacts rated for the operator input (F70 AP/COM is a low-voltage dry contact) | The controller switches a GPIO line. **I²C relay HATs (e.g. PiRelay V2, 8 Relays Card) will not work.** A 5 V module whose input needs 5 V logic may never switch fully off from a 3.3 V pin. |
| Relay pin | The GPIO your board actually uses for its channel, e.g. Waveshare 3-channel RPi Relay Board = GPIO 26 / 20 / 21. Set `RELAY_PIN` to it, and keep reed and safety inputs off the board's other relay pins | Using the example's GPIO 17 on a board wired to GPIO 26 drives nothing, or the wrong thing. |
| Reed switches | Normally-open (make when the magnet is present), one at closed, one at open | See section 1. |
| Meter | Continuity/resistance across relay COM–NO | Tests B0 and B3. |

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

## 1b. Access board (ACB-004) and magnetic lock (optional, added 11 Oct 2026)

Use this when the gate's magnetic lock is powered through the school's S4A
ACB-004 access board, so the lock must be released before the gate can move.
Source: S4A wiring diagram "ACB-00 series" (2019), ACB-004 sheet; the Balwyn
Installer Technical Appendix (K1 interposing relay).

| Pi | Goes to | Notes |
|---|---|---|
| Second relay channel (`UNLOCK_RELAY_PIN`) COM/NO | ACB-004 exit-button input for this gate's door: **P1 and the GND beside it** (P2 / P3 / P4 for doors 2-4) | One short press (`UNLOCK_PULSE_S`, 0.5 s). The board then releases the lock for its own unlock time, set in the S4A software (Balwyn: 5 s), and logs a button press. **Never S1-S4: those are door-sensor inputs.** |
| `UNLOCK_SENSE_PIN` + GND | Spare (second) contact of **K1**, the 12 V DPDT relay driven by the ACB door relay's NO (coil to the lock supply 0 V) | Made = the board has unlocked the door. The gate is only driven after this confirms the unlock. Also logs unlocks the board makes by itself (card, QR code, its software). |
| Gate relay (`RELAY_PIN`) COM/NO | F70/IPU36 **34 (AP) / 32 (COM)**, **in parallel with K1's first contact** | K1 opens the gate for a card scan; the Pi relay holds it open for schedules, bookings and fire. Either contact closing opens the gate. |

Sequence for a portal open (schedule, booking, manual): press P1 -> board
unlocks (K1 pulls in, gate starts) -> unlock confirmed -> Pi gate relay closes
and holds -> after the unlock time the board re-powers the lock, which only
re-catches the gate when it closes at the end of the window. A fire /
evacuation open presses, waits `UNLOCK_LEAD_S` and holds without waiting for
confirmation; the fire panel's hardwired lock release is the life-safety path.

Bench checks before site (all UNVERIFIED until done):
* **U1** Press P1 from the Pi: the board's door LED lights for the set unlock
  time and `read-inputs` shows `board_unlocked=True` for that time only.
* **U2** Meter across K1 contact 1: closed only during the unlock time.
* **U3** With the lock and gate on the bench: the magnet releases before the
  gate pulls. If the gate jerks against the magnet, fit an on-delay timer relay
  for K1 contact 1 (0.5-1 s) or use the F70 pre-flashing delay.
* **U4** If a door sensor is wired to the board's S1, turn off "door not closed
  for a long time" alarms for this door in the S4A software, or a schedule hold
  will raise them.

## 2. Install (fresh Pi OS Lite 64-bit)

Copy the `gate-controller` folder from this repository to the Pi first. From a
laptop that has the repository (replace `pi` and the address with the Pi's user
and IP):
```
scp -r gate-controller pi@192.168.1.50:~/
```
Then on the Pi, one line at a time:
```
cd ~/gate-controller
sudo apt update && sudo apt install -y python3 python3-lgpio
sudo useradd --system --no-create-home --groups gpio balwyn-gate
sudo mkdir -p /opt/balwyn-gate-controller /etc/balwyn-gate
sudo cp -r balwyn_gate_controller /opt/balwyn-gate-controller/
sudo cp deploy/balwyn-gate@.service /etc/systemd/system/
sudo systemctl daemon-reload
```
Check: `python3 -c "import lgpio"` prints nothing (no error), and
`id balwyn-gate` lists the `gpio` group.

Check the network the Pi will actually use (the school's):
* `timedatectl` must show `System clock synchronized: yes`. A Pi has no
  battery-backed clock, and HTTPS certificate checks fail until the time is
  right. If it stays `no`, the school network probably blocks outside time
  servers: ask school IT for their NTP server, put it on an `NTP=` line in
  `/etc/systemd/timesyncd.conf`, then `sudo systemctl restart systemd-timesyncd`.
* `curl -sS https://magickeys-balwyn-portal.com/api/health` must print
  `{"status":"ok"}`. A certificate error means the school inspects HTTPS
  traffic: ask school IT to exempt the Pi, or obtain their root certificate
  and set `CA_FILE` to it.

Optional, recommended: make the firmware hold the relay pin OFF from early boot,
before Linux and the controller start. Add ONE line to `/boot/firmware/config.txt`
(use your `RELAY_PIN`): `gpio=17=op,dh` for an active-low board
(`RELAY_ACTIVE_LOW=true`), or `gpio=17=op,dl` for an active-high board. The
Raspberry Pi documentation notes a delay of a few seconds between power being
applied and this taking effect, so test B0 is still required.

## 2a. Bench test B0 (relay board NOT connected to the gate operator)

With a meter across the relay channel's COM and NO:
power the Pi on, and through the whole boot the contact must stay **open** (no
continuity). Then `sudo reboot`: open throughout. Keep the meter on when you
reach section 4: the contact stays open while `read-inputs` runs (the relay is
claimed OFF). If the contact closes at any point,
stop. Check `RELAY_ACTIVE_LOW` and `RELAY_PIN` against the relay board's
documentation before going further. Only connect COM/NO to the operator once B0
passes.

## 3. Credential and settings (per gate)

1. Portal: **Access & users → Separate controller commissioning → issue credential** for the gate.
   The credential is shown once.
2. On the Pi:
   ```
   sudo install -m 600 -o root -g root /dev/null /etc/balwyn-gate/TF-ENTRY.token
   sudo nano /etc/balwyn-gate/TF-ENTRY.token        # paste the credential, save
   sudo cp deploy/gate.env.example /etc/balwyn-gate/TF-ENTRY.env
   sudo chgrp balwyn-gate /etc/balwyn-gate/TF-ENTRY.env && sudo chmod 640 /etc/balwyn-gate/TF-ENTRY.env
   sudo nano /etc/balwyn-gate/TF-ENTRY.env
   ```
   Set the pins and timings; keep `DRY_RUN=true` and `SCHEDULE_CONTROL=false`.
   Comments must stay on their own lines: `RELAY_PIN=17  # note` is refused.
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
cd /opt/balwyn-gate-controller && sudo -u balwyn-gate env $(grep -v '^#' /etc/balwyn-gate/TF-ENTRY.env | xargs) CONTROLLER_TOKEN=$(sudo cat /etc/balwyn-gate/TF-ENTRY.token) python3 -m balwyn_gate_controller read-inputs
```
(The second command is one long line.)
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

Before this step, look at the portal's Gate schedules, Automation and Facility
hire pages: note every window that includes this gate today.

Set `DRY_RUN=false` (leave `SCHEDULE_CONTROL=false`), then
`sudo systemctl restart balwyn-gate@TF-ENTRY`. After C1 passes, set
`SCHEDULE_CONTROL=true` and restart again before C2 and C3: from then on the
gate follows every schedule, booking and rule that includes it.

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

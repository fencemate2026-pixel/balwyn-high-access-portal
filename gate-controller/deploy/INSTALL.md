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
| Relay pin | The GPIO your board actually uses for its channel, e.g. Waveshare 3-channel RPi Relay Board = GPIO 26 / 20 / 21; **Keyestudio KS0212 shield = GPIO 4 / 22 / 6 / 26, ON when HIGH** (section 1c). Set `RELAY_PIN` to it, and keep reed and safety inputs off the board's other relay pins | Using the example's GPIO 17 on a board wired to GPIO 26 drives nothing, or the wrong thing. With `RELAY_BOARD=keyestudio-ks0212` the controller refuses any pin plan that breaks this. |
| Reed switches | Normally-open (make when the magnet is present), one at closed, one at open | See section 1. |
| Meter | Continuity/resistance across relay COM–NO | Tests B0 and B3. |

## 1. What is wired

| Pi input / output | Goes to | Notes |
|---|---|---|
| Relay module (RELAY_PIN) COM/NO | Operator open / hold input and its common (Venus: **IN2**, "Hold to keep open"; never IN1, which carries the ACB-004 DR1) | Confirm the terminals on the operator's own wiring diagram. Not a step-by-step input. |
| CLOSED_REED_PIN + GND | Magnetic reed at the **closed** position | Required. Made = fully closed. |
| OPEN_REED_PIN + GND | Magnetic reed at the **open** position | Fitted at Balwyn. Made = fully open. This is what lets the portal confirm an open. |
| SAFETY_INPUT + GND | Volt-free contact that is made while the operator's safety circuit is healthy | Without it the controller is monitor-only: it reports position, never moves the gate. Venus gates: a BEM-41F relay with its coil on Venus OUT2 (24 V AUX); its COM goes to SAFETY_INPUT (TF GPIO5 pin 29, SIDE GPIO6 pin 31) and its NO to GND (pin 30). It proves Venus power only (section 1d). |

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

## 1a. Roger F70/IPU36 operator (only if a gate really has one; Balwyn uses Venus, see 1d)

**Superseded for Balwyn, 15 Oct 2026:** the Balwyn gates are two small pedestrian gates and the operator
chosen is the Locinox Venus (section 1d). Use this section only for a gate that is confirmed to have a
Roger F70/IPU36 control unit.

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

## 1b. Access board (ACB-004) and magnetic lock (older plan, added 11 Oct 2026)

**Only if the lock stays powered through the school's ACB board and the operator cannot release it
itself.** With a Venus whose OUT1 powers the lock (section 1d) none of this is needed: no unlock relay,
no K1 sense contact.

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

## 1c. Keyestudio KS0212 relay shield, both gates on one Pi (added 15 Oct 2026)

**Only if you want a 4-relay shield (two gate relays and two unlock relays).** The Venus plan in
section 1d needs two relays in total, so any 2-channel board works.

Source: Keyestudio KS0212 documentation (docs.keyestudio.com/projects/KS0212):
the sample code drives the four relays from BCM GPIO **4, 22, 6, 26** and
switches a relay ON by setting its pin **HIGH**. Contacts: 10 A 250 VAC /
30 VDC. Which physical relay answers to which GPIO is not stated: identify each
one by its LED during test B0 and label it.

**If your Keyestudio board is a loose module with jumper wires (not a shield
that plugs onto the header), this section does not apply:** use
`venus-TF-ENTRY.env.example` / `venus-SIDE-ENTRY.env.example` (section 1d, `RELAY_BOARD=generic`) and prove the
pins and polarity at B0. Do not start from `gate.env.example`: its pins (relay GPIO 17, active low, closed reed 22)
and 1 s pulse are a generic sample, not this installation's wiring.

Proposed pin plan (copy `ks0212-TF-ENTRY.env.example` and `ks0212-SIDE-ENTRY.env.example`):

| Function | TF-ENTRY | SIDE-ENTRY | Header pin (TF / SIDE) |
|---|---|---|---|
| Gate relay -> F70 34 (AP) / 32 (COM) | GPIO 22 | GPIO 26 | shield |
| Unlock relay -> ACB-004 P*n* / GND | GPIO 4 | GPIO 6 | shield |
| Closed reed | GPIO 17 | GPIO 23 | 11 / 16 |
| Open reed | GPIO 27 | GPIO 24 | 13 / 18 |
| Safety (F70 COR 19/18) | GPIO 5 | GPIO 25 | 29 / 22 |
| K1 spare contact (board unlocked) | GPIO 13 | GPIO 16 | 33 / 36 |
| Input common | GND | GND | 9, 14, 20, 25, 30, 34, 39 |

Why gate relays on 22 / 26: from power-on, before Linux runs, GPIO 0-8 have a
pull-UP and GPIO 9-27 a pull-DOWN (BCM2711 reset state). On an ON-when-HIGH
board a pull-down keeps the relay off; a pull-up on GPIO 4 / 6 might be enough
to switch a relay on during boot. That is UNVERIFIED for this shield, so:

1. Add this line to `/boot/firmware/config.txt` (drives all four relay pins LOW
   from early boot): `gpio=4,6,22,26=op,dl`
2. Test B0 with the meter on each of the four relays in turn, including the two
   unlock relays (GPIO 4 and 6): open through power-on, the whole boot and a reboot.

Reaching the input pins: if the shield covers the 40-pin header and does not
pass the pins through, fit a stacking header or GPIO breakout between the Pi
and the shield. Check this on the actual shield before site day (UNVERIFIED).

The ACB-004 door number for each gate (P1, P2 ...) must come from the S4A
software and the as-built wiring, not from this table.

Read-only checks on the Pi before the first start:
* `grep -n 'w1-gpio' /boot/firmware/config.txt` must print nothing: GPIO 4 is
  the default 1-Wire pin, and the controller would then find it busy.
* `cat /sys/module/pinctrl_bcm2835/parameters/persist_gpio_outputs` (if the
  file exists): `Y` means a released output keeps driving its last level, so a
  killed controller relies entirely on `relays-off` (test B4). Record the value.
* After test B0, power-cycle the Pi five times with the ACB-004 connected and
  "Record Push Button Events" ticked: the ACB log must show NO push-button event
  from the boots (an unlock relay on GPIO 4 / 6 must not press during power-up).

Power: four relay coils come off the Pi's 5 V. Use the official Raspberry Pi 4
power supply (5.1 V 3 A).

## 1d. Locinox Venus operator, two pedestrian gates on one Pi (decided 15 Oct 2026)

Source: Locinox Venus advanced settings manual (2024-09-23 rev1; page numbers below) and the Edgesmith /
Locinox Venus architects and engineering specification sheet (2024). There are two separate pedestrian gates,
each 1300 mm wide x 1800 mm high, square tubular style, each with one magnetic lock. People enter with an RFID
reader and leave with a push button, and either gate can also be opened from Magic Keys (stated by Jarrod, 15 Oct
2026). Also stated by Jarrod on 15 Oct 2026 (not measured or checked by Claude): the motors on both gates are
Venus; each gate weighs about 40 kg (the Venus limit is 100 kg); the gates are tubular, so Jarrod judges wind load
to be small; the magnetic locks accept 12 V or 24 V.

**Still to confirm before buying or fitting:**
* The lock's make and model: MAGMAG-3000-BLK on the TF-ENTRY bench rig (23–24 Oct 2026), wired for 24 V. Confirm the same model on each site gate. If it is, the Locinox MAG-3000 /
  MAGMAG-3000 fitting sheet (MANU-000414, 2023-08-18 rev 3) gives: 300 kg (3000 N), 12 V DC 0.66 A or 24 V DC
  0.33 A, 7.9 W either way. A retailer page lists different currents (about 500 mA at 12 V, 250 mA at 24 V), so the
  fitting sheet is the authority and the retailer figures are not used. The Venus outputs are 24 V DC only (p. 6), so
  the lock must be wired for 24 V.
  **24 V wiring, from the fitting sheet drawing (step 5):** RED to +24 V, **WHITE and BLACK joined to each other**,
  YELLOW to 0 V (through the switching contact). **12 V wiring, same drawing:** RED and WHITE both to +,
  BLACK and YELLOW both to 0 V. So at 24 V the wires that are joined are WHITE and BLACK (the two middle wires),
  and BLACK does **not** go to 0 V. Jarrod's statement "24 V is just joining the negative wires together" does not
  match the drawing: joining BLACK to YELLOW on a 24 V supply is the 12 V wiring, which puts 24 V across coils
  rated for 12 V (about double the current, 7.9 W becomes roughly 31 W, if the coils are as in the 12 V drawing;
  that last figure is Claude's arithmetic, not a Locinox number). Wire it to the drawing, not from memory.
  The retailer listing for 40-80 mm square profiles is not in the fitting sheet; the tube size at the lock is still
  to be measured. Whether the lock is fail-safe (opens when power is lost) is from the retailer page only.
  Check the current at bench test V6 before powering the lock from the Venus.
* The Venus pages read give no limit for an 1800 mm high gate or for wind load. Jarrod's judgment is that wind is a
  small effect on a tubular gate; Locinox has not been asked.

Venus limits (spec sheet): gate up to 100 kg and 1400 mm wide, opening angle up to 175 degrees, hinge-side
profile at least 80 mm wide with steel at least 2 mm thick, a strike is needed so the Venus can find its zero
position, it must be combined with an electric or mechanical lock, and it is set up only through a phone app.

Per gate:

| Venus terminal | Goes to | Venus app setting |
|---|---|---|
| **OUT1** | The gate's magnetic lock, 24 V DC | Lock. Fail open for a magnetic lock. The Venus detects the lock type itself at first calibration (p. 8). |
| **OUT2** | Coil of a small 24 V DC relay. That relay's contact goes to the Pi safety input and GND. | 24V AUX (p. 7) |
| OUT3 | Spare | Unused |
| **IN1** | ACB door relay contact. It carries the RFID entry, and also the exit push button if that button is wired to the ACB's exit input (P1-P4), so every entry and exit is logged by the ACB. | Control device, Normally Open, "Open and close" (p. 12). Set the pause time long enough for a person to walk through (0-300 s, p. 18). |
| **IN2** | **Pi gate relay COM/NO** | Control device, Normally Open, **"Hold to keep open"** (p. 13) |
| IN3 | Spare (a fire-panel link only if the fire designer asks for one) | Unused |

The Pi also reads a closed reed and an open reed per gate (section 1). The Pi needs **one relay per gate, two in
total**, and no unlock relay or K1 sense contact: the Venus releases its own lock first and has a 0-5 s
"delay after unlocking" for magnetic locks (p. 18). Pin plan: `venus-TF-ENTRY.env.example` and
`venus-SIDE-ENTRY.env.example`.

| Function | TF-ENTRY | SIDE-ENTRY |
|---|---|---|
| Gate relay | GPIO 22 | GPIO 23 |
| Closed reed | GPIO 17 | GPIO 24 |
| Open reed | GPIO 27 | GPIO 25 |
| Safety (OUT2 relay contact) | GPIO 5 | GPIO 6 |

Rules from the Venus manual:
* The three outputs together are limited to 2 A / 48 W. An overload shuts ALL outputs off and the built-in
  light blinks at 5 Hz (p. 7). Count the lock and the OUT2 relay coil.
* The inputs are dry contacts only. A signal that carries a voltage must go through a relay (pp. 4, 10).
* **"Hold to keep open" (p. 13):** the gate opens and stays open while the contact is closed. When the contact is
  released the Venus waits the pause time (default 5 s, 0-300 s) and closes. **If the contact is released while
  the gate is still opening, the Venus closes it again.** So the controller's pulse (`CYCLE_PULSE_S`) must
  last longer than the measured time from the contact closing to the gate fully open (maximum 10 s). That time
  is not only the open travel: the Venus starts moving only after the **pre-flash time** (0-10 s, p. 25: the lock
  is not released and the gate does not move during it) and the **delay after unlocking** (0, 0.5, 1, 2, 3 or
  5 s, p. 18, set automatically at calibration for a magnetic lock). Measure the whole time on the bench (V2).
  If pre-flash + unlock delay + open travel is more than about 9 s, a pulse cannot work: use a hold instead, or
  shorten the pre-flash. If the gate is closed by hand while the contact is held, it opens again after the pause time.

What the safety input means with a Venus: the Venus has no "operator healthy" contact (its outputs are 24 V
power only). A relay on OUT2 only proves the Venus has power and has not shut its outputs off. It does not
report a Venus fault, a blocked gate or an obstacle (the Venus's own obstacle detection keeps working). Without any safety input the controller is monitor-only and never moves the gate.

Lock and fire: moving the lock supply from the school's ACB board to the Venus changes the lock's
fire-release path. That is the fire designer's decision, not settled here. The certified fire panel remains
the life-safety authority for fire.

Controller settings for a Venus: `RELAY_BOARD=generic`, `UNLOCK_RELAY_PIN=none`, `UNLOCK_SENSE_PIN=none`,
`CYCLE_PULSE_S` longer than the measured time from contact closing to fully open (pre-flash + unlock delay + open
travel), `AUTO_CLOSE_TIMEOUT_S` longer than the Venus pause time
plus close travel plus 50 %. The two example files carry placeholders (8, 20, 60), not measurements: set them at
test C1.

Make the firmware hold both relay pins low from early boot (for a board that is ON when its pin is HIGH): add
`gpio=22,23=op,dl` to `/boot/firmware/config.txt`. For an active-low board use `op,dh` instead and set
`RELAY_ACTIVE_LOW=true`. The polarity of the board actually used is UNVERIFIED: test B0 decides.

Bench checks before site, with the relay board NOT connected (all UNVERIFIED until done). Close the Venus input
with a switch, never with the Pi relay:
* **V1** IN2 closed by hand for 10 minutes: the gate opens and stays open; released: it closes after the pause time.
* **V2** IN2 closed for 1 second only: record whether the gate stops opening and closes (the manual says it does).
  Then close IN2 and hold it, and stopwatch the whole time from closing the contact to the gate fully open
  (this includes pre-flash and the unlock delay). This number sets `CYCLE_PULSE_S`.
* **V3** IN2 closed for 2 hours: the gate stays open (the manual states no time limit).
* **V4** IN1 pulsed while IN2 is held: record what the Venus does (the manual does not say).
* **V5** Meter across the open IN2 terminals: record the voltage and the closing current, then pick the relay.
* **V6** Lock on OUT1 plus the OUT2 relay coil: total current under 2 A, and the lock releases before the gate moves.
  Before connecting the lock to the Venus, wire it as the fitting sheet's 24 V drawing shows (RED +, WHITE joined to
  BLACK, YELLOW 0 V), power it alone from a 24 V supply through a meter and read the current. For a MAGMAG-3000 the
  fitting sheet figure is 0.33 A at 24 V; a reading near 0.66 A suggests the lock is wired for 12 V, so switch off and
  re-check the WHITE/BLACK link. The lock model on site may differ, so use the figure on its own label. Also do a hand
  pull test on the closed gate to confirm it holds.
* **V8** IN1 closed for 5 seconds (the ACB door relay's unlock time) and then released: record whether the gate runs
  one full open, pause and close cycle, and whether the contact ending mid-opening changes anything. Then press
  the exit button on the ACB and confirm the same cycle (the manual does not describe a short contact in
  "Open and close" mode, UNVERIFIED).
* **V7** Watch the OUT2 relay for 30 minutes with the gate closed and idle, then through one full open and close:
  record whether OUT2 stays powered throughout. The controller treats a dropped OUT2 as "safety not healthy" and
  refuses commands, so an OUT2 that switches off at idle would make the gate uncommandable. The manual says 24V AUX
  "provides constant power 24V DC" (p. 7) and that all outputs shut off on overload, but it does not say what
  happens in sleep or standby, so prove it on the bench (UNVERIFIED).

The controller tests (`VenusOperatorTests`) run the real controller against a simulated Venus built only from the
manual's "Hold to keep open" description (p. 13). They prove the controller's logic matches that description: a
pulse shorter than the open travel is reported as failed and never as open, a hold keeps the gate open past the
pause time, and a lost safety input releases the contact. They do not prove how a real Venus behaves: V1-V8 do.

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

Set the clock zone so the audit log reads in school time:
`sudo timedatectl set-timezone Australia/Melbourne`

Only ONE program may drive the relay board. This must print nothing:
`systemctl list-unit-files | grep -E 'compass-door-open|balwyn-relay-agent'`
(those are older programs in this repository; never install them on this Pi).

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

**Required for every board** (15 Oct 2026; it was "recommended"): make the firmware hold
every relay pin OFF from early boot, before Linux and the controller start. The Pi's pins 9 to 27
are pulled LOW at power-up and the controller only claims its relay pin once the service starts,
so an active-LOW relay board (ON when the pin is LOW) would be switched ON for the whole boot without this line.
Add ONE line to `/boot/firmware/config.txt` listing every relay pin of BOTH gates:
`gpio=4,6,22,26=op,dl` for the KS0212 (ON when HIGH). For an active-low board
(`RELAY_ACTIVE_LOW=true`) use `op,dh` instead, e.g. `gpio=17=op,dh`. The
Raspberry Pi documentation notes a delay of a few seconds between power being
applied and this taking effect, so test B0 is still required. For the Venus plan
(section 1d, relays on GPIO 22 and 23, ON when HIGH) the line is `gpio=22,23=op,dl`.

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
   sudo cp deploy/venus-TF-ENTRY.env.example /etc/balwyn-gate/TF-ENTRY.env
   sudo chgrp balwyn-gate /etc/balwyn-gate/TF-ENTRY.env && sudo chmod 640 /etc/balwyn-gate/TF-ENTRY.env
   sudo nano /etc/balwyn-gate/TF-ENTRY.env
   ```
   (This line copies the Venus file. For the second gate use `SIDE-ENTRY` with `venus-SIDE-ENTRY.env.example`.
   The Keyestudio KS0212 shield: `ks0212-*.env.example`. Any other operator or board: `deploy/gate.env.example`,
   whose 1 s pulse is wrong for a Venus: a Venus needs a pulse longer than its open travel, see section 1d.)
   Set the pins and timings; keep `DRY_RUN=true` and `SCHEDULE_CONTROL=false`.
   Comments must stay on their own lines: `RELAY_PIN=17  # note` is refused.
3. Check the settings. With `DRY_RUN=true` still set, start the service once and read its first lines:
   ```
   sudo systemctl start balwyn-gate@TF-ENTRY
   journalctl -u balwyn-gate@TF-ENTRY -n 20 --no-pager
   ```
   The first line is either `OK: gate TF-ENTRY, relay board generic, relay ON when HIGH, relay GPIO22, ...` or
   `Configuration error: <SETTING> ...`.
   A configuration error stops the controller before it starts; systemd then drives the relay pins OFF
   (`relays-off`) and retries every 3 s until the file is fixed.
   With both gates' files written, also check that no GPIO pin is used by two gates (each file is otherwise
   checked on its own only):
   ```
   cd /opt/balwyn-gate-controller && sudo python3 -m balwyn_gate_controller check-pin-plan
   ```
   It must print `OK: no GPIO pin is shared ...`. It reads the files only and touches no GPIO.

## 4. Prove the inputs (relay stays OFF)

```
sudo systemctl stop balwyn-gate@TF-ENTRY
cd /opt/balwyn-gate-controller && sudo -u balwyn-gate env $(sudo grep -v '^#' /etc/balwyn-gate/TF-ENTRY.env | grep -v TOKEN | xargs) python3 -m balwyn_gate_controller read-inputs
```
(The second command is one long line. The env file is readable only by root, so the inner `grep` needs its own
`sudo`; without it the settings come out empty and the command stops with "PORTAL_URL is required". If it says a
GPIO is already in use, the other gate's service on this Pi is holding that pin: check with `sudo pinctrl get`
instead of stopping it.) `read-inputs` does not contact the portal, so it needs no credential and none
is put on the command line (a token typed there is visible to every user in `ps` and is written to the sudo log).
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
| C1 open cycle | Dashboard OPEN | Gate opens, portal shows **open confirmed**, gate auto-closes, portal shows closed. Record open travel and auto-close time; set `TRAVEL_TIMEOUT_S` and `AUTO_CLOSE_TIMEOUT_S` to measured + 50 %. **Venus:** also set `CYCLE_PULSE_S` longer than the time from contact closing to fully open, including pre-flash and unlock delay (max 10 s); a pulse that ends before the gate is fully open makes the Venus close it again. |
| C2 hold window | Automation: one-off rule, 10-minute window starting in 2 minutes | Opens at the start, stays open past the auto-close time, releases and closes at the end. |
| C3 booking | Facility hire booking for the stadium, 10 minutes, lead/run-out 1 minute | Same as C2, and both show on the School scheduler. |
| C4 safety | Break the safety input while a hold is active; then press OPEN | Hold released and gate closes; OPEN refused as **blocked**; portal shows safety not healthy. |
| C5 network loss | Unplug the network during a hold | Hold released after `NETWORK_LOSS_RELEASE_S`; portal shows the gate offline, then back. |
| C6 fire | START FIRE / EVACUATION, then unplug the network for 2 minutes | Gate opens and **stays held** with the network down. Reconnect, clear fire, press CLOSE: released and closes. |
| C7 restart mid-window | During a C2 or C3 window, `sudo reboot` the Pi | Gate releases and auto-closes during the reboot; about 1 minute after the controller is back, the portal re-sends OPEN and the gate re-opens for the rest of the window (activity log: "Scheduled relay command re-sent"). If staff pressed CLOSE in that window, it must NOT re-open. |
| B3 reboot | Assert a hold, then `sudo reboot`. Meter across relay COM/NO | Contact opens at shutdown and **stays open through the whole boot**; gate auto-closes; controller comes back and reports closed. |
| B4 killed controller | Assert a hold, then `sudo systemctl kill -s SIGKILL balwyn-gate@TF-ENTRY` (the controller gets no chance to clean up). Meter across relay COM/NO | Contact opens within about 2 s and stays open until the controller restarts; `journalctl -u balwyn-gate@TF-ENTRY` shows `relays-off: GPIO ... driven OFF`. The other gate is not disturbed. Repeat with the unlock relay: start an OPEN and kill during the 0.5 s press; the unlock relay must be off afterwards. |

B3 and B4 are the tests the design rests on: a Pi that restarts, or a
controller that is killed, must never leave a gate held open.

## 7. Logs

* Service log: `journalctl -u balwyn-gate@TF-ENTRY`
* Audit trail (every relay action, command and portal outage): `/var/lib/balwyn-gate/TF-ENTRY/audit.jsonl`
* Portal: **Activity log** records every command and the controller's acknowledgement.


## Fire / evacuation hold after a restart (15 Oct 2026)

The controller remembers an active fire hold in `state.json`. If the controller stops and starts again (crash, power cut,
update) within `EMERGENCY_RESTORE_MAX_S` (12 h) of the hold beginning, it switches the hold back on, logs
`emergency_hold_restored`, and keeps it until the portal sends the all-clear close. Test C7b: during a fire hold run
`sudo systemctl restart balwyn-gate@TF-ENTRY`; the relay must come back on within about 5 s and stay on. Then send the
all-clear from the portal; the relay must go off, and another restart must NOT switch it on.

To clear a hold the portal cannot end (portal down for good): stop the service, then
`sudo python3 -c "import json,sys;p='/var/lib/balwyn-gate/TF-ENTRY/state.json';d=json.load(open(p));d['emergency_since']=None;json.dump(d,open(p,'w'))"`
and start it again. Write that down on the site sheet; nothing else ends a restored hold.

A hold older than `EMERGENCY_ALARM_S` (4 h) shows a fault on the portal ("Fire / evacuation hold has been on for N h").
Opens are limited to `OPEN_RATE_MAX` (30) per `OPEN_RATE_WINDOW_S` (10 min); a fire open is never limited.
While the local safety circuit is not healthy the portal now hands the controller a CLOSE (never an OPEN), so a fire hold
can still be ended remotely.

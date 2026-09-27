# gate-controller

Connects one gate operator to the Magic Keys portal through a single relay
contact, a closed reed, an optional open reed and a safety input. Outbound
HTTPS polling only. See `deploy/INSTALL.md` for wiring, install and the
commissioning sheet.

Supersedes `controller-agent/` for the single-contact auto-closing operators at
Balwyn (that agent needs separate open/close relays, two limit switches and an
e-stop input, and exits at start-up on the agreed hardware). Remove
`controller-agent/` and `pi-door-service/` once this controller is commissioned.

Tests (no GPIO, no relay can be driven):
```
python3 -m unittest discover -s gate-controller/tests      # controller + relay + simulated gate
node --test tests/gate-controller-e2e.test.mjs             # real controller against the real portal routes
```

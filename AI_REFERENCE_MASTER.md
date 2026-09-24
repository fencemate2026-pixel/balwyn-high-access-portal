# 🤖 MASTER AI REFERENCE — Magic Keys Portal & Sentinel Wayfinding

**For Copilot & AI Development Agents**  
RJL Commercial Group · September 2026  
**Status:** Development reference. Distinguish demonstration behaviour, optional relay pulses and independently verified physical feedback.

## Current portal identity and configuration

See [LOGIN_AND_ADMIN_SETUP.md](LOGIN_AND_ADMIN_SETUP.md) for the current authentication contract.
Google and email/password plus authenticator sign-in are implemented. Microsoft/Hotmail
OAuth requires its runtime app registration and immutable account approvals before use.
Configuration APIs require a password-verified administrator session with a ten-minute
unlock. User profiles and photo uploads use D1 and R2; display fields never grant roles.
Preserve these server-side checks when changing schedules, automation, controller
credentials, system settings or administration of another user's profile.

Core-plan visitors can now explore labelled, fictional CCTV/zone, emergency
guidance and classroom-display examples. `app/plan-upgrade-gate.tsx` keeps all
preview interactions in local React state with no operational API calls. These
examples are sales demonstrations, not a connected camera, routing or broadcast
service. The server remains the source of plan entitlements. See
`LOGIN_AND_ADMIN_SETUP.md` for the demo boundary and Google origin configuration.

---

## 📋 QUICK NAVIGATION

| System | Repository | Purpose | Status |
|--------|------------|---------|--------|
| **Magic Keys Portal** | `balwyn-high-access-portal` | Gate demonstration and optional open-only trigger | Demo; hardware requires configuration |
| **Sentinel Wayfinding** | `sg-pro-sentinel` | Evacuation routing (synthetic-only) | ✅ Staged development |

---

## Compass ACB-004 integration contract

The ACB-004 is the existing four-door access board onsite, associated with the
school's Compass installation. It is retained. The supplied S4A manuals describe
native Ethernet management, but do not supply a verified Magic Keys API.

The implemented path is authenticated HTTPS to an onsite Pi service, then one
isolated relay contact to a verified ACB-004 request-to-exit input. This replaces
any proposed TCP/IP protocol adapter description; no proprietary ACB packet
protocol, reader database sync or controller network commands are implemented.

- Service: `pi-door-service/door_service.py`, `POST /doors/{1-4}/open` only.
- The bundled `pi-door-service` tests require 300–800 ms pulses, default 500 ms. The portal gateway accepts acknowledgements up to 10,000 ms, but that does not change the service's configured bounds or prove an installed version supports a longer pulse.
- Mock/dry-run by default; explicit verified hardware configuration required.
- One-way open-only trigger: no closing, toggling, hold-open or emergency actuation.
- No live door, lock-release or safety feedback. `pulsed` acknowledges the relay
  output only; `dry_run` means no hardware operation. Position remains unknown.
- Durable request IDs prevent replay after retries/restarts. Do not auto-retry
  ambiguous outcomes or turn relay acknowledgements into green/open status.
- The static Netlify demo retains its simulations when unconfigured. Its separate
  operator token is required for real requests; demo login is not hardware auth.
- Sites uses existing server-verified operator permissions and emergency priority.
  Its separate sensor-equipped agent must not be conflated with this ACB path.
- A board has four door channels; do not invent mappings for the nine registered access points.

### Maglock and Roger F70/IPU36 constraints

A powered maglock relay COM and a Roger dry-contact input must stay electrically
separate. Never use the same powered COM/NO side to inject lock voltage into the
motor controller. Use a correctly rated local interface/sequencer with isolated
contacts; the Pi service itself does not sequence lock release and motor motion.

The referenced Roger installer manual pairs **34 AP with 32 COM** for open, and
**36 PP with 38 COM** for step-by-step. PP is excluded from the open-only design.
Check the actual installed model/revision before wiring. The Pi pulse duration
is separate from the lock-release period; 3–5 seconds is not an approved default.
Local release-before-motion, relocking and emergency release must be validated
onsite. See `pi-door-service/README.md` and the System Settings wiring reference.

Never use real students, footage, secrets or live relay hardware in tests.
Run `npm run test:doors` for the mocked integration tests, plus the relevant
hosting build before committing. Test results do not certify field wiring.

---

## 🎯 WHAT YOU'RE LEARNING

### **System 1: Magic Keys Portal**

**What it does:**
- Lists nine access points: two active and seven inactive. Active status does not establish a physical gate position; green/open and red/closed indicators require current controller feedback.
- Lockdown is unavailable; `resolveEmergencyCommand("lockdown")` throws.
- Fire evacuation queues OPEN on `ACTIVE_GATES` only through the separate controller command queue, never through the open-only door service.
- Weekly scheduling per gate
- Activity logging with audit trail
- Operator authentication (demo: paul sutton / REDACTED)

**Tech stack:**
- **Frontend:** React 19, Next.js 16, TypeScript, Tailwind CSS, shadcn/ui
- **Production build:** Next.js (`npm run build`); Vite remains in the test tooling.
- **Website hosting:** Azure App Service `magickeys-balwyn-portal`, container `magickeysbalwyn.azurecr.io/magickeys-portal:<git-sha>`. A merge is not live until the image is rebuilt and the app restarts.

**Gate system:**
- **Tony Frizza Stadium:** active single swing entry and inactive single swing exit
- **Side Entry:** active single swing gate
- **Staff Car Park:** inactive double swing entry and inactive entry boom
- **Office:** inactive Entry 1 and Exit 1 double swing gates, plus inactive Entry 1 and Exit 1 boom gates

**Emergency policy:**
- **LOCKDOWN:** Unsupported and rejected server-side; no lockdown-close controls or voice.
- **FIRE/EVACUATION:** Queue OPEN for active gates only. Do not infer movement, PA delivery or a safe route from a queued command.
- Help chat and Foundry remain Q&A only, without door or emergency action tools.

---

### **System 2: Sentinel Wayfinding (SG-PRO)**

**What it does:**
- Provides safe evacuation routes for each classroom
- Integrates with fire panel signals
- Logs all scenarios synthetically (no real data)
- Human-approved learning only (no autonomous changes)

**Current scope:** Stage 1 synthetic prototype only
- ✅ Route planning from synthetic floor plans
- ✅ Scenario replay & testing
- ✅ Local-only run logging
- ✅ Human-review improvement reports
- ❌ Real CCTV/footage
- ❌ Automatic learning from live data

---

## 📊 WHAT DATA YOUR AI CAN ACCESS

### ✅ **SAFE — AI can see and learn from:**

**Magic Keys:**
- All source code (React, Next.js, TypeScript)
- Component architecture
- Configuration files
- Public assets
- Test files
- Documentation

**Sentinel:**
- Synthetic layout JSON
- Synthetic scenarios
- Python CLI code
- Test suite
- Documentation
- Compliance constraints

### ❌ **OFF-LIMITS — AI must never see:**

- Real student/staff names or IDs
- Real CCTV footage or camera locations
- Real emergency procedures
- Real access control credentials
- Real incident data
- Passwords, API keys, tokens
- Student/staff biometric data

---

## 🚀 QUICK START FOR AI LEARNING

### **Step 1: Understand Magic Keys Portal**

```bash
cd ~/Downloads/balwyn-high-access-portal
npm install
npm run dev
# Open http://localhost:5173
# Login: paul sutton / REDACTED
```

### **Step 2: Understand Sentinel Wayfinding**

```bash
cd ~/cocoapi/PythonAPI/sg-pro-sentinel
source .venv/Scripts/activate
sentinel-wayfinding --scenarios examples/scenarios.json
# See: 3/3 scenarios PASS
```

### **Step 3: Ask Your AI to Learn**

- "Explain why lockdown is rejected and how fire-open packets are queued"
- "Design 3 new synthetic evacuation scenarios"
- "How could we integrate Sentinel routing into Magic Keys?"

---

## 🎓 WHAT YOUR AI SHOULD UNDERSTAND

### **Core Concepts**

1. **Gate Automation (Magic Keys)**
   - 3 gate types, 3 campus areas
   - Normal operation and fire-only emergency requests; legacy lockdown state is not a supported action
   - Emergency overrides everything

2. **Evacuation Routing (Sentinel)**
   - Deterministic (no ML randomness)
   - Synthetic-only (no real data)
   - Human-approved (every change reviewed)

3. **Safety-Critical Design**
   - Verify the installed local fail-safe and emergency-release design; do not infer it from a simulation
   - Human-in-the-loop (verification before actuation)
   - Audit trail (every action logged)

4. **AI Limitations**
   - Cannot detect concealed weapons
   - Cannot assess intent
   - Cannot replace fire detection
   - False alarms are inevitable (design for them)

---

## ✨ FINAL WORDS

This reference covers two development surfaces:
1. **Magic Keys Portal** — Demonstration with an optional, authenticated open-only relay path
2. **Sentinel Wayfinding** — Research prototype for safe evacuation routing

**The AI should understand:**
- ✅ How to extend both systems
- ✅ Why safety-critical systems need human approval
- ✅ Why synthetic-only is mandatory until compliance approval
- ✅ How to write testable, deployable, auditable code

**The AI should NOT:**
- ❌ Use real school data
- ❌ Bypass human verification
- ❌ Make autonomous safety decisions
- ❌ Commit code without tests passing

---

**You built this. Your AI will help you make it better. Let's go.** 🚀


## Gate activation register — September 2026

- `TF-ENTRY`: Tony Frizza Stadium Entry — single swing — **Active**.
- `SIDE-ENTRY`: Side Entry — single swing — **Active**.
- `TF-EXIT`: Tony Frizza Exit Single Gate — single swing — **Inactive**.
- `OFFICE-ENTRY-DG1`: Office Entry 1 Double Swing Gates — **Inactive**.
- `OFFICE-EXIT-DG1`: Office Exit 1 Double Swing Gates — **Inactive**.
- `STAFF-ENTRY-DG`: Staff Car Park Entry Double Swing Gates — **Inactive**.
- `STAFF-ENTRY-BOOM`: Staff Entry Boom Gate — **Inactive**.
- `OFFICE-ENTRY-BOOM1`: Office Entry 1 Boom Gate — **Inactive**.
- `OFFICE-EXIT-BOOM1`: Office Exit 1 Boom Gate — **Inactive**.

Use Active / Inactive labels, with no payment labels. Inactive entries are greyscale, with lights off and commands, schedules, commissioning and remote-open blocked. Current open feedback gives green lamps; current closed feedback gives red lamps. Missing, stale, pending or faulted feedback uses amber, without declaring a physical position. Emergency commands target only the two active gate IDs. Retired IDs are no longer accepted. Preserve existing audit history and never infer a door channel from a name or display order.

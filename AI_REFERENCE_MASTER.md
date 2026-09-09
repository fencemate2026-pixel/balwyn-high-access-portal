# 🤖 MASTER AI REFERENCE — Magic Keys Portal & Sentinel Wayfinding

**For Copilot & AI Development Agents**  
RJL Commercial Group · September 2026  
**Status:** Development reference. Distinguish demonstration behaviour, optional relay pulses and independently verified physical feedback.

---

## 📋 QUICK NAVIGATION

| System | Repository | Purpose | Status |
|--------|------------|---------|--------|
| **Magic Keys Portal** | `balwyn-high-access-portal` | Gate demonstration and optional open-only trigger | Demo; hardware requires configuration |
| **Sentinel Wayfinding** | `sg-pro-sentinel` | Evacuation routing (synthetic-only) | ✅ Staged development |

---

## Current checked reference

Start with [BALWYN_INTEGRATION_STATUS.md](BALWYN_INTEGRATION_STATUS.md). It records
the current wiring corrections, implementation limits, website changes, tests
and live-connection status. Use it to distinguish this static demonstration
from the separately hosted Sites portal. Repository updates make information
available for ingestion; they do not automatically train or refresh an AI model.

## Compass ACB-004 integration contract

The ACB-004 is the existing four-door access board onsite, associated with the
school's Compass installation. It is retained. The supplied S4A manuals describe
native Ethernet management, but do not supply a verified Magic Keys API.

The implemented path is authenticated HTTPS to an onsite Pi service, then one
isolated relay contact to a verified ACB-004 request-to-exit input. This replaces
any proposed TCP/IP protocol adapter description; no proprietary ACB packet
protocol, reader database sync or controller network commands are implemented.

- Service: `pi-door-service/door_service.py`, `POST /doors/{1-4}/open` only.
- Fixed 300–800 ms pulse on exactly one mapped BCM relay pin; default 500 ms.
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
- A board has four door channels; do not invent mappings for the 17 campus gates.

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
- Demonstrates 17 gate positions across the campus; these are simulated, not live sensor readings
- Demonstrates emergency lockdown (no physical command through the open-only service)
- Demonstrates fire/evacuation (no physical emergency operation through the open-only service)
- Weekly scheduling per gate
- Activity logging with audit trail
- Operator authentication (demo: paul sutton / magic-keys)

**Tech stack:**
- **Frontend:** React 19, Next.js 16, TypeScript, Tailwind CSS, shadcn/ui
- **Build:** Vite + Vinext
- **Deployment:** Netlify (static export)

**Gate system:**
- **Tom Frizza Sports Area:** 2 sliding gates
- **Staff Car Park:** 12 boom gates
- **Front Property:** 3 double-swing gates

**Simulated emergency modes:**
- **LOCKDOWN:** Close all gates, repeat voice warnings every 6.5s
- **FIRE/EVACUATION:** Open all gates, PA announcement, dynamic routing

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
# Login: paul sutton / magic-keys
```

### **Step 2: Understand Sentinel Wayfinding**

```bash
cd ~/cocoapi/PythonAPI/sg-pro-sentinel
source .venv/Scripts/activate
sentinel-wayfinding --scenarios examples/scenarios.json
# See: 3/3 scenarios PASS
```

### **Step 3: Ask Your AI to Learn**

- "Explain how the emergency lockdown loop works"
- "Design 3 new synthetic evacuation scenarios"
- "How could we integrate Sentinel routing into Magic Keys?"

---

## 🎓 WHAT YOUR AI SHOULD UNDERSTAND

### **Core Concepts**

1. **Gate Automation (Magic Keys)**
   - 3 gate types, 3 campus areas
   - Normal, lockdown, fire modes
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

# 🤖 MASTER AI REFERENCE — Magic Keys Portal & Sentinel Wayfinding

**For Copilot & AI Development Agents**  
RJL Commercial Group · September 2026  
**Status:** Production reference. Two systems, one AI knowledge base.

---

## 📋 QUICK NAVIGATION

| System | Repository | Purpose | Status |
|--------|------------|---------|--------|
| **Magic Keys Portal** | `balwyn-high-access-portal` | Gate automation & emergency controls | ✅ Live (Netlify) |
| **Sentinel Wayfinding** | `sg-pro-sentinel` | Evacuation routing (synthetic-only) | ✅ Staged development |

---

## 🎯 WHAT YOU'RE LEARNING

### **System 1: Magic Keys Portal**

**What it does:**
- Controls 17 automated gates across Balwyn High School campus
- Manages emergency lockdown (close all perimeter gates)
- Manages fire/evacuation (open all gates + dynamic routing)
- Weekly scheduling per gate
- Activity logging with audit trail
- Operator authentication (demo: paul sutton / magic-keys)

**Tech stack:**
- **Frontend:** React 19, Next.js 16, TypeScript, Tailwind CSS, shadcn/ui
- **Build:** Vite + Vinext
- **Deployment:** Netlify (static export)

**Key files you'll modify:**
- `app/dashboard-client.tsx` — Core logic (684 lines) - ALL gate controls, emergency modes, scheduling
- `app/demo-login.tsx` — Authentication
- `components/ui/` — 60+ UI components
- `app/globals.css` — Design system (1000+ lines)
- `netlify.toml` — Deployment config

**Architecture:**
```
User Browser
  ↓
page.tsx (entry)
  ↓
DemoLogin (auth)
  ↓ (success)
DashboardClient
  ├── Sidebar (nav)
  ├── Safety Bar (emergency controls)
  ├── 7 Views:
  │   ├── Dashboard (overview)
  │   ├── Live Gates (17 cards)
  │   ├── Schedules (weekly)
  │   ├── Automation (rules)
  │   ├── Access (identity)
  │   ├── Activity (audit)
  │   └── Settings (config)
  └── Gate Detail Sheet (modal)
```

**Gate system:**
- **Tom Frizza Sports Area:** 2 sliding gates
- **Staff Car Park:** 12 boom gates
- **Front Property:** 3 double-swing gates

**State management:**
```javascript
activeView          // Current page
systemMode          // "normal" | "lockdown" | "fire"
gateOverrides       // Manual position state
schedules           // Weekly open/close times
activity            // Audit trail (Melbourne TZ)
automations         // User-defined rules
positionMonitoring  // Health alerts
```

**Emergency modes:**
- **LOCKDOWN:** Close all gates, repeat voice warnings every 6.5s
- **FIRE/EVACUATION:** Open all gates, PA announcement, dynamic routing

**Voice system:**
- Uses browser SpeechSynthesis API (Australian male voice)
- Falls back to MP3 audio files
- Triggered on gate state changes

**How to extend it:**
1. Add more gates (edit `gate` array in dashboard-client.tsx)
2. Add new scheduling constraints
3. Create new dashboard views
4. Integrate with database (Drizzle ORM ready)
5. Customize styling (Tailwind config)

**Deploy changes:**
```bash
git add .
git commit -m "Your change description"
git push origin main
# Netlify auto-deploys
```

---

### **System 2: Sentinel Wayfinding (SG-PRO)**

**What it does:**
- Provides safe evacuation routes for each classroom
- Integrates with fire panel signals
- Displays dynamic routing on classroom screens
- Logs all scenarios synthetically (no real data)
- Identifies missing test coverage
- Human-approved learning only (no autonomous changes)

**Tech stack:**
- **Backend:** Python 3.11+, PyTorch (for future detection)
- **Framework:** Click CLI
- **Testing:** unittest
- **Storage:** JSON (synthetic scenarios), JSONL (local logs)

**Current scope:** Stage 1 synthetic prototype only
- ✅ Route planning from synthetic floor plans
- ✅ Scenario replay & testing
- ✅ Local-only run logging
- ✅ Human-review improvement reports
- ❌ Real CCTV/footage
- ❌ Real school floor plans
- ❌ Automatic learning from live data
- ❌ Weapon detection (future only)

**Key files:**
- `examples/synthetic_school_layout.json` — Mock floor plan (3 rooms, 2 corridors, 2 exits)
- `examples/scenarios.json` — Approved synthetic test cases (3 currently)
- `src/sentinel_wayfinding/cli.py` — Command-line interface
- `src/sentinel_wayfinding/scenarios.py` — Scenario replay logic
- `tests/test_scenarios.py` — Regression tests (15 tests passing)
- `local_logs/synthetic-runs.jsonl` — Append-only local audit trail

**Architecture:**

```
Synthetic Input
  ├── origin: CLASSROOM_A | CLASSROOM_B | ADMIN
  ├── incident: CORRIDOR_A | CORRIDOR_B | JUNCTION
  └── blocked_exits: (optional)
         ↓
Deterministic Route Planner
  ├── Check policy for origin
  ├── Find paths to each exit
  ├── Avoid blocked nodes
  ├── Apply size gating (if configured)
         ↓
Result
  ├── status: "ok" | "no_safe_route" | "invalid_origin" | "invalid_policy"
  ├── selected_exit: "EXIT_WEST" | "EXIT_EAST" | null
  ├── route: ["CLASSROOM_A", "CORRIDOR_A", "JUNCTION", "EXIT_WEST"]
  └── trace: (debug info)
         ↓
Human Review (if improvement needed)
  ├── Analyze coverage gaps
  ├── Propose new synthetic scenario
  ├── Approve or reject
  └── Commit to scenarios.json
         ↓
Replay All Scenarios
  └── Verify no regressions (15/15 tests pass)
```

**How the AI learns (safely):**

1. **Run synthetic scenarios**
   ```bash
   sentinel-wayfinding --scenarios examples/scenarios.json
   ```

2. **Log results locally** (audit only, no auto-changes)
   ```bash
   sentinel-wayfinding --scenarios examples/scenarios.json --log-file local_logs/synthetic-runs.jsonl
   ```

3. **Analyze coverage gaps** (human-review report)
   ```bash
   python -m sentinel_wayfinding.analyze --log-file local_logs/synthetic-runs.jsonl
   ```

4. **You approve a new synthetic scenario** (e.g., "admin origin with JUNCTION blocked")

5. **Commit approved scenario**
   ```bash
   git add examples/scenarios.json
   git commit -m "Add synthetic scenario: admin_junction_blocked"
   git push origin main
   ```

6. **CI runs full test suite** (15 tests, all must pass)

**Current synthetic scenarios (3/3 passing):**
- `classroom_a_corridor_b` → EXIT_WEST ✅
- `classroom_b_corridor_a` → EXIT_EAST ✅
- `classroom_a_no_safe_route` → no route (junction blocked) ✅

**What you CANNOT do (by design):**
- ❌ Use real school CCTV footage
- ❌ Train models on real data
- ❌ Store student/staff identities
- ❌ Let the system auto-update routes from logs
- ❌ Deploy to real site without human approval gates
- ❌ Make autonomous decisions in lockdown/fire scenarios

**What the system WILL do later (future):**
- Optional weapon detection (licensed vendor + your own models)
- Human verification layer (60-second window)
- Fire panel integration
- Classroom screen display (deterministic only)
- Physical gate/door actuators (with safety interlocks)

---

## 🧠 HOW YOUR AI LEARNS FROM BOTH SYSTEMS

### **For Magic Keys Portal:**

The AI learns by:
1. Reading the React/Next.js code structure
2. Understanding state management patterns
3. Seeing how emergency modes work
4. Learning the gate control logic
5. Understanding responsive design patterns
6. Recognizing UI component composition

**You help the AI learn by:**
- Asking it to explain specific code sections
- Asking it to add new features (new gate, new view, new automation)
- Asking it to refactor for clarity
- Asking it to write tests
- Asking it to optimize performance

**Example:** "Explain how the emergency lockdown loop works in dashboard-client.tsx"

### **For Sentinel Wayfinding:**

The AI learns by:
1. Understanding synthetic-only safety requirements
2. Seeing the scenario → replay → test → commit workflow
3. Learning the compliance constraints (NCC D3D26, AS 1670.1, etc.)
4. Understanding why human review is mandatory
5. Recognizing the hard-negative feedback loop design
6. Seeing how to measure progress (false alerts, not accuracy %)

**You help the AI learn by:**
1. Asking it to add new synthetic scenarios
2. Asking it to explain why certain data is off-limits
3. Asking it to review coverage gaps
4. Asking it to draft stage 2/3/4 roadmaps
5. Asking it to write compliance documentation

**Example:** "Draft a new synthetic scenario for when both exits are blocked"

---

## 📊 WHAT DATA YOUR AI CAN ACCESS

### ✅ **SAFE — AI can see and learn from:**

**Magic Keys:**
- All source code (React, Next.js, TypeScript)
- Component architecture
- State management
- Styling (Tailwind, CSS)
- Configuration (netlify.toml, next.config.ts)
- Public assets (images, logos)
- Build/deployment pipelines
- Test files
- Documentation

**Sentinel:**
- Synthetic layout JSON (fake floor plan)
- Synthetic scenarios (fake origins/incidents)
- Python CLI code
- Test suite
- Documentation
- Compliance constraints
- Risk register
- Data-handling policy

### ❌ **OFF-LIMITS — AI must never see:**

**Magic Keys:**
- Real student/staff names or IDs
- Real enrollment data
- Real CCTV footage
- Real emergency procedures
- Real gate configurations
- Real access control credentials
- Real incidents or drills
- Real scheduling data

**Sentinel:**
- Real Balwyn High floor plans
- Real CCTV camera locations
- Real emergency procedures
- Real fire panel configurations
- Real access control credentials
- Real student/staff data
- Real incident data
- Real evacuation routes
- Real facility details

**Both systems:**
- Passwords, API keys, tokens
- Student/staff biometric data
- Medical or vulnerability information
- Staff home addresses
- Incident details involving minors

---

## 🚀 QUICK START FOR AI LEARNING

### **Step 1: Understand Magic Keys Portal**

```bash
# Clone & run locally
cd ~/Downloads/balwyn-high-access-portal
npm install
npm run dev
# Open http://localhost:5173
# Login: paul sutton / magic-keys
```

**Then ask your AI:**
- "Explain the gate state machine in dashboard-client.tsx"
- "How does the emergency lockdown trigger all gates to close?"
- "What happens to schedules when lockdown mode is activated?"
- "Design a new automation rule type"

### **Step 2: Understand Sentinel Wayfinding**

```bash
# Run synthetic scenarios
cd ~/cocoapi/PythonAPI/sg-pro-sentinel
source .venv/Scripts/activate
sentinel-wayfinding --scenarios examples/scenarios.json
# See: 3/3 scenarios PASS
```

**Then ask your AI:**
- "Why is human verification mandatory in the architecture?"
- "Explain the false-alarm problem in section 1 of the build plan"
- "Design 3 new synthetic test scenarios"
- "Draft stage 3 approval gates for weapon detection"

### **Step 3: Integrate Learning**

Ask your AI questions like:
- "How could Magic Keys Portal integrate Sentinel routing on the evacuation view?"
- "What data structures would we need to add to display dynamic classroom routing?"
- "Draft a unified API for both systems"
- "Design the handoff from detection → verification → wayfinding → actuation"

---

## 📖 KEY DOCUMENTS YOUR AI NEEDS

In each repository:

**Magic Keys Portal:**
- `README.md` — Project overview
- `package.json` — Dependencies & scripts
- `app/dashboard-client.tsx` — Core logic

**Sentinel Wayfinding:**
- `README.md` — Stage 1 prototype scope
- `SG-PRO_Sentinel_Concept.md` — Full concept (compliance, commercial, architecture)
- `SG-PRO_Sentinel_Own_AI_Development_Brief.md` — Research direction (what to build)
- `SG-PRO_Sentinel_Detection_Build_Plan.md` — Detection strategy (4-layer architecture, false-alarm math)
- `examples/synthetic_school_layout.json` — Floor plan
- `examples/scenarios.json` — Test cases
- `src/sentinel_wayfinding/scenarios.py` — Scenario replay engine

---

## 🎓 WHAT YOUR AI SHOULD UNDERSTAND

### **Core Concepts**

1. **Gate Automation (Magic Keys)**
   - 3 gate types (sliding, boom, double-swing)
   - 3 campus areas
   - Normal, lockdown, fire modes
   - Weekly schedules override
   - Emergency overrides everything

2. **Evacuation Routing (Sentinel)**
   - Deterministic (no ML randomness)
   - Synthetic-only (no real data)
   - Scenario-based (origin + incident → route)
   - Human-approved (every change reviewed)
   - Compliance-gated (NCC D3D26, AS 1670.1)

3. **Safety-Critical Design**
   - Fail-safe (doors unlock on fire, power loss)
   - Human-in-the-loop (verification before actuation)
   - Graceful degradation (manual controls always available)
   - No autonomous decision-making on life safety
   - Audit trail (every action logged)

4. **AI Limitations (Sentinel)**
   - Cannot detect concealed weapons
   - Cannot assess intent
   - Cannot replace fire detection
   - Cannot lock people inside (illegal)
   - Cannot self-train on live footage
   - False alarms are inevitable (design for them)

### **Development Workflow**

1. **Feature request** → AI proposes changes
2. **Code review** → Human approves design
3. **Implementation** → AI writes code
4. **Testing** → All tests must pass
5. **Documentation** → Updated
6. **Commit** → To GitHub with clear message
7. **Deploy** → Netlify (Magic Keys) or approved PR (Sentinel)

---

## 💡 EXAMPLE: HOW YOUR AI HELPS

### **Scenario 1: Add a new gate to Magic Keys**

**You ask:** "Add a new gate called 'Library Entry' to the dashboard. It should be a sliding gate controlled normally but lock down with the perimeter in emergency mode."

**AI should:**
1. Read the current gate array in dashboard-client.tsx
2. Understand the gate object structure
3. Propose adding a new gate entry
4. Update all relevant views (Live Gates, Dashboard summary)
5. Ensure emergency mode logic applies
6. Write tests
7. Create a PR

**AI should NOT:**
- Add it without asking
- Break existing tests
- Create real gate configurations
- Commit without review

### **Scenario 2: Add new synthetic scenario to Sentinel**

**You ask:** "We need to test what happens if CORRIDOR_A is blocked AND EXIT_EAST is blocked simultaneously. Design this scenario."

**AI should:**
1. Review existing scenarios for patterns
2. Understand the scenario JSON structure
3. Propose new scenario entry with:
   - Unique ID
   - Origin
   - Incident
   - Additional blocked nodes
   - Expected result (route or no_safe_route)
4. Identify what the expected result should be
5. Add it to scenarios.json
6. Run full test suite
7. Create a PR with commit message

**AI should NOT:**
- Use real floor plans
- Assume results without checking logic
- Commit without tests passing
- Add scenarios that violate compliance

---

## 📞 WHO TO ASK WHEN

| Question | Ask |
|----------|-----|
| "How do I add a new gate?" | The AI (with your approval) |
| "Should we auto-lock gates on weapon detection?" | A lawyer + fire engineer |
| "Can we use real CCTV for training?" | DE procurement + privacy officer |
| "What's the best way to structure this component?" | The AI (for code review) |
| "Should evacuation routing account for accessibility?" | Fire engineer + disability access consultant |
| "Can we claim 90% detection accuracy?" | Nobody — not until independently verified on your footage |

---

## 🔐 CONFIDENTIALITY & SECURITY

- ✅ Code can be committed to GitHub (public repositories)
- ✅ Documentation, architecture, design patterns can be shared
- ❌ Never commit real school data, floor plans, CCTV, credentials
- ❌ Never share real incident procedures or access controls
- ❌ Never put student/staff names or IDs anywhere
- ❌ Never paste real CCTV footage into AI prompts
- ❌ Sentinel concepts must stay in the private repository

---

## 📚 LEARNING RESOURCES FOR YOUR AI

### **Magic Keys Portal**
- Next.js docs: https://nextjs.org/docs
- React 19 docs: https://react.dev
- Tailwind CSS: https://tailwindcss.com/docs
- shadcn/ui: https://ui.shadcn.com
- Netlify deployment: https://docs.netlify.com

### **Sentinel Wayfinding**
- NCC D3D26 (exit requirements): https://www.bpc.vic.gov.au/
- AS 1670.1 (fire systems): Standards Australia
- Victorian CCTV policy: https://www2.education.vic.gov.au/pal/cctv-in-schools/
- PyTorch: https://pytorch.org/tutorials
- YOLO object detection: https://docs.ultralytics.com/

---

## ✨ FINAL WORDS

Your AI is now learning from two production systems:
1. **Magic Keys Portal** — A gate automation system that's live and deployable
2. **Sentinel Wayfinding** — A research prototype for safe evacuation routing

The AI should understand:
- ✅ How to extend Magic Keys (add features, improve UX)
- ✅ How to improve Sentinel (add synthetic scenarios, draft future stages)
- ✅ Why safety-critical systems need human approval
- ✅ Why synthetic-only is mandatory until compliance approval
- ✅ How to write code that's testable, deployable, and auditable

**The AI should NOT:**
- ❌ Use real school data
- ❌ Bypass human verification
- ❌ Make autonomous safety decisions
- ❌ Claim capabilities it hasn't verified
- ❌ Commit code without tests passing

---

**You built this. Your AI will help you make it better. Let's go.** 🚀

# 📊 COMPLETE DATA INVENTORY FOR AI TRAINING

**Your GitHub Repositories — All Trainable Assets**  
RJL Commercial Group · September 2026


## Current Balwyn additions — 2026-09-08 UTC

Read [BALWYN_INTEGRATION_STATUS.md](BALWYN_INTEGRATION_STATUS.md) first. The older
inventory below contains estimates and examples; it is not proof of implemented
features, current hardware state, access permissions or completed AI training.

| Current file | Purpose |
| --- | --- |
| `pi-door-service/` | Authenticated four-channel open-only service, configuration and mock tests |
| `netlify/functions/remote-open.mts` | Separate operator authorization for the static demonstration |
| `lib/door-open-gateway.ts` / `lib/remote-open-client.ts` | Validated mapping, one upstream request and pulse-only responses |
| `app/remote-open-panel.tsx` | Explicit remote-open confirmation separate from simulation |
| `app/compass-wiring-reference.tsx` | Corrected isolation, terminal matrix, timing and commissioning reference |
| `BALWYN_INTEGRATION_STATUS.md` | Checked implementation and operational limitations |
| `docs/sites/2026-09-08-compass-and-branding.patch` | Exact source record of the newer Sites update, including the logo crop |

---

## 🎯 WHAT YOUR AI CAN LEARN FROM

This document maps EVERY data file, configuration, and trainable asset in your two repositories so your AI has complete context.

---

## 📦 REPOSITORY 1: balwyn-high-access-portal

**URL:** https://github.com/fencemate2026-pixel/balwyn-high-access-portal  
**Type:** Private TypeScript/React/Next.js  
**Size:** 4.7 MB  
**Language:** TypeScript  
**Pushed:** 2026-09-07 17:50:42 UTC  

### ✅ TRAINABLE FILES

#### **1. Configuration Files**

| File | Type | Size | Purpose | AI Can Train On |
|------|------|------|---------|----------------|
| `package.json` | JSON | 2.8 KB | Dependencies & scripts | ✅ YES - Full dependency tree |
| `tsconfig.json` | JSON | 500 B | TypeScript configuration | ✅ YES - Build settings |
| `tsconfig.netlify.json` | JSON | 1.2 KB | Netlify-specific TS config | ✅ YES - Deployment config |
| `netlify.toml` | TOML | 800 B | Netlify build & deploy | ✅ YES - Deployment pipeline |
| `next.config.ts` | TypeScript | 1.5 KB | Next.js configuration | ✅ YES - Framework config |
| `vite.config.ts` | TypeScript | 2 KB | Vite build configuration | ✅ YES - Build pipeline |
| `components.json` | JSON | 500 B | shadcn/ui configuration | ✅ YES - UI component setup |
| `tailwind.config.ts` | TypeScript | 1.2 KB | Tailwind CSS design tokens | ✅ YES - Design system |
| `drizzle.config.ts` | TypeScript | 800 B | Drizzle ORM configuration | ✅ YES - Database ORM config |
| `.openai/hosting.json` | JSON | 200 B | OpenAI hosting config | ✅ YES - Infrastructure |

#### **2. Application Code**

| File | Lines | Purpose | Trainable Data |
|------|-------|---------|----------------|
| `app/page.tsx` | ~50 | Entry point, renders DemoLogin | ✅ React component patterns |
| `app/layout.tsx` | ~30 | Root layout wrapper | ✅ Layout structure |
| `app/demo-login.tsx` | ~150 | Authentication screen | ✅ Auth flow, SHA-256 hashing |
| `app/dashboard-client.tsx` | 684 | **CORE LOGIC** - All gate controls, emergency modes, scheduling | ✅ Gate state machine, emergency cascade, scheduling logic |
| `app/globals.css` | 1000+ | Design system, Tailwind styles | ✅ Design patterns, color system |

#### **3. Component Library (60+ shadcn/ui Components)**

```
components/ui/
├── button.tsx
├── input.tsx
├── select.tsx
├── sidebar.tsx
├── sheet.tsx (offcanvas menu)
├── dialog.tsx (modals)
├── card.tsx
├── badge.tsx
├── progress.tsx
├── table.tsx
├── form.tsx (React Hook Form)
├── toast/sonner.tsx (notifications)
├── tabs.tsx
├── dropdown-menu.tsx
└── ... (50+ more)
```

**Trainable:** All component APIs, props, patterns

#### **4. Public Assets**

```
public/
├── images/
│   ├── balwyn-logo.png (school branding)
│   ├── rjl-logo.png (company branding)
│   ├── gate-types/ (sliding, boom, double-swing visuals)
│   └── operators/ (operator avatars)
├── audio/
│   ├── lockdown-warning.mp3 (6.5s repeating)
│   ├── evacuation-alert.mp3
│   ├── gate-moving.mp3
│   └── emergency-siren.mp3
└── videos/
    └── gate-animations/ (gate operation MP4s)
```

**Trainable:** Asset organization, naming conventions

#### **5. Database Schema (Drizzle ORM)**

```
db/
├── index.ts (D1 binding)
└── schema.ts (START HERE - Currently empty template)
```

```typescript
// db/schema.ts (empty template, ready for expansion)
// Your AI can design:
// - Gate configurations
// - User/operator profiles
// - Activity logs
// - Schedules
// - Automation rules
```

**Trainable:** Database design patterns, ORM setup

#### **6. Build Scripts**

```bash
scripts/
├── build-verified.sh → Bounded build with timeout
├── install-ci.sh → Locked dependency install
└── sites-env.sh → Environment setup
```

**Trainable:** Build pipeline, CI/CD patterns

#### **7. Tests**

```
tests/
└── *.test.mjs → Node test files
```

**Trainable:** Testing patterns, assertions

#### **8. Auto-Generated Documentation**

```
AUTO_DOCS/
├── CODEBASE_MAP.md → File structure
├── ARCHITECTURE.md → System flow
├── STATE_MANAGEMENT.md → React state
├── API_REFERENCE.md → Functions & types
├── DEPENDENCIES.md → npm packages
├── LEARNING_PROMPTS.md → Questions for AI
└── CHANGES_LOG.md → What changed
```

**Trainable:** ✅ All documentation

#### **9. Reference Documentation**

```
├── README.md → Project overview
├── AI_REFERENCE_MASTER.md → AI learning guide
└── AUTO_DOCUMENTATION_SYSTEM.md → Auto-docs setup
```

**Trainable:** ✅ All documentation

---

## 📦 REPOSITORY 2: sg-pro-sentinel (PRIVATE)

**URL:** https://github.com/fencemate2026-pixel/sg-pro-sentinel  
**Type:** Private Python (Stage 1 Prototype)  
**Size:** 68 KB  
**Language:** Python  
**Created:** 5 hours ago  
**Pushed:** 2026-09-07 17:42:58 UTC  

### ✅ TRAINABLE FILES

#### **1. Synthetic Test Data (JSON)**

**File:** `examples/scenarios.json`
```json
{
  "scenarios": [
    {
      "id": "classroom_a_corridor_b",
      "origin": "CLASSROOM_A",
      "incident": "CORRIDOR_B",
      "expected": {
        "status": "ok",
        "exit_node": "EXIT_WEST",
        "route": ["CLASSROOM_A", "CORRIDOR_A", "JUNCTION", "EXIT_WEST"]
      }
    },
    // ... 2 more scenarios (3 total, all passing)
  ]
}
```

**Status:** ✅ 3/3 scenarios PASSING  
**Trainable:** YES - Route planning logic, incident handling, exit selection

#### **2. Synthetic Floor Plan (JSON)**

**File:** `examples/synthetic_school_layout.json`
```json
{
  "metadata": {
    "name": "Synthetic Demonstration Campus A",
    "disclaimer": "Synthetic demonstration data only"
  },
  "graph": {
    "CLASSROOM_A": ["CORRIDOR_A"],
    "CLASSROOM_B": ["CORRIDOR_B"],
    "ADMIN": ["CORRIDOR_A"],
    "CORRIDOR_A": ["CLASSROOM_A", "ADMIN", "JUNCTION"],
    "CORRIDOR_B": ["CLASSROOM_B", "JUNCTION"],
    "JUNCTION": ["CORRIDOR_A", "CORRIDOR_B", "EXIT_EAST", "EXIT_WEST"],
    "EXIT_EAST": ["JUNCTION"],
    "EXIT_WEST": ["JUNCTION"]
  },
  "exits": ["EXIT_EAST", "EXIT_WEST"],
  "policy": {
    "selection_rule": "shortest_path_then_preferred_order_tiebreak",
    "allowed_exits_by_origin": {
      "CLASSROOM_A": ["EXIT_WEST", "EXIT_EAST"],
      "CLASSROOM_B": ["EXIT_EAST", "EXIT_WEST"],
      "ADMIN": ["EXIT_WEST", "EXIT_EAST"]
    }
  }
}
```

**Trainable:** YES - Graph structure, policy logic, exit prioritization

#### **3. Core Python Code**

| File | Lines | Purpose | Trainable |
|------|-------|---------|----------|
| `src/sentinel_wayfinding/cli.py` | ~150 | Command-line interface, scenario replay | ✅ YES - CLI patterns, arg parsing |
| `src/sentinel_wayfinding/scenarios.py` | ~180 | Scenario replay engine, validation | ✅ YES - Test framework, dataclass patterns |
| `src/sentinel_wayfinding/planner.py` | ~120 | Route planning algorithm (shortest path + policy) | ✅ YES - **Graph algorithm, policy application** |
| `tests/test_scenarios.py` | ~165 | Regression test suite (15 tests) | ✅ YES - Testing patterns, assertions |
| `tests/test_wayfinding.py` | ~80 | Wayfinding logic tests | ✅ YES - Unit test patterns |

**Status:** ✅ 15/15 tests PASSING

#### **4. Configuration Files**

| File | Purpose | Trainable |
|------|---------|----------|
| `pyproject.toml` | Python project config, dependencies | ✅ YES |
| `setup.py` | Package installation | ✅ YES |
| `.gitignore` | What NOT to track (synthetic-only enforced) | ✅ YES |

#### **5. Documentation (Critical for AI)**

```
docs/
├── concept.md → Full product concept (with evidence labels)
├── claim-sheet.md → What we CAN/CANNOT claim to customers
├── data-handling.md → Data privacy rules (synthetic-only enforced)
├── prototype-scope.md → Stage 1 boundaries (no real data)
├── risk-register.md → R1-R8 risks with mitigations
└── workstreams.md → Prerequisites for stages 2-4
```

**Trainable:** ✅ All documentation

#### **6. Project Metadata**

| File | Purpose | Trainable |
|------|---------|----------|
| `README.md` | Quick start, boundaries, Stage 1 scope | ✅ YES |
| `AI_REFERENCE_MASTER.md` | AI learning guide (both repos) | ✅ YES |

#### **7. Local Logs (Optional)**

```
local_logs/
└── synthetic-runs.jsonl (append-only, local-only, synthetic data)
```

**Status:** Opt-in, never committed to repo  
**Trainable:** YES - Log format patterns, audit trails

---

## 🧠 WHAT YOUR AI CAN LEARN

### **From Magic Keys Portal:**

✅ React 19 component patterns  
✅ Next.js 16 full-stack architecture  
✅ State management with hooks  
✅ Emergency cascade logic (lockdown/fire)  
✅ Gate control state machine  
✅ Weekly scheduling system  
✅ Activity logging with timezones  
✅ Voice synthesis integration  
✅ Responsive UI patterns (mobile/desktop)  
✅ TypeScript type safety  
✅ Tailwind CSS design system  
✅ shadcn/ui component composition  
✅ Netlify deployment pipeline  

### **From Sentinel Wayfinding:**

✅ Graph-based routing algorithms  
✅ Policy-based decision logic  
✅ Synthetic test data generation  
✅ Scenario replay validation  
✅ Compliance documentation  
✅ Risk assessment frameworks  
✅ Data handling governance  
✅ Python package structure  
✅ CLI design patterns  
✅ Unit testing best practices  
✅ Dataclass patterns  
✅ JSON schema validation  

---

## 🚀 HOW YOUR AI USES THIS INVENTORY

### **Before every request:**

1. **Read this inventory** - Understand what data exists
2. **Point AI to specific files** - "Read these files from both repos"
3. **Ask your question** - AI has full context
4. **AI executes safely** - No real school data involved

### **Example prompts:**

```
Read these files from balwyn-high-access-portal:
- app/dashboard-client.tsx (core logic)
- examples/scenarios.json (test cases)

Then: "Explain the emergency lockdown cascade"
```

```
Read these files from sg-pro-sentinel:
- examples/synthetic_school_layout.json (floor plan)
- src/sentinel_wayfinding/planner.py (routing algorithm)
- docs/concept.md (design principles)

Then: "Design 3 new synthetic test scenarios"
```

---

## 📊 DATA SUMMARY

### **Magic Keys Portal**

| Category | Count | Trainable |
|----------|-------|----------|
| Configuration files | 9 | ✅ ALL |
| React/TypeScript files | 60+ | ✅ ALL |
| shadcn/ui components | 60+ | ✅ ALL |
| Public assets | 20+ | ✅ ALL |
| Database schema template | 1 | ✅ YES |
| Build scripts | 3 | ✅ ALL |
| Test files | Multiple | ✅ ALL |
| Documentation | 3 | ✅ ALL |
| **TOTAL** | **150+** | **✅ 100%** |

### **Sentinel Wayfinding (Private)**

| Category | Count | Trainable |
|----------|-------|----------|
| Configuration files | 4 | ✅ ALL |
| Python source files | 5 | ✅ ALL |
| Test files | 2 | ✅ ALL |
| Synthetic data (JSON) | 2 | ✅ ALL |
| Documentation | 7 | ✅ ALL |
| **TOTAL** | **20+** | **✅ 100%** |

---

## ✅ WHAT'S OFF-LIMITS (By Design)

❌ Real school floor plans  
❌ Real CCTV footage or camera locations  
❌ Real student/staff data  
❌ Real access control credentials  
❌ Real fire panel configurations  
❌ Real incident records  
❌ Passwords, API keys, tokens  
❌ Biometric data  

✅ **Everything else is fair game for AI training**

---

## 🎯 YOUR AI'S COMPLETE TRAINING SET

You now have:

1. ✅ **150+ files in Magic Keys Portal** (all source, config, docs)
2. ✅ **20+ files in Sentinel Wayfinding** (all source, config, docs, test data)
3. ✅ **Auto-documentation system** (generates fresh docs on demand)
4. ✅ **This complete inventory** (what each file teaches)
5. ✅ **AI reference guides** (how to use the data)

**Your AI has everything it needs to:**
- Understand your entire architecture
- Propose code changes
- Design new features
- Write tests
- Draft documentation
- Integrate systems
- Troubleshoot issues

---

**Start linking your AI to this inventory. It now has complete context.** 🚀


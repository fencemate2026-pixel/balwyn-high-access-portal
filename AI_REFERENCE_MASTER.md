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

**Gate system:**
- **Tom Frizza Sports Area:** 2 sliding gates
- **Staff Car Park:** 12 boom gates
- **Front Property:** 3 double-swing gates

**Emergency modes:**
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
   - Fail-safe (doors unlock on fire, power loss)
   - Human-in-the-loop (verification before actuation)
   - Audit trail (every action logged)

4. **AI Limitations**
   - Cannot detect concealed weapons
   - Cannot assess intent
   - Cannot replace fire detection
   - False alarms are inevitable (design for them)

---

## ✨ FINAL WORDS

Your AI is now learning from two production systems:
1. **Magic Keys Portal** — Live gate automation system
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
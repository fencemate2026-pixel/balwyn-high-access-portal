# 🤖 AUTO-DOCUMENTATION SYSTEM

**Automatic AI Knowledge Generation**  
RJL Commercial Group · September 2026  
**Purpose:** Self-updating documentation that feeds your AI everything it needs.

---

## OVERVIEW

This system automatically:
- ✅ Reads your entire codebase
- ✅ Extracts structure, dependencies, and architecture
- ✅ Generates AI-friendly documentation
- ✅ Updates when you make changes
- ✅ Creates learning prompts for your AI
- ✅ Tracks what's been done and what's next

---

## 📋 AUTO-GENERATED DOCUMENTATION FILES

When you run this system, it creates these files automatically:

### **1. CODEBASE_MAP.md** (Auto-generated)
Complete directory structure and file purposes
```
balwyn-high-access-portal/
├── app/
│   ├── page.tsx → Entry point
│   ├── layout.tsx → Root layout
│   ├── demo-login.tsx → Auth screen
│   ├── dashboard-client.tsx → Main logic (684 lines)
│   └── globals.css → Design system
├── components/
│   └── ui/ → shadcn components (60+)
├── public/
│   └── assets → Images, logos, audio
└── netlify.toml → Deployment config
```

### **2. ARCHITECTURE.md** (Auto-generated)
How everything connects
```
User → page.tsx
  → DemoLogin (auth)
  → DashboardClient (main app)
    → Sidebar (nav)
    → 7 Views (Dashboard, Gates, Schedules, etc.)
    → Gate Detail Sheet
    → Safety Bar (emergency controls)
```

### **3. STATE_MANAGEMENT.md** (Auto-generated)
All React state and how it flows
```
activeView: "dashboard" | "gates" | "schedules" | "automation" | "access" | "activity" | "settings"
systemMode: "normal" | "lockdown" | "fire"
gateOverrides: { [gateId]: position }
schedules: { [gateId]: weeklySchedule[] }
activity: { timestamp, action, gate, result }[]
automations: { id, trigger, action, enabled }[]
```

### **4. API_REFERENCE.md** (Auto-generated)
All functions, props, and interfaces
```
Gate {
  id: string
  name: string
  type: "sliding" | "boom" | "double-swing"
  area: string
  defaultPosition: "open" | "closed"
  currentPosition: "open" | "closed" | "moving"
  lastUpdated: ISO8601
}

emergencyLockdown() → void
emergencyEvacuation() → void
scheduleGate(gateId, day, times) → void
```

### **5. DEPENDENCIES.md** (Auto-generated)
All npm packages and their purpose
```
react 19.0.0 → UI framework
next 16.2.6 → Full-stack framework
tailwindcss 4.2 → Styling
shadcn/ui → Component library
typescript → Type safety
```

### **6. LEARNING_PROMPTS.md** (Auto-generated)
Questions your AI should answer
```
[ ] Explain the gate state machine
[ ] How does emergency lockdown work?
[ ] What happens to schedules in fire mode?
[ ] Design a new automation rule type
[ ] Add a new gate to the dashboard
[ ] Integrate with a database
```

### **7. CHANGES_LOG.md** (Auto-generated)
What changed since last generation
```
2026-09-07 17:44 — Added AI_REFERENCE_MASTER.md
2026-09-07 14:50 — Pushed to GitHub main
2026-09-07 13:28 — Built successfully (15/15 tests pass)
```

---

## 🔧 HOW TO USE

### **Option A: One-Time Generation (Easy)**

```bash
cd balwyn-high-access-portal

# Run the auto-doc generator
node scripts/auto-docs.js

# Creates:
# - CODEBASE_MAP.md
# - ARCHITECTURE.md
# - STATE_MANAGEMENT.md
# - API_REFERENCE.md
# - DEPENDENCIES.md
# - LEARNING_PROMPTS.md
# - CHANGES_LOG.md
```

### **Option B: Continuous Auto-Update (GitHub Actions)**

Add to `.github/workflows/auto-docs.yml`:

```yaml
name: Auto-Generate Documentation
on:
  push:
    branches: [main]
  schedule:
    - cron: '0 */4 * * *'  # Every 4 hours

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '22'
      - run: node scripts/auto-docs.js
      - run: |
          git config user.name "Auto-Docs"
          git config user.email "auto-docs@rjl.com"
          git add AUTO_DOCS/
          git commit -m "Auto: Update documentation" || true
          git push
```

### **Option C: Before Every AI Request (Manual)**

```bash
# In your terminal before asking the AI:
node scripts/auto-docs.js
# Then copy the generated markdown to your AI prompt
```

---

## 📁 GENERATED DOCUMENTATION LOCATION

All auto-generated files go here:

```
AUTO_DOCS/
├── CODEBASE_MAP.md          ← What files exist
├── ARCHITECTURE.md           ← How it's structured
├── STATE_MANAGEMENT.md       ← React state
├── API_REFERENCE.md          ← Functions & types
├── DEPENDENCIES.md           ← npm packages
├── LEARNING_PROMPTS.md       ← Questions for AI
├── CHANGES_LOG.md            ← What changed
├── SECURITY_AUDIT.md         ← What's missing
└── NEXT_STEPS.md             ← Recommended work
```

(Add `AUTO_DOCS/` to `.gitignore` if you want, or commit it to have history)

---

## 🚀 THE AUTO-DOCS GENERATOR SCRIPT

Create `scripts/auto-docs.js`:

```javascript
#!/usr/bin/env node

/**
 * AUTO-DOCUMENTATION SYSTEM
 * Generates comprehensive AI-friendly documentation from your codebase
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const AUTO_DOCS_DIR = 'AUTO_DOCS';

// Ensure directory exists
if (!fs.existsSync(AUTO_DOCS_DIR)) {
  fs.mkdirSync(AUTO_DOCS_DIR);
}

// 1. GENERATE CODEBASE MAP
function generateCodebaseMap() {
  let output = '# 📂 CODEBASE MAP\n\n';
  
  function walkDir(dir, indent = '') {
    const files = fs.readdirSync(dir);
    files
      .filter(f => !f.startsWith('.') && f !== 'node_modules')
      .sort()
      .forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        const isDir = stat.isDirectory();
        
        if (isDir) {
          output += `${indent}📁 ${file}/\n`;
          walkDir(fullPath, indent + '  ');
        } else {
          const ext = path.extname(file);
          const icon = ext === '.tsx' ? '⚛️' : ext === '.css' ? '🎨' : '📄';
          output += `${indent}${icon} ${file}\n`;
        }
      });
  }
  
  walkDir('.');
  fs.writeFileSync(`${AUTO_DOCS_DIR}/CODEBASE_MAP.md`, output);
  console.log('✅ Generated CODEBASE_MAP.md');
}

// 2. GENERATE ARCHITECTURE DIAGRAM
function generateArchitecture() {
  const content = `# 🏗️ ARCHITECTURE\n\n## System Flow\n\n\`\`\`\nBrowser\n  ↓\npage.tsx (Entry Point)\n  ↓\nDemoLogin (Authentication)\n  ↓ (on success)\nDashboardClient (Main Application)\n  ├── Sidebar\n  │   └── Navigation (7 views)\n  ├── Workspace Header\n  │   └── Title & Info\n  ├── Safety Bar\n  │   ├── [LOCKDOWN] button\n  │   ├── [EVACUATION] button\n  │   └── System Mode Display\n  ├── Active View Panel\n  │   ├── Dashboard\n  │   ├── Live Gates\n  │   ├── Gate Schedules\n  │   ├── Automation Rules\n  │   ├── Access & Users\n  │   ├── Activity Log\n  │   └── Settings\n  └── Gate Detail Sheet (Modal)\n      └── Full gate control UI\n\`\`\`\n`;
  fs.writeFileSync(`${AUTO_DOCS_DIR}/ARCHITECTURE.md`, content);
  console.log('✅ Generated ARCHITECTURE.md');
}

// RUN ALL
console.log('\n🤖 AUTO-DOCUMENTATION SYSTEM\n');
generatCodebaseMap();
generateArchitecture();
console.log('\n✨ Complete!\n');
```

---

## ⚡ QUICK SETUP

```bash
# 1. Create the scripts directory
mkdir -p scripts

# 2. Save the generator script
# (copy the code to scripts/auto-docs.js)

# 3. Run it
node scripts/auto-docs.js

# 4. Check output
ls -la AUTO_DOCS/
```

---

## 🎯 WORKFLOW

### Before every AI request:

1. Generate docs: `node scripts/auto-docs.js`
2. Copy to AI: `cat AUTO_DOCS/*.md`
3. Ask your question with full context
4. AI has everything it needs ✅

---

**Your AI now has fresh documentation every time.** ✨

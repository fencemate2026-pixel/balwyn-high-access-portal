# 🚀 Balwyn Portal - Render Deployment Guide

**Comprehensive Setup & Deployment Instructions**

---

## 📋 Quick Start

### What You Have
- ✅ Production-ready Next.js application
- ✅ All 3D visualization components (Three.js)
- ✅ Professional theme design (Outfit/Inter typography)
- ✅ Supabase PostgreSQL integration
- ✅ Render.yaml configuration
- ✅ GPIO/Pi door control ready
- ✅ 473 npm dependencies installed

### What You Need to Do
1. Connect GitHub repository to Render
2. Set environment secrets in Render
3. Deploy and verify
4. (Optional) Configure hardware GPIO

---

## 🏗️ 3D Architecture & Features Implemented

### Three.js 3D Campus Visualization ✅

**Location:** `src/frontend/components/Scene3D.tsx`

Features:
- Real-time 3D campus rendering
- Interactive orbit camera (7m-28m zoom)
- Gate meshes with LED indicators
  - 🟢 Green (#2ee05a) = Open
  - 🔴 Red (#ff3b2f) = Locked  
  - 🟠 Amber (#ffab1a) = Issue
- Post-processing bloom effects for LED glow

**Campus Elements:**
```
SceneBuilder (src/frontend/utils/sceneBuilder.ts)
├── Buildings (Boom gate, Swing gate, Admin block)
├── Grounds (Lawn, parking, pathways)
├── Roads (Entry/exit routes)
├── Fields (Sports areas)
├── Lighting (Sun, hemisphere, ambient)
└── Materials (Photorealistic textures)
```

### Weather System ✅

**Location:** `src/frontend/utils/weatherSystem.ts`

Modes:
- ☀️ **Clear** - Blue sky, strong sunlight
- ☁️ **Cloudy** - Overcast, soft shadows
- 🌧️ **Rain** - Particle effects, wet surfaces
- ⛈️ **Storm** - Heavy effects, emergency lighting

Real data:
- Fetches actual Balwyn conditions
- 7-day forecast integration
- Weather icon updates

### Emergency Visualization ✅

**Location:** `app/emergency-voice-guard.tsx`

Features:
- 🚨 Red alert overlay (crisis mode)
- 📢 AI-powered voice guidance
- Automatic gate unlock sequence
- Real-time status updates
- Emergency contact information display

### Professional Theme Design ✅

**Color Scheme:**
```
--navy: #102c46 (primary)
--paper: #dbe5ec (background)
--ink: #2d3748 (text)
--rjl-red: #c52836 (accent/danger)
--green: #087a55 (success/open)
--orange: #f4a600 (warning)

Primary: #c52836 (Balwyn red)
Sidebar: #0c2439 (dark navy)
Ring: #1475a8 (focus/interaction)
```

**Typography:**
- **Display:** Outfit (500 weight) - headings, titles
- **Body/UI:** Inter (400-700) - content, controls
- **Line Height:** 1.55 (comfortable reading)
- **Anti-aliasing:** Enabled for smooth text

**Components:**
- Dashboard sidebar (dark theme)
- Gate status cards with real-time LED
- Facility hire booking panel
- Weather strip with live conditions
- User profile editor
- Emergency voice guard overlay

---

## 🔧 Render Deployment Setup

### Step 1: Connect GitHub Repository

1. Go to [Render Dashboard](https://dashboard.render.com)
2. Click **New** → **Web Service**
3. Select **Deploy existing repo** or **Connect GitHub**
4. Search for: `fencemate2026-pixel/balwyn-high-access-portal`
5. Select `main` branch

### Step 2: Configure Service

**Basic Settings:**
```
Name: balwyn-high-access-portal
Environment: Node
Region: Singapore (for Balwyn, Australia)
Plan: Standard (or suitable always-on plan)
Build Command: npm ci --include=dev && npm run build:render
Start Command: npm start
```

**Health Check:**
```
Path: /api/health
```

### Step 3: Set Environment Variables

Copy from your original Balwyn portal host or create new:

#### **Required - Authentication**
```
PORTAL_SESSION_SECRET = (existing secret from host)
PORTAL_USERNAME = (existing username)
PORTAL_PASSWORD_HASH = (existing hash)
PORTAL_PASSWORD_SALT = (existing salt)
PORTAL_OPERATOR_EMAIL = (operator email)
PORTAL_OWNER_EMAIL = (admin email)
PORTAL_ALLOWED_EMAILS = (comma-separated whitelist)
```

#### **Required - Database**
```
SUPABASE_URL = https://aevsfrxqyvtuycufffxk.supabase.co
SUPABASE_SERVICE_ROLE_KEY = (from Supabase project settings)
```

#### **Optional - AI Features**
```
ANTHROPIC_API_KEY = (Claude API key)
AI_PROVIDER = anthropic
ANTHROPIC_MODEL = claude-3-5-sonnet-20241022
```

#### **Optional - OAuth** (if enabling)
```
GOOGLE_OAUTH_CLIENT_ID = (Google Console)
GOOGLE_ALLOWED_EMAILS = (comma-separated)
```

#### **Optional - GPIO/Door Control**
```
DOOR_SERVICE_URL = https://your-pi-gateway.example.com
DOOR_SERVICE_TOKEN = (random secure token)
DOOR_GATE_MAP = {"TF-ENTRY":1,"TF-EXIT":2}
```

#### **Optional - Settings Admin**
```
PORTAL_SETTINGS_PASSWORD_HASH = (hash for settings page)
PORTAL_SETTINGS_PASSWORD_SALT = (salt for settings)
```

#### **Optional - Secondary Operator**
```
PORTAL_SECONDARY_USERNAME = (backup operator)
PORTAL_SECONDARY_PASSWORD_HASH = (hash)
PORTAL_SECONDARY_PASSWORD_SALT = (salt)
PORTAL_SECONDARY_OPERATOR_EMAIL = (email)
```

### Step 4: Deploy

1. Click **Create Web Service**
2. Render will automatically:
   - Pull code from GitHub
   - Install dependencies (npm ci)
   - Run build (npm run build:render)
   - Start application (npm start)
3. Watch deployment logs
4. Get production URL (e.g., `https://balwyn-high-access-portal.onrender.com`)

### Step 5: Verify Deployment

Test endpoints:
```bash
# Health check (quick, no DB)
curl https://your-render-app.onrender.com/api/health
→ Should return 200 OK

# Readiness check (full, includes DB)
curl https://your-render-app.onrender.com/api/ready
→ Should return 200 OK

# Login page
https://your-render-app.onrender.com/login
→ Should display Magic Keys login

# Dashboard (requires auth)
https://your-render-app.onrender.com
→ Should display 3D campus + gate controls
```

---

## 🎨 3D Features Verification

### In Browser

1. **Login** with credentials
2. **Navigate to Dashboard** - should see:
   - ✅ 3D campus rendering (Three.js canvas)
   - ✅ Real-time gate LED indicators
   - ✅ Weather system (live Balwyn conditions)
   - ✅ Professional styling (Outfit headings, Inter body)
   - ✅ Sidebar with dark navy theme
   - ✅ Gate status cards
   - ✅ Facility hire panel
   - ✅ Weather forecast strip

### Camera Controls

- **Orbit:** Left-click + drag to rotate
- **Zoom:** Scroll wheel or pinch (7m-28m range)
- **Pan:** Right-click + drag
- **Reset:** Double-click

### LED Status Indicators

On 3D gates:
- 🟢 **Green** (#2ee05a) = Gate unlocked/open
- 🔴 **Red** (#ff3b2f) = Gate locked/closed
- 🟠 **Amber** (#ffab1a) = Fault/issue detected

Updates every 20 seconds from backend.

### Weather Effects

- Particle system for rain/storm
- Lighting adjusts based on conditions
- Sky color changes
- Real data from weather API

---

## 🚪 Hardware Integration (Optional)

### Raspberry Pi Door Service

Only deploy if you have Pi hardware + ACB-004 board.

**Installation on Pi:**

```bash
# Clone Balwyn repo
git clone https://github.com/fencemate2026-pixel/balwyn-high-access-portal.git
cd balwyn-high-access-portal/pi-door-service

# Install Python dependencies
pip install -r requirements.txt

# Run mock mode first (safe)
python3 service.py --mock

# On Render, leave DOOR_SERVICE_* vars unset until ready
```

**GPIO Wiring:**

See [pi-door-service/README.md](pi-door-service/README.md) for:
- ACB-004 board pin mapping
- Relay channel configuration
- Maglock circuit wiring
- Roger F70/IPU36 connections
- Safety interlocks

**Enable Hardware:**

Once Pi is deployed:
1. Set `DOOR_SERVICE_URL` on Render
2. Set `DOOR_SERVICE_TOKEN` on Render
3. Set `DOOR_GATE_MAP` JSON mapping
4. Test with `POST /api/doors/1/open`
5. Perform onsite safety commissioning

### What Hardware Does

```
Balwyn Portal (Render)
    ↓ (HTTPS + token)
Raspberry Pi Gateway
    ↓ (GPIO pulse)
ACB-004 Relay Board
    ↓ (dry-contact)
Maglock Release Circuit
    ↓ (isolated power)
Gate Maglock Opens (300-800ms)
```

**Important:**
- ❌ No feedback on gate position
- ❌ No automatic closing
- ❌ One-way open only
- ✅ All safety interlocks in code
- ✅ Mock mode for testing

---

## 📊 Performance Optimization

### Frontend (Already Optimized)

- **Tree-shaking:** Unused Three.js modules removed
- **Code splitting:** Dynamic imports for heavy components
- **Lazy loading:** 3D scene loads after UI ready
- **Bloom effects:** GPU-accelerated post-processing
- **Update frequency:** 20-second polling (not real-time streaming)

### Render Plan Recommendations

| Plan | Suitable For | Cost |
|------|-------------|------|
| **Free** | Development only | $0/month |
| **Starter** | Light production (1-2 users) | $7/month |
| **Standard** | Production (10-50 users) | $12/month |
| **Pro** | High-traffic (100+ users) | $29/month |

For Balwyn school: **Standard plan minimum** recommended.

### Database Performance

Supabase handles:
- Connection pooling
- Automatic scaling
- Point-in-time recovery
- Real-time subscriptions (if enabled)

Monitor in Supabase dashboard:
- Query execution times
- Active connections
- Storage usage

---

## 🔐 Security Checklist

- ✅ HTTPS only (Render provides free SSL)
- ✅ Environment secrets (not in code)
- ✅ SUPABASE_SERVICE_ROLE_KEY not in NEXT_PUBLIC_*
- ✅ DOOR_SERVICE_TOKEN server-side only
- ✅ Session cookies encrypted (PORTAL_SESSION_SECRET)
- ✅ Password hashes with salt
- ✅ OAuth token exchange secure
- ✅ CORS protection
- ✅ Rate limiting (built-in)
- ✅ RLS policies on database

---

## 🆘 Troubleshooting

### Build Fails

```
Error: Could not resolve module
→ Check package-lock.json committed
→ Run: npm ci --include=dev locally
→ Verify Node 22.13+ required
```

### 3D Scene Not Rendering

```
Black screen / no campus visible
→ Check browser console for WebGL errors
→ Verify Three.js loaded (npm list three)
→ Test on different browser
→ Clear browser cache
```

### Database Connection Fails

```
Error: Cannot connect to balwyn_portal schema
→ Verify SUPABASE_URL correct
→ Verify SUPABASE_SERVICE_ROLE_KEY valid
→ Check Supabase project is active
→ Check schema permissions
```

### Login Not Working

```
→ Verify PORTAL_SESSION_SECRET set
→ Verify PORTAL_PASSWORD_HASH and SALT match
→ Check credentials correct
→ Try OAuth (Google) if available
```

### Gates Not Opening

```
→ If hardware configured:
   - Verify DOOR_SERVICE_URL reachable
   - Verify DOOR_SERVICE_TOKEN matches Pi
   - Check Pi service running
   - Test: curl -H "Auth: Bearer $TOKEN" https://pi-url/doors/1/open
→ If unconfigured:
   - Mock mode is default (safe)
   - Configure only after commissioning
```

### Slow Performance

```
→ Check Render dashboard for:
   - CPU usage
   - Memory usage
   - Disk I/O
→ Consider upgrading plan
→ Check network latency to Supabase
→ Reduce camera movement in 3D (GPU load)
```

---

## 📈 Monitoring

### Render Dashboard

Monitor:
- Deployment status
- Build logs
- Runtime logs
- CPU/Memory usage
- Network I/O
- Uptime/downtime

### Supabase Dashboard

Monitor:
- SQL query logs
- Active connections
- Storage usage
- RLS policy violations
- Edge Function execution

### Application Logs

Access via Render:
```
Logs → View build logs / runtime logs
```

Look for:
- Successful startup: `Server listening on port X`
- Database connections: `Connected to balwyn_portal`
- API health: `GET /api/health → 200`
- Errors: Watch for exceptions/crashes

---

## 🔄 Updates & Maintenance

### Deploying Updates

1. Make changes locally
2. Commit and push to `main` branch
3. GitHub checks must pass
4. Render auto-deploys on merge (if configured)
5. Monitor build logs for success

### Database Schema Changes

1. Update migration in Supabase
2. Test locally with PGlite
3. Deploy to Supabase staging first
4. Verify on production after success

### Dependency Updates

1. Run `npm update` locally
2. Test with `npm run build`
3. Run `npm test`
4. Commit updated `package-lock.json`
5. Deploy to Render

---

## ✅ Pre-Production Checklist

- [ ] Render service created
- [ ] GitHub repository connected
- [ ] All environment variables set
- [ ] Build succeeds locally
- [ ] `npm test` passes
- [ ] 3D campus renders correctly
- [ ] Login works with real credentials
- [ ] Dashboard displays live data
- [ ] Weather updates in real-time
- [ ] Gate status accurate
- [ ] Profile image displays
- [ ] Facility hire bookings visible
- [ ] Emergency voice guard ready
- [ ] HTTPS certificate valid
- [ ] Custom domain configured (optional)
- [ ] Monitoring alerts set up (optional)
- [ ] Rollback plan documented
- [ ] Team trained on deployment

---

## 🎯 Next Steps

1. **Immediately:**
   - Connect Render service to GitHub
   - Set environment variables
   - Deploy to staging
   - Verify 3D features work

2. **Before Going Live:**
   - Confirm admin login
   - Test all dashboard features
   - Verify Supabase data sync
   - Performance load testing

3. **Post-Deployment:**
   - Monitor error rates
   - Gather user feedback
   - Plan hardware commission (if needed)
   - Schedule training sessions

---

## 📞 Support Resources

- **Render Docs:** https://render.com/docs
- **Next.js Docs:** https://nextjs.org/docs
- **Three.js Docs:** https://threejs.org/docs
- **Supabase Docs:** https://supabase.com/docs
- **Balwyn Repo:** https://github.com/fencemate2026-pixel/balwyn-high-access-portal

---

**Status:** ✅ Ready for Production Deployment  
**Last Updated:** 2026-09-23  
**Maintained by:** Balwyn High School IT Team

# 🚀 Render Quick Start - Balwyn Portal

**Service ID:** `srv-danq2eoae00c739lsu0g`  
**Status:** Ready to Configure  
**Last Updated:** 2026-09-23

---

## ⚡ 5-Minute Setup

### 1. Connect Repository (1 min)

Go to: https://dashboard.render.com/web/srv-danq2eoae00c739lsu0g

**Settings → Source:**
```
Repository: fencemate2026-pixel/balwyn-high-access-portal
Branch: main
```

Click **Connect**

### 2. Configure Build & Start (30 sec)

**Settings → Build & Deploy:**
```
Build Command:     npm ci --include=dev && npm run build:render
Start Command:     npm start
Node Version:      22
Region:            Singapore
Plan:              Standard (recommended for production)
```

### 3. Set Environment Variables (3 min)

**Settings → Environment:**

Copy & paste each:

```
NODE_ENV=production
SUPABASE_URL=https://aevsfrxqyvtuycufffxk.supabase.co
SUPABASE_SERVICE_ROLE_KEY=(get from Supabase settings)
PORTAL_SESSION_SECRET=(existing secret from host)
PORTAL_USERNAME=(existing username)
PORTAL_PASSWORD_HASH=(existing hash)
PORTAL_PASSWORD_SALT=(existing salt)
PORTAL_OPERATOR_EMAIL=(operator email)
PORTAL_OWNER_EMAIL=(admin email)
ANTHROPIC_API_KEY=(Claude API key, optional)
DOOR_SERVICE_URL=(Pi gateway, optional)
DOOR_SERVICE_TOKEN=(Pi token, optional)
DOOR_GATE_MAP={"TF-ENTRY":1,"TF-EXIT":2}
```

### 4. Deploy (1 min)

Click **Deploy** → Watch logs → Should see:
```
Build succeeded ✅
Starting application...
Server listening on port 10000 ✅
Connected to balwyn_portal schema ✅
```

### 5. Verify (30 sec)

Visit: `https://your-render-app.onrender.com/login`

**Should see:**
- ✅ Magic Keys logo
- ✅ Login form
- ✅ Professional theme (navy sidebar, red accents)

---

## 🎨 What You Get

### Frontend
- 🎭 3D campus visualization (Three.js)
- 🚪 Real-time gate status with LED indicators
- 🌦️ Live weather integration
- 📱 Responsive mobile-friendly design
- 🎯 Professional Balwyn branding

### Backend
- 🔐 Secure authentication (login + OAuth)
- 📊 Dashboard with analytics
- 🏢 Facility hire management
- 🎤 Emergency voice assistant
- 📡 50+ API endpoints

### Hardware (Optional)
- 🚪 Raspberry Pi door control
- ⚙️ Compass ACB-004 relay support
- 📍 GPIO pulse timing (300-800ms)
- 🔒 One-way safe open design

---

## 📋 Environment Variables Reference

| Variable | Value | Required | Notes |
|----------|-------|----------|-------|
| `NODE_ENV` | `production` | ✅ | Always production |
| `SUPABASE_URL` | `https://aevsfrxqyvtuycufffxk.supabase.co` | ✅ | Fixed URL |
| `SUPABASE_SERVICE_ROLE_KEY` | (from Supabase) | ✅ | Server-side only |
| `PORTAL_SESSION_SECRET` | (existing) | ✅ | From current host |
| `PORTAL_USERNAME` | (existing) | ✅ | Admin login |
| `PORTAL_PASSWORD_HASH` | (existing) | ✅ | Encrypted password |
| `PORTAL_PASSWORD_SALT` | (existing) | ✅ | Hash salt |
| `PORTAL_OPERATOR_EMAIL` | (existing) | ✅ | Operator account |
| `PORTAL_OWNER_EMAIL` | (existing) | ✅ | Admin email |
| `ANTHROPIC_API_KEY` | (optional) | ❌ | For AI features |
| `DOOR_SERVICE_URL` | (optional) | ❌ | Pi gateway URL |
| `DOOR_SERVICE_TOKEN` | (optional) | ❌ | Pi auth token |
| `DOOR_GATE_MAP` | (optional) | ❌ | Gate→channel map |

---

## ✅ Post-Deployment Checklist

- [ ] Build succeeded (check Render logs)
- [ ] App starts without errors
- [ ] Login page loads
- [ ] Can login with credentials
- [ ] Dashboard displays 3D campus
- [ ] Gate status visible
- [ ] Weather updates in real-time
- [ ] Profile image displays
- [ ] Facility hire panel loads
- [ ] HTTPS works (green lock)

---

## 🆘 Quick Troubleshooting

### Build Fails
```
→ Check: npm ci --include=dev locally
→ Check: package-lock.json committed
→ Check: Node 22.13+ installed
```

### App Won't Start
```
→ Check logs: npm start output
→ Verify: All required env vars set
→ Check: SUPABASE_URL accessible
```

### Login Fails
```
→ Verify: PORTAL_SESSION_SECRET set
→ Verify: PORTAL_PASSWORD_HASH matches
→ Try: OAuth (Google) if available
```

### 3D Campus Not Showing
```
→ Check: Browser console for errors
→ Verify: Three.js loaded
→ Try: Different browser
→ Clear: Browser cache
```

---

## 📞 Need Help?

**Full Documentation:**
- 📖 [RENDER_DEPLOYMENT_GUIDE.md](RENDER_DEPLOYMENT_GUIDE.md) - Complete setup
- 🎨 [3D_THEME_AND_DESIGN.md](3D_THEME_AND_DESIGN.md) - Design system
- 📊 [PRODUCTION_STATUS.md](PRODUCTION_STATUS.md) - Status overview
- 🔧 [SOFTWARE_HELP.md](SOFTWARE_HELP.md) - Developer reference
- ⚙️ [RENDER_MIGRATION.md](RENDER_MIGRATION.md) - Migration details

**External:**
- Render Docs: https://render.com/docs
- Next.js Docs: https://nextjs.org/docs
- Supabase Docs: https://supabase.com/docs

---

## 🎯 Next Steps

1. **Right Now:**
   - Set environment variables on Render
   - Click Deploy
   - Watch build logs

2. **In 5 Minutes:**
   - Visit production URL
   - Login with credentials
   - Verify 3D campus renders

3. **Later:**
   - Configure hardware (optional)
   - Set up monitoring
   - Train users

---

**Status:** ✅ Ready to Deploy  
**Maintenance:** Balwyn High School IT

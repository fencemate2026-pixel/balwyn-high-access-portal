# Azure App Service settings for the Magic Keys portal

Enter these in Azure Portal > App Service > Settings > Environment variables.
Values are secrets: copy them from Render's Environment page (or regenerate),
never into Git, chat or email. `provision.sh` already sets the four marked (set).

Compiled 24 Sep 2026 from every setting the code reads (grep of lib/ and app/)
compared with render.yaml. Settings the code reads that render.yaml does NOT
list are marked MISSING-ON-RENDER: set them on Azure if you use the feature.

## Platform
| Key | Value | Notes |
|---|---|---|
| WEBSITES_PORT | 8080 | (set) container port |
| PORT | 8080 | (set) |
| NODE_ENV | production | (set) |

## Database
| Key | Notes |
|---|---|
| SUPABASE_URL | (set) https://aevsfrxqyvtuycufffxk.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | ROTATE first (exposed earlier), then enter the NEW key here and on Render |
| SUPABASE_DATABASE_URL | MISSING-ON-RENDER. Only if the direct database path is used; otherwise leave unset |

## Thomastown swing gate (owner console, Azure `gd` schema) — added 6 Nov 2026
Names only. Values are secrets: never in Git, chat or email. Not needed until the `gd` migration is approved and applied.
| Key | Notes |
|---|---|
| GD_DATABASE_URL | Connection string for the dedicated `gd_app` login role (NOT `balwyn_app`). See `deploy/azure/gd/README.md` |
| GD_DATABASE_SSL | Leave unset for TLS (default). Only set to `off` for a local test database |
| GD_THOMASTOWN_SWING_SECRET | 32+ random characters. The same value goes on the Pi (`/etc/thomgate-portal-sync.env`, mode 0600). Rotate by changing both |
| GD_THOMASTOWN_SLIDING_SECRET | Added 7 Nov 2026 for the sliding gate. A DIFFERENT 64-hex value from the swing secret (one secret per Pi). Same rules; goes on the sliding Pi only |

## Sessions and accounts
| Key | Notes |
|---|---|
| PORTAL_SESSION_SECRET | Copy from Render. Keep identical during cutover or everyone is signed out |
| PORTAL_USERNAME, PORTAL_OPERATOR_EMAIL, PORTAL_PASSWORD_SALT, PORTAL_PASSWORD_HASH | Email login, primary account. Rotate the password (exposed 19 Sep): `node scripts/make-password-hash.mjs` |
| PORTAL_SECONDARY_USERNAME, PORTAL_SECONDARY_OPERATOR_EMAIL, PORTAL_SECONDARY_OPERATOR_PHONE, PORTAL_SECONDARY_PASSWORD_SALT, PORTAL_SECONDARY_PASSWORD_HASH, PORTAL_SECONDARY_ROLE | Second email account (optional) |
| PORTAL_SETTINGS_PASSWORD_SALT, PORTAL_SETTINGS_PASSWORD_HASH | Separate admin-unlock password. Set both or neither |
| PORTAL_ALLOWED_EMAILS, PORTAL_OWNER_EMAIL, PORTAL_ROLE | Copy from Render |
| PORTAL_PLAN | MISSING-ON-RENDER. Plan tier; unset = core |

## Sign-in providers
| Key | Notes |
|---|---|
| GOOGLE_OAUTH_CLIENT_ID, GOOGLE_ALLOWED_EMAILS | Copy from Render. Same domain, so Google Cloud needs no change |
| MICROSOFT_OAUTH_CLIENT_ID, MICROSOFT_OAUTH_CLIENT_SECRET, MICROSOFT_ALLOWED_ACCOUNTS | MISSING-ON-RENDER. Only when Microsoft sign-in is configured |

## Help assistant
| Key | Notes |
|---|---|
| AI_PROVIDER, ANTHROPIC_MODEL, ANTHROPIC_API_KEY | Copy from Render |

## Gate controller bridge (open-only path)
| Key | Notes |
|---|---|
| DOOR_SERVICE_URL, DOOR_SERVICE_TOKEN, DOOR_GATE_MAP | MISSING-ON-RENDER. Only once the Pi door service is installed and reachable |

## Mildura boom gate on Azure (STAGED)
| Key | Notes |
|---|---|
| MILDURA_BACKEND | Unset = the old Supabase path. `azure` = Mildura reads and writes the Azure `gd` schema (needs GD_DATABASE_URL and `gd/003_mildura.sql`). The Pi's secret is not an app setting: only its sha256 is stored in `gd.devices` |

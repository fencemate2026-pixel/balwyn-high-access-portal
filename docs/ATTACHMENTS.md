# Operator attachments already in this app

Do not treat this list as a deploy checklist. Google sign-in is live.

| Attachment | In the app | Notes |
|---|---|---|
| `add-signin-logging.py` | `scripts/add-signin-logging.py` and already applied in `app/api/auth/google/route.ts` | Logs `stage`, name and message only. Do not run the script again. |
| `lib/gate-led.ts` | `lib/gate-led.ts` | Safety rule: green / steady red only on a fresh confirmed heartbeat. Not a live motor state. |
| `docs/led-preview.html` | `docs/led-preview.html` | Static reference. Open locally. |
| `lib/request-origin.ts` | `lib/request-origin.ts` | Proxy-aware origin. Already used by sign-in. |
| Hire schema (`public`) | `supabase/migrations/20260920121500_hire_bookings.sql` | **Do not apply.** The edge function cannot see `public`. |
| Hire schema (`balwyn_portal`) | `supabase/migrations/20260921103400_hire_bookings_balwyn_portal.sql` | Correct schema. Apply in the SQL editor only when ready for hire, not to fix login. |
| `.env.example` | `.env.example` | Names only. Never commit filled secrets. |
| `app/api/_diag/origin` | **not added** | Unauthenticated header dump. Keep off production. |

Applying the `balwyn_portal` hire migration does not commission gates and does not pulse motors.

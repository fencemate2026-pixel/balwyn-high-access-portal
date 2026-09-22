# Deployment

## Prerequisites

- Node.js 22+
- PostgreSQL 15+ with the `balwyn_portal` schema
- Optional Raspberry Pi relay bridge reachable from the backend

## Setup

1. Run `npm install`.
2. Apply `database/balwyn_portal_schema.sql` to PostgreSQL.
3. Apply `database/seed.sql` for sample data.
4. Configure environment variables:
   - `DATABASE_URL=postgres://...`
   - `PORT=4010`
   - `HARDWARE_ENDPOINT=https://pi-gateway.example/api/relay`
5. Start the backend with `npm run dev:api`.
6. Start the frontend with `npm run dev:portal`.

## Production notes

- Place the frontend behind HTTPS and proxy `/api` to the backend.
- Restrict backend access to trusted operator networks.
- Replace header-based development auth with SSO or signed session middleware.
- Monitor `/health` and `/ready` separately.

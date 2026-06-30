# W8/W9 Collection Portal

W8W9CollectionPortal is a tax-form readiness system of record. It collects, validates, and keeps current every payee's W-9 and W-8 series form (W-8BEN, W-8BEN-E, W-8ECI, W-8IMY) before the first payment goes out. It pairs a self-serve payee portal (which picks the right form from a guided entity/residency questionnaire) with a real-time readiness ledger that shows green/yellow/red state and the total dollars and payees blocked by missing or invalid documents.

The product owns the full lifecycle of the tax form as a validated, expiring, recertifiable artifact: it picks the right form, validates it field by field, tracks its three-year expiry clock, runs automated re-request campaigns, and gates payments behind a readiness check. It is a compliance system, not an invoice or sourcing tool.

See `docs/idea.md` for the full product specification, problem statement, target users, and feature breakdown.

## Pricing

All features are FREE for signed-in users. Stripe billing is optional and returns 503 when unconfigured. A built-in sample-data seeder makes the product demoable out of the box.

## Stack

- **Backend:** Hono (Node, TypeScript, ESM) running via `tsx`, Drizzle ORM over Neon Postgres (`@neondatabase/serverless`), zod validation. Endpoints are mounted under `/api/v1`.
- **Frontend:** Next.js 16, React 19, TypeScript (strict), Tailwind CSS 4, App Router. Authentication via `@neondatabase/auth` (Neon Auth).
- **Auth model:** the Next.js server resolves the session and proxies API calls to the backend through `web/app/api/proxy/[...path]/route.ts`, injecting a trusted `X-User-Id` header. The backend trusts that header.
- **Deploy:** backend on Render (`render.yaml`), frontend on Vercel (`rootDirectory: web`, `nodeVersion: 22.x`). `docker-compose.yml` brings backend + web up together for local container runs.

## Project Layout

```
backend/        Hono API (src/index.ts bootstrap, src/routes/*, src/db/*)
web/            Next.js app (app/, lib/, components/)
docs/idea.md    Product specification
render.yaml     Render backend service definition
docker-compose.yml
```

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres database (or any Postgres reachable via `DATABASE_URL`). Tables must be provisioned out-of-band (Drizzle schema push / Neon console) before first boot; the server only runs an idempotent seeder, it does not create tables.

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL and FRONTEND_URL (see below)
pnpm dev          # node --import tsx/esm src/index.ts on PORT (default 3001)
```

Health check: `GET http://localhost:3001/health` returns `{ ok: true }`.

### Frontend

```bash
cd web
pnpm install
# create web/.env.local (see below)
pnpm dev          # Next.js dev server on http://localhost:3000
pnpm build        # production build (must pass)
```

### Docker

```bash
docker compose up --build
```

Brings up the backend on `:3001` and the web app on `:3000`.

## Environment Variables

### Backend (`backend/.env`)

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
ADMIN_USER_IDS=
# Optional Stripe billing (omit for all-free mode; endpoints return 503 when unset)
# STRIPE_SECRET_KEY=
# STRIPE_PRO_PRICE_ID=
# STRIPE_WEBHOOK_SECRET=
```

### Frontend (`web/.env.local`)

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=https://<venture>-api.onrender.com
```

`NEXT_PUBLIC_API_URL` is the only `NEXT_PUBLIC_*` var and is baked into the bundle at build time. The two `NEON_AUTH_*` vars are server-only. For local development point `NEXT_PUBLIC_API_URL` at `http://localhost:3001`.

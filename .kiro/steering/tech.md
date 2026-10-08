# Tech Stack

## Monorepo

npm workspaces with two packages: `backend` and `frontend`. Node.js 22 (`.nvmrc`). Root scripts fan out to workspaces via `--workspaces --if-present`.

## Backend (`backend/`)

- **Runtime/lang:** Node.js 22, TypeScript 5.7 (ESM, `"type": "module"`, `module`/`moduleResolution: Node16`).
- **Strict TS:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` all on. Path alias `@/*` → `src/*`.
- **Framework:** Express 5.
- **DB access:** Kysely (typed query builder) over PostgreSQL 16 via `pg`. No ORM.
- **Validation:** Zod for all input schemas.
- **Auth/crypto:** argon2 / `@node-rs/argon2` for password hashing; app-level field encryption + SHA-256 hashing (see `src/lib/crypto.ts`).
- **Security middleware:** helmet, cors, cookie-parser, express-rate-limit.
- **Logging:** pino / pino-http.
- **PDF & QR:** puppeteer (PDF rendering), qrcode.
- **Email:** nodemailer.
- **Tests:** Vitest + supertest; coverage via `@vitest/coverage-v8` (min 80%).

> ESM import note: relative imports include the `.js` extension (e.g. `./config/env.js`) even for `.ts` sources, as required by Node16 module resolution.

## Frontend (`frontend/`)

- React 19 + Vite 6, React Router 7, TanStack Query (server state), Zustand (client state), React Hook Form + `@hookform/resolvers` + Zod. TypeScript strict.

## Infra

- Docker + Docker Compose (PostgreSQL 16, backend, frontend).
- CI: GitHub Actions on push to `main`/`develop` — lint → build → tests.

## Common Commands

Run from the repo root (fans out to workspaces) or inside a package.

```bash
# Setup
cp .env.example .env
nvm use
npm install

# Local dev stack (postgres + backend + frontend)
docker compose up

# Root-level (all workspaces)
npm run lint
npm run format
npm run build
npm test

# Backend only (from backend/)
npm run dev            # watch mode (ts-node/esm)
npm run build          # tsc
npm run test           # vitest run
npm run test:coverage  # vitest run --coverage
npm run migrate        # tsx src/db/migrate.ts
npm run seed           # tsx src/db/seed.ts

# Frontend only (from frontend/)
npm run dev            # vite
npm run build          # tsc && vite build
```

## Code style

Prettier: single quotes, no semicolons, 2-space indent, trailing commas (`all`), print width 100. ESLint with `@typescript-eslint`. Run `npm run format` / `npm run lint` before committing.

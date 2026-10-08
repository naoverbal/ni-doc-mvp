# Project Structure

## Top level

```
ni-doc/
├── backend/            # REST API (Express + TypeScript)
├── frontend/           # SPA (React + Vite)
├── .github/workflows/  # CI (lint → build → test)
├── .kiro/              # specs + steering
├── docker-compose.yml  # postgres + backend + frontend
└── package.json        # npm workspaces root
```

## Backend layout (`backend/src/`)

Layered architecture with clear separation of concerns:

```
src/
├── server.ts        # process entrypoint (starts the HTTP server)
├── app.ts           # builds the Express app, wires dependencies
├── config/          # env (Zod-validated) and database (Kysely) setup
├── routes/          # Express routers; one file per domain (e.g. auth.routes.ts)
├── middlewares/     # auth, tenant (RLS), validate, rate-limit, error-handler
├── services/        # business logic / use cases
├── repositories/    # data access via Kysely; map DB rows ↔ domain objects
├── schemas/         # Zod input/output schemas
├── lib/             # pure helpers (crypto, senha, token, documento, orcamento-calculo)
├── errors/          # AppError and error types
├── types/           # shared types incl. the Kysely Database interface
└── db/              # migrate.ts, seed.ts, migrations/*.sql
```

## Conventions

- **Factory functions over classes for wiring.** Services and repositories are created by `criar*` factory functions that take their dependencies as arguments (e.g. `criarAuthService({ usuarioRepo, sessaoRepo, auditoriaService })`). `app.ts` composes these. Prefer this dependency-injection style for testability.
- **Interface + implementation per module.** Export an interface (e.g. `UsuarioRepository`) alongside its `criar*` factory. Input/output shapes get their own exported interfaces (e.g. `CriarUsuarioInput`, `UsuarioPublico`).
- **Repository boundary.** Repositories own all Kysely queries and translate between `snake_case` DB columns and `camelCase` domain fields via explicit `mapRow*` helpers. Keep SQL out of services and routes.
- **Request flow:** route → validate (Zod) middleware → service → repository. The `errorHandler` middleware is registered last.
- **Errors:** throw `AppError(statusCode, message, detalhes?)` for expected failures; the error handler maps it to the HTTP response.
- **Multi-tenancy via Postgres RLS.** Every tenant-scoped table enforces Row Level Security. The `tenant` middleware sets `SET LOCAL app.current_tenant = '<uuid>'` per transaction; policies filter on `current_setting('app.current_tenant')`. Never bypass this — do not query across tenants.
- **Naming:** domain identifiers, functions, and comments are in Portuguese (`criar`, `buscarPorEmail`, `orcamento`, `senha`). Match existing names.
- **Tests** live in `__tests__/` folders next to the code they cover, named `*.test.ts`.
- **Migrations** are plain SQL in `db/migrations/`, numbered and idempotent (use `DROP ... IF EXISTS` before `CREATE`).

## Specs & workflow

Feature specs live in `.kiro/specs/<feature>/` (`requirements.md`, `design.md`, `tasks.md`). Tasks follow TDD and are executed one per session; a task is done only when its tests pass and lint is clean.

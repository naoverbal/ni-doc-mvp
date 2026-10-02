# ni-doc

Aplicação web para emissão, versionamento, envio e acompanhamento de orçamentos.

## Stack

- **Backend:** Node.js 22, TypeScript strict, Express 5, Kysely, Zod, argon2, Vitest, pino
- **Frontend:** React 19, Vite, React Router 7, TanStack Query, Zustand, React Hook Form
- **Infra:** Docker + Docker Compose, PostgreSQL 16, GitHub Actions

## Pré-requisitos

- Node.js 22 (use `.nvmrc`: `nvm use`)
- Docker + Docker Compose

## Desenvolvimento

```bash
# Copiar variáveis de ambiente
cp .env.example .env

# Subir serviços
docker compose up
```

## Estrutura

```
ni-doc/
├── backend/    # API REST (Express + TypeScript)
├── frontend/   # SPA (React + Vite)
└── .github/    # CI/CD (GitHub Actions)
```

## CI

O CI roda automaticamente em push para `main` e `develop`: lint → build → testes.

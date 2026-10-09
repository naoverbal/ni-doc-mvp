# ni-doc

Aplicação web para emissão, versionamento, envio e acompanhamento de orçamentos.

## Stack

- **Backend:** Node.js 22, TypeScript strict, Express 5, Kysely, Zod, argon2, Vitest, pino
- **Frontend:** React 19, Vite, React Router 7, TanStack Query, Zustand, React Hook Form
- **Infra:** Docker + Docker Compose, PostgreSQL 16, GitHub Actions

## Pré-requisitos

- Node.js 22 (use `.nvmrc`: `nvm use`)
- Docker + Docker Compose

## Configuração do ambiente

Copie o arquivo de exemplo e preencha os segredos obrigatórios:

```bash
cp .env.example .env
```

O backend valida as variáveis na inicialização (`backend/src/config/env.ts`) e
não sobe se os segredos estiverem ausentes ou inválidos. Gere-os assim:

```bash
# CRYPTO_KEY: chave AES-256 (32 bytes) em base64
openssl rand -base64 32

# SESSION_SECRET: segredo para HMAC (mínimo 32 caracteres)
openssl rand -hex 32
```

Cole cada valor na variável correspondente do `.env`. As variáveis `SMTP_*` são
opcionais em desenvolvimento.

## Rodando com Docker (recomendado)

Sobe PostgreSQL, backend e frontend de uma vez:

```bash
docker compose up
```

Com os containers no ar, aplique as migrations e popule os dados de teste:

```bash
docker compose exec backend npm run migrate   # cria o schema
docker compose exec backend npm run seed       # popula dados de desenvolvimento
```

Acessos:

- Frontend: (http://localhost:5173{target=_blank})
- Backend: (http://localhost:3000{target=_blank}) (o Vite faz proxy de `/api` para o backend)

## Rodando localmente (sem Docker)

Suba apenas o Postgres via Docker e rode as aplicações no host:

```bash
nvm use
npm install

# banco de dados
docker compose up -d postgres

# backend (a partir de backend/)
npm run migrate
npm run seed
npm run dev            # http://localhost:3000

# frontend (a partir de frontend/)
npm run dev            # http://localhost:5173
```

## Credenciais de teste (seed)

O seed cria dois tenants isolados, cada um com um admin e um operador. O seed é
bloqueado quando `NODE_ENV=production`.

Há apenas dois papéis no sistema — `admin` e `operador` — replicados nos dois
tenants (Alpha e Beta), totalizando quatro usuários de teste:

| Tenant | Papel      | E-mail             | Senha                    |
| ------ | ---------- | ------------------ | ------------------------ |
| Alpha  | `admin`    | admin@alpha.dev    | `dev_admin_alpha_123`    |
| Alpha  | `operador` | operador@alpha.dev | `dev_operador_alpha_123` |
| Beta   | `admin`    | admin@beta.dev     | `dev_admin_beta_123`     |
| Beta   | `operador` | operador@beta.dev  | `dev_operador_beta_123`  |

Também são criados clientes, responsáveis, um template ativo e um orçamento
rascunho por tenant.

## Comandos úteis

Na raiz (propaga para os workspaces) ou dentro de cada pacote:

```bash
npm run lint      # ESLint
npm run format    # Prettier
npm run build     # build de produção
npm test          # testes (Vitest)
```

Backend (a partir de `backend/`):

```bash
npm run dev            # watch mode
npm run test:coverage  # testes com cobertura (mínimo 80%)
npm run migrate        # aplica migrations
npm run seed           # popula dados de desenvolvimento
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

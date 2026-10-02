# design.md

## 1. Visão Geral da Arquitetura

O **ni-doc** é uma aplicação web server-side com SPA no cliente. A arquitetura segue um modelo em camadas, priorizando:

- **Segurança** (criptografia, RLS, sessões server-side)
- **Testabilidade** (TDD, camadas isoladas, injeção de dependências)
- **Clareza** (responsabilidades bem definidas por camada)
- **Imutabilidade** (documentos emitidos nunca são alterados)
- **Simplicidade** (sem ORM, sem abstrações desnecessárias)

### 1.1. Princípios Arquiteturais

1. **Snapshot Pattern:** rascunhos usam referências (FK); versões emitidas usam cópias imutáveis (JSONB)
2. **Imutabilidade de documentos:** PDFs e versões de orçamento nunca são alterados após a emissão
3. **Multi-tenancy com RLS:** isolamento no banco, não no código
4. **Criptografia em coluna:** dados sensíveis protegidos mesmo em backups
5. **TDD obrigatório:** nenhum código novo sem teste que o valide

### 1.2. Diagrama Macro

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENTE (Browser)                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  React SPA (Vite + TypeScript)                        │  │
│  │  - Rotas: /login, /dashboard, /orcamentos,            │  │
│  │           /orcamentos/:id, /templates, /publico/:token│  │
│  │  - Estado: React Query + Zustand                      │  │
│  │  - Editor de template (canvas A4)                     │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS + Cookie HttpOnly
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   SERVIDOR (Node.js 22)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  API REST (Express + TypeScript)                      │  │
│  │  ┌────────────────────────────────────────────────┐   │  │
│  │  │  Rotas HTTP                                    │   │  │
│  │  │    ↓                                           │   │  │
│  │  │  Middlewares (auth, tenant, validation)        │   │  │
│  │  │    ↓                                           │   │  │
│  │  │  Services (regras de negócio)                  │   │  │
│  │  │    ↓                                           │   │  │
│  │  │  Repositories (SQL com Kysely)                 │   │  │
│  │  └────────────────────────────────────────────────┘   │  │
│  │                                                       │  │
│  │  Libs: crypto, pdf (Puppeteer), email, qrcode         │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    PostgreSQL 16+                           │
│  - RLS habilitado em todas as tabelas com tenant_id         │
│  - Criptografia em colunas sensíveis (AES-256-GCM)          │
│  - Sessões server-side                                      │
│  - Auditoria com estado antes/depois                        │
│  - Snapshots imutáveis de versões emitidas                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Stack Técnica

### 2.1. Backend

| Componente | Escolha | Justificativa |
|------------|---------|---------------|
| Runtime | Node.js 22 LTS | Estável, LTS, tipagem com TS |
| Linguagem | TypeScript (strict) | Segurança de tipos, padrão do projeto |
| Framework HTTP | Express 5 | Mais documentado, mais tutoriais, ideal para quem está inseguro no backend |
| Validação | Zod | Inferência de tipos + validação em runtime |
| Acesso a dados | Kysely | Query builder SQL tipado, sem ORM, mantém controle total |
| Sessões | Sessões em PostgreSQL | Simples, auditável, sem dependência externa |
| Hash de senha | argon2 (node-argon2) | Padrão OWASP 2024 para senhas |
| Criptografia | node:crypto (nativo) | AES-256-GCM sem dependências externas |
| Geração de PDF | Puppeteer | Renderiza HTML/CSS como no browser; reaproveita template |
| QR Code | qrcode (npm) | Leve, sem dependências pesadas |
| E-mail | nodemailer | Suporta qualquer SMTP; Hostinger oferece SMTP |
| Logging | pino | Rápido, estruturado, JSON |
| Testes | Vitest + Supertest | Rápido, moderno, ótima DX |
| Lint/Format | ESLint + Prettier | Padrão da comunidade |

### 2.2. Frontend

| Componente | Escolha | Justificativa |
|------------|---------|---------------|
| Framework | React 19 | Escolha do usuário |
| Build tool | Vite | Rápido, moderno, ótimo DX |
| Roteamento | React Router 7 | Padrão da comunidade |
| Estado servidor | TanStack Query | Cache, retry, sincronização com API |
| Estado cliente | Zustand | Leve, sem boilerplate |
| Formulários | React Hook Form + Zod | Performance + validação tipada |
| Estilo | CSS Modules + variáveis CSS | Simples, sem dependência de framework CSS |
| Editor de template | Implementação própria | Baseada no projeto anterior |

### 2.3. Infraestrutura

| Componente | Escolha | Justificativa |
|------------|---------|---------------|
| Containerização | Docker + Docker Compose | Ambiente consistente dev/prod |
| Banco | PostgreSQL 16 | RLS nativo, maduro, estável |
| Reverse proxy | Nginx (na VPS) | TLS, proxy reverso, arquivos estáticos |
| CI/CD | GitHub Actions | Já configurado no projeto anterior |
| Deploy | Hostinger VPS | Escolha do usuário |

---

## 3. Estrutura de Pastas

```
ni-doc/
├── .github/
│   └── workflows/
│       └── ci.yml
├── .kiro/
│   └── specs/
│       └── ni-doc-mvp/
│           ├── requirements.md    ← este arquivo
│           ├── design.md          ← este arquivo
│           └── tasks.md
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── .eslintrc.cjs
│   └── src/
│       ├── server.ts
│       ├── app.ts
│       ├── config/
│       │   ├── env.ts
│       │   └── database.ts
│       ├── middlewares/
│       │   ├── auth.ts
│       │   ├── tenant.ts
│       │   ├── validate.ts
│       │   └── error-handler.ts
│       ├── routes/
│       │   ├── auth.routes.ts
│       │   ├── orcamentos.routes.ts
│       │   ├── clientes.routes.ts
│       │   ├── empresas.routes.ts
│       │   ├── responsaveis.routes.ts
│       │   ├── templates.routes.ts
│       │   └── publico.routes.ts
│       ├── services/
│       │   ├── auth.service.ts
│       │   ├── orcamento.service.ts
│       │   ├── cliente.service.ts
│       │   ├── empresa.service.ts
│       │   ├── responsavel.service.ts
│       │   ├── template.service.ts
│       │   ├── pdf.service.ts
│       │   ├── aceite.service.ts
│       │   └── auditoria.service.ts
│       ├── repositories/
│       │   ├── usuario.repository.ts
│       │   ├── sessao.repository.ts
│       │   ├── orcamento.repository.ts
│       │   ├── cliente.repository.ts
│       │   ├── empresa.repository.ts
│       │   ├── responsavel.repository.ts
│       │   ├── template.repository.ts
│       │   └── auditoria.repository.ts
│       ├── schemas/
│       │   ├── auth.schema.ts
│       │   ├── orcamento.schema.ts
│       │   ├── cliente.schema.ts
│       │   └── ...
│       ├── lib/
│       │   ├── crypto.ts
│       │   ├── pdf.ts
│       │   ├── qrcode.ts
│       │   ├── email.ts
│       │   ├── hash.ts
│       │   └── logger.ts
│       ├── db/
│       │   ├── migrations/
│       │   │   ├── 001_initial_schema.sql
│       │   │   ├── 002_rls_policies.sql
│       │   │   └── 003_seed_dev.sql
│       │   └── migrate.ts
│       ├── errors/
│       │   └── app-error.ts
│       └── types/
│           └── database.ts
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── PrivateRoute.tsx
│       │   └── PublicRoute.tsx
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Dashboard.tsx
│       │   ├── OrcamentoLista.tsx
│       │   ├── OrcamentoEditor.tsx
│       │   ├── TemplateEditor.tsx
│       │   └── PublicoOrcamento.tsx
│       ├── components/
│       │   ├── Autocomplete.tsx
│       │   ├── CanvasA4.tsx
│       │   ├── ItemOrcamentoRow.tsx
│       │   └── ...
│       ├── hooks/
│       │   ├── useAuth.ts
│       │   ├── useOrcamentos.ts
│       │   └── ...
│       ├── services/
│       │   └── api.ts
│       ├── stores/
│       │   └── auth.store.ts
│       └── types/
│           └── api.ts
└── nginx/
    └── ni-doc.conf
```

---

## 4. Modelo de Dados

### 4.1. Diagrama ER (resumido)

```
tenants (1) ──── (N) usuarios
   │
   ├──── (N) clientes
   ├──── (N) empresas
   ├──── (N) responsaveis_tecnicos
   ├──── (N) orcamentos ─── (N) orcamento_itens
   │                       │
   │                       └── (N) orcamento_versoes ─── (1) orcamento_aceites
   │                                                    │
   │                                                    └── (1) templates
   ├──── (N) templates (versionados)
   ├──── (1) tenants_template_ativo
   ├──── (N) eventos_auditoria
   └──── (N) sessoes (indireto via usuarios)
```

### 4.2. Schema Completo (PostgreSQL)

```sql
-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- TENANTS
-- =====================================================
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- USUÁRIOS
-- email_encrypted: e-mail criptografado (AES-256-GCM)
-- email_hash: SHA-256 do e-mail em lowercase (para busca e login)
-- =====================================================
CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  email_hash CHAR(64) NOT NULL,
  email_encrypted TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel VARCHAR(20) NOT NULL CHECK (papel IN ('admin', 'operador')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email_hash)
);

CREATE INDEX idx_usuarios_tenant ON usuarios(tenant_id);

-- =====================================================
-- SESSÕES (server-side)
-- =====================================================
CREATE TABLE sessoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip VARCHAR(45),
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ NOT NULL,
  ultima_atividade TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX idx_sessoes_expira ON sessoes(expira_em);

-- =====================================================
-- CLIENTES
-- documento_hash: SHA-256 do CPF/CNPJ (só números)
-- documento_encrypted: CPF/CNPJ criptografado
-- NOTA: alterações no cadastro NÃO refletem em versões emitidas
-- =====================================================
CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo_pessoa VARCHAR(2) NOT NULL CHECK (tipo_pessoa IN ('PF', 'PJ')),
  nome VARCHAR(255) NOT NULL,
  documento_hash CHAR(64) NOT NULL,
  documento_encrypted TEXT NOT NULL,
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  endereco_encrypted TEXT,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, documento_hash)
);

CREATE INDEX idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX idx_clientes_nome ON clientes(tenant_id, nome);

-- =====================================================
-- EMPRESAS (tenant emissor ou cliente PJ)
-- NOTA: alterações no cadastro NÃO refletem em versões emitidas
-- =====================================================
CREATE TABLE empresas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('tenant', 'cliente_pj')),
  razao_social VARCHAR(255) NOT NULL,
  nome_fantasia VARCHAR(255),
  cnpj_hash CHAR(64),
  cnpj_encrypted TEXT,
  endereco_encrypted TEXT,
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_empresas_tenant ON empresas(tenant_id, tipo);

-- =====================================================
-- RESPONSÁVEIS TÉCNICOS
-- NOTA: alterações no cadastro NÃO refletem em versões emitidas
-- =====================================================
CREATE TABLE responsaveis_tecnicos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  registro_profissional VARCHAR(50),
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_responsaveis_tenant ON responsaveis_tecnicos(tenant_id);

-- =====================================================
-- TEMPLATES (versionados e imutáveis)
-- Cada alteração cria uma nova versão
-- =====================================================
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  layout_json JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, versao)
);

CREATE INDEX idx_templates_tenant ON templates(tenant_id, versao DESC);

-- Aponta qual versão do template é a "atual" para novas emissões
CREATE TABLE tenants_template_ativo (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES templates(id)
);

-- =====================================================
-- ORÇAMENTOS (rascunho atual)
-- versao_atual = 0 enquanto rascunho
-- =====================================================
CREATE TABLE orcamentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero VARCHAR(30) NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  empresa_cliente_id UUID REFERENCES empresas(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'reprovado', 'expirado', 'cancelado')),
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  validade_dias INTEGER NOT NULL DEFAULT 30,
  desconto_global_tipo VARCHAR(10) CHECK (desconto_global_tipo IN ('percentual', 'fixo')),
  desconto_global_valor NUMERIC(12,2),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  versao_atual INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  condicoes_pagamento TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, numero)
);

CREATE INDEX idx_orcamentos_tenant ON orcamentos(tenant_id);
CREATE INDEX idx_orcamentos_status ON orcamentos(tenant_id, status);
CREATE INDEX idx_orcamentos_cliente ON orcamentos(cliente_id);

-- =====================================================
-- ITENS DO ORÇAMENTO (rascunho)
-- Em versões emitidas, os itens vivem no snapshot JSONB
-- =====================================================
CREATE TABLE orcamento_itens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  quantidade NUMERIC(12,4) NOT NULL DEFAULT 1,
  unidade VARCHAR(20) NOT NULL DEFAULT 'un',
  valor_unitario NUMERIC(12,2) NOT NULL,
  desconto_tipo VARCHAR(10) CHECK (desconto_tipo IN ('percentual', 'fixo')),
  desconto_valor NUMERIC(12,2),
  total NUMERIC(12,2) NOT NULL,
  responsavel_id UUID REFERENCES responsaveis_tecnicos(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_itens_orcamento ON orcamento_itens(orcamento_id, ordem);

-- =====================================================
-- VERSÕES DO ORÇAMENTO (imutáveis)
-- snapshot: JSONB com cópia dos dados do cliente, empresa, itens e
--           responsáveis no momento da emissão
-- template_id: versão do template usada para gerar o PDF
-- pdf_path: caminho do PDF armazenado (imutável)
-- pdf_hash: SHA-256 do PDF (integridade)
-- =====================================================
CREATE TABLE orcamento_versoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  template_id UUID NOT NULL REFERENCES templates(id),
  pdf_path TEXT,
  pdf_hash CHAR(64),
  token_publico VARCHAR(128) NOT NULL UNIQUE,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ,
  UNIQUE (orcamento_id, versao)
);

CREATE INDEX idx_versoes_orcamento ON orcamento_versoes(orcamento_id);
CREATE INDEX idx_versoes_token ON orcamento_versoes(token_publico);

-- =====================================================
-- ACEITES
-- metodo: 'cliente' (link público) ou 'operador' (manual)
-- =====================================================
CREATE TABLE orcamento_aceites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  versao_id UUID NOT NULL REFERENCES orcamento_versoes(id) ON DELETE CASCADE,
  metodo VARCHAR(20) NOT NULL CHECK (metodo IN ('cliente', 'operador')),
  usuario_id UUID REFERENCES usuarios(id),
  ip VARCHAR(45),
  user_agent TEXT,
  hash_documento CHAR(64) NOT NULL,
  justificativa TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (versao_id)
);

CREATE INDEX idx_aceites_versao ON orcamento_aceites(versao_id);

-- =====================================================
-- EVENTOS DE AUDITORIA
-- =====================================================
CREATE TABLE eventos_auditoria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id),
  acao VARCHAR(50) NOT NULL,
  entidade VARCHAR(50) NOT NULL,
  entidade_id UUID,
  estado_anterior JSONB,
  estado_novo JSONB,
  ip VARCHAR(45),
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_auditoria_tenant ON eventos_auditoria(tenant_id, criado_em DESC);
CREATE INDEX idx_auditoria_entidade ON eventos_auditoria(entidade, entidade_id);
```

### 4.3. Row-Level Security (RLS)

Habilitar RLS em todas as tabelas com `tenant_id` e criar políticas que usam o `app.current_tenant` setado pela aplicação a cada requisição:

```sql
-- Exemplo para clientes (replicar para todas as tabelas com tenant_id)
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;

CREATE POLICY clientes_tenant_isolation ON clientes
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- O mesmo padrão para: usuarios, empresas, responsaveis_tecnicos,
-- orcamentos, orcamento_itens (via join com orcamentos), templates,
-- eventos_auditoria
```

**Importante:** a aplicação deve executar `SET LOCAL app.current_tenant = '<uuid>'` no início de cada transação. Isso é feito no middleware `tenant.ts`.

---

## 5. Padrão de Snapshot e Imutabilidade

### 5.1. Rascunho vs. Versão Emitida

| Aspecto | Rascunho | Versão Emitida |
|---------|----------|----------------|
| Cliente | Referência (FK) | Snapshot copiado (JSONB) |
| Empresa | Referência (FK) | Snapshot copiado (JSONB) |
| Responsável | Referência (FK) | Snapshot copiado (JSONB) |
| Itens | Tabela editável | JSONB imutável |
| Template | Ignorado | FK para versão do template |
| PDF | Não existe | Arquivo imutável + hash |
| Edição | Livre | Bloqueada |

### 5.2. Estrutura do Snapshot

```json
{
  "cliente": {
    "id": "uuid",
    "nome": "...",
    "tipo_pessoa": "PJ",
    "documento": "...",
    "email": "...",
    "telefone": "...",
    "endereco": "..."
  },
  "empresa_cliente": {
    "id": "uuid",
    "razao_social": "...",
    "nome_fantasia": "...",
    "cnpj": "...",
    "endereco": "..."
  },
  "itens": [
    {
      "ordem": 1,
      "nome": "Desenvolvimento de API",
      "descricao": "Backend em Node.js",
      "quantidade": 40,
      "unidade": "h",
      "valor_unitario": 200,
      "desconto_tipo": "percentual",
      "desconto_valor": 10,
      "total": 7200,
      "responsavel": {
        "id": "uuid",
        "nome": "Eng. Ana Beatriz Lima",
        "registro_profissional": "CREA 123456"
      }
    }
  ],
  "desconto_global": { "tipo": "percentual", "valor": 5 },
  "subtotal": 7200,
  "total": 6840,
  "condicoes_pagamento": "50% na aprovação, 50% na entrega",
  "observacoes": "...",
  "data_emissao": "2026-10-01",
  "validade_dias": 30
}
```

### 5.3. Regras de Imutabilidade

1. **Alterações em clientes, empresas e responsáveis** afetam apenas o cadastro. Versões emitidas preservam o snapshot do momento da emissão.
2. **Versionamento de template** ocorre a cada alteração. Versões emitidas referenciam a versão específica do template usada no momento.
3. **PDFs armazenados são imutáveis.** Nunca são regenerados nem modificados. Se ausentes em disco, retorna-se erro (não recria).

---

## 6. Criptografia

### 6.1. Fluxo

```
┌─────────────────────────────────────────────────────────────┐
│  DADO SENSÍVEL (ex: CPF "123.456.789-00")                   │
│                                                             │
│  1. Normalização: "12345678900"                             │
│  2. Hash SHA-256: "abc123..." → armazenado em *_hash        │
│     (permite busca e unicidade)                             │
│  3. Criptografia AES-256-GCM:                               │
│     - IV aleatório de 12 bytes                              │
│     - ciphertext + authTag                                  │
│     - resultado em base64 → armazenado em *_encrypted       │
└─────────────────────────────────────────────────────────────┘
```

### 6.2. Chaves

| Variável de ambiente | Uso |
|---------------------|-----|
| CRYPTO_KEY | Chave AES-256 (32 bytes, base64) para dados sensíveis |
| SESSION_SECRET | Segredo para assinar o token público (HMAC) |
| ARGON2_PARAMS | Parâmetros do Argon2id (memory, iterations, parallelism) |

**Nunca commitar chaves.** Usar `.env` local + variáveis de ambiente no servidor.

### 6.3. Implementação de referência

```typescript
// lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto'

const KEY = Buffer.from(process.env.CRYPTO_KEY!, 'base64') // 32 bytes

export function criptografar(texto: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const encrypted = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64')
}

export function descriptografar(dados: string): string {
  const buffer = Buffer.from(dados, 'base64')
  const iv = buffer.subarray(0, 12)
  const authTag = buffer.subarray(12, 28)
  const encrypted = buffer.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export function hashDocumento(texto: string): string {
  return createHash('sha256').update(texto).digest('hex')
}
```

---

## 7. Autenticação e Sessões

### 7.1. Fluxo de Login

```
┌──────────┐                    ┌──────────┐                  ┌────────────┐
│ Cliente  │                    │  API     │                  │ PostgreSQL │
└────┬─────┘                    └────┬─────┘                  └─────┬──────┘
     │  POST /api/auth/login         │                              │
     │  { email, senha }             │                              │
     ├──────────────────────────────>│                              │
     │                               │  SELECT usuario por hash     │
     │                               ├─────────────────────────────>│
     │                               │<─────────────────────────────┤
     │                               │  argon2.verify()             │
     │                               │  INSERT sessao               │
     │                               ├─────────────────────────────>│
     │                               │<─────────────────────────────┤
     │  200 OK                       │                              │
     │  Set-Cookie: session=<uuid>   │                              │
     │  HttpOnly; Secure; SameSite   │                              │
     │<──────────────────────────────┤                              │
```

### 7.2. Middleware de Autenticação

```typescript
// middlewares/auth.ts
export async function autenticar(req, res, next) {
  const sessionId = req.cookies.session
  if (!sessionId) return res.status(401).json({ erro: 'Não autenticado' })

  const sessao = await sessaoRepo.buscarPorId(sessionId)
  if (!sessao || sessao.expira_em < new Date()) {
    res.clearCookie('session')
    return res.status(401).json({ erro: 'Sessão expirada' })
  }

  req.usuario = await usuarioRepo.buscarPorId(sessao.usuario_id)
  req.sessao = sessao
  next()
}
```

### 7.3. Middleware de Tenant

Seta o `app.current_tenant` antes de qualquer query:

```typescript
// middlewares/tenant.ts
export async function setTenant(req, res, next) {
  await db.execute(sql`SELECT set_config('app.current_tenant', ${req.usuario.tenant_id}, TRUE)`)
  next()
}
```

### 7.4. Token Público (QR Code)

O token público é composto por **UUID v4 + HMAC** para evitar que alguém adivinhe o token e acesse um orçamento alheio:

```typescript
// lib/token.ts
export function gerarTokenPublico(versaoId: string): string {
  const uuid = randomUUID()
  const hmac = createHmac('sha256', process.env.SESSION_SECRET!)
    .update(`${versaoId}:${uuid}`)
    .digest('hex')
    .slice(0, 32)
  return `${uuid}.${hmac}`
}
```

URL pública: `https://ni-doc.com/publico/orcamento/<token>`

---

## 8. Contratos de API

### 8.1. Convenções

- **Base URL:** `/api`
- **Autenticação:** cookie `session`
- **Formato:** JSON
- **Erros:** `{ erro: string, detalhes?: unknown }`
- **Paginação:** `?pagina=1&limite=20`

### 8.2. Endpoints (resumo)

| Método | Rota | Descrição | Auth |
|--------|------|-----------|:----:|
| POST | /api/auth/login | Login | ❌ |
| POST | /api/auth/logout | Logout | ✅ |
| GET | /api/auth/me | Dados do usuário logado | ✅ |
| GET | /api/orcamentos | Lista orçamentos | ✅ |
| POST | /api/orcamentos | Cria orçamento | ✅ |
| GET | /api/orcamentos/:id | Detalha orçamento | ✅ |
| PUT | /api/orcamentos/:id | Atualiza rascunho | ✅ |
| DELETE | /api/orcamentos/:id | Remove rascunho | ✅ |
| POST | /api/orcamentos/:id/enviar | Envia (gera versão) | ✅ |
| POST | /api/orcamentos/:id/aceite-manual | Aceite manual | ✅ |
| GET | /api/orcamentos/:id/versoes | Lista versões | ✅ |
| GET | /api/orcamentos/:id/versoes/:versao/pdf | Baixa PDF da versão | ✅ |
| GET | /api/clientes?q=... | Autocomplete clientes | ✅ |
| POST | /api/clientes | Cria cliente | ✅ |
| PUT | /api/clientes/:id | Edita cliente | ✅ |
| GET | /api/empresas?q=...&tipo=cliente_pj | Autocomplete empresas | ✅ |
| POST | /api/empresas | Cria empresa | ✅ |
| GET | /api/responsaveis?q=... | Autocomplete responsáveis | ✅ |
| POST | /api/responsaveis | Cria responsável | ✅ |
| GET | /api/templates/atual | Template ativo do tenant | ✅ |
| PUT | /api/templates/atual | Salva template (cria nova versão) | ✅ (admin) |
| GET | /api/publico/orcamento/:token | Visualiza orçamento | ❌ |
| POST | /api/publico/orcamento/:token/aprovar | Aprova via público | ❌ |
| POST | /api/publico/orcamento/:token/reprovar | Reprova via público | ❌ |

### 8.3. Exemplo de Payload

**Criar orçamento:**

```json
POST /api/orcamentos
{
  "cliente_id": "uuid",
  "titulo": "Proposta Comercial",
  "descricao": "Descrição do projeto",
  "validade_dias": 30,
  "observacoes": "Observações gerais",
  "condicoes_pagamento": "50% na aprovação, 50% na entrega",
  "desconto_global_tipo": "percentual",
  "desconto_global_valor": 5,
  "itens": [
    {
      "nome": "Desenvolvimento de API",
      "descricao": "Backend em Node.js",
      "quantidade": 40,
      "unidade": "h",
      "valor_unitario": 200,
      "desconto_tipo": "percentual",
      "desconto_valor": 10,
      "responsavel_id": "uuid-opcional"
    }
  ]
}
```

**Resposta de orçamento:**

```json
{
  "id": "uuid",
  "numero": "ORC-2026-0001",
  "status": "rascunho",
  "cliente": {
    "id": "uuid",
    "nome": "Condomínio Solar Prime",
    "documento": "12.345.678/0001-90"
  },
  "titulo": "Proposta Comercial",
  "itens": [
    {
      "id": "uuid",
      "ordem": 1,
      "nome": "Desenvolvimento de API",
      "quantidade": 40,
      "unidade": "h",
      "valor_unitario": 200,
      "desconto_tipo": "percentual",
      "desconto_valor": 10,
      "total": 7200
    }
  ],
  "subtotal": 7200,
  "desconto_global_tipo": "percentual",
  "desconto_global_valor": 5,
  "total": 6840,
  "versao_atual": 0,
  "data_emissao": "2026-10-01",
  "validade_dias": 30
}
```

---

## 9. Fluxos Principais

### 9.1. Criar Orçamento

```
1. Operador clica "Novo Orçamento"
2. Preenche cliente (autocomplete ou cria novo)
3. Preenche título, descrição, validade
4. Adiciona itens (autocomplete de responsável, cálculo automático)
5. Salva como rascunho
   → POST /api/orcamentos
   → INSERT em orcamentos + orcamento_itens
   → Evento em eventos_auditoria
   → Retorna id + número
```

### 9.2. Enviar Orçamento (Versionamento + Snapshot)

```
1. Operador clica "Enviar"
2. Backend:
   a. Valida que é rascunho e tem itens
   b. Carrega dados vivos de cliente, empresa e responsáveis
   c. Cria snapshot JSONB (cópia imutável dos dados)
   d. Gera token público (UUID + HMAC)
   e. Carrega template ativo do tenant (versão atual)
   f. Cria registro em orcamento_versoes:
      - versao = versao_atual + 1
      - snapshot = cópia imutável
      - template_id = versão atual do template
      - token_publico = UUID + HMAC
   g. Atualiza orcamentos.status = 'enviado', versao_atual = N
   h. Gera PDF (Puppeteer) com QR Code
   i. Calcula hash SHA-256 do PDF
   j. Salva PDF em disco (imutável) e hash em orcamento_versoes
   k. Envia e-mail ao cliente com link
   l. Registra evento em eventos_auditoria
3. Retorna versão criada
```

### 9.3. Aceite do Cliente

```
1. Cliente escaneia QR Code → acessa /publico/orcamento/<token>
2. Backend:
   a. Valida token
   b. Verifica expiração
   c. Carrega versão + snapshot
   d. Retorna dados + URL do PDF
3. Frontend exibe orçamento + botões Aprovar/Reprovar
4. Cliente marca checkbox + clica Aprovar
   → POST /api/publico/orcamento/<token>/aprovar
5. Backend:
   a. Valida token novamente
   b. Registra em orcamento_aceites:
      - ip, user_agent, hash, metodo='cliente'
   c. Atualiza orcamentos.status = 'aprovado'
   d. Gera comprovante de aceite (PDF)
   e. Envia e-mail ao operador
   f. Registra evento em eventos_auditoria
```

### 9.4. Alteração de Template

```
1. Admin clica "Salvar template"
2. Backend:
   a. Cria nova versão em templates (versao = última + 1)
   b. Atualiza tenants_template_ativo.template_id
   c. Registra evento em eventos_auditoria
3. Templates anteriores permanecem imutáveis (para reprodução de versões antigas)
```

### 9.5. Reimpressão de Versão Antiga

```
1. Operador acessa "Versões" do orçamento
2. Seleciona versão X
3. Backend:
   a. Carrega orcamento_versoes
   b. Serve o PDF armazenado (imutável)
   c. Se PDF ausente, retorna erro 404 (não regenera)
```

---

## 10. Geração de PDF

### 10.1. Estratégia

1. Backend recebe `orcamento_id` e `versao`
2. Carrega snapshot da versão + template referenciado
3. Renderiza HTML com placeholders substituídos
4. Aplica CSS do template (fontes, cores, layout)
5. Puppeteer converte HTML → PDF
6. Calcula SHA-256 do PDF
7. Salva PDF em disco (`/var/ni-doc/pdfs/{tenant}/{orcamento}/{versao}.pdf`)
8. Salva hash em `orcamento_versoes.pdf_hash`
9. **PDF nunca é regenerado.** Se ausente, retorna erro.

### 10.2. Estrutura do HTML Renderizado

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: A4; margin: 0; }
    body { margin: 0; }
    /* CSS do template */
  </style>
</head>
<body>
  <!-- Página 1 -->
  <div class="pagina">
    <img class="pdf-fundo" src="data:image/png;base64,..." />
    <div class="placeholder" style="...">{cliente}</div>
    <div class="placeholder" style="...">{numero}</div>
    <!-- Área de itens (pode quebrar página) -->
    <div class="area-itens">
      <div class="item">...</div>
      <div class="item">...</div>
    </div>
  </div>
  <!-- Página 2+ (se necessário) -->
</body>
</html>
```

### 10.3. Quebra de Página

A quebra é calculada no backend antes de gerar o PDF:

1. Mede a altura de cada item renderizado
2. Agrupa itens em páginas que caibam na área configurada
3. Duplica header/footer em cada página
4. Gera HTML final com todas as páginas

**Implementação:** Puppeteer pode medir a altura real dos elementos via `page.evaluate()`. Alternativamente, usamos uma estimativa baseada em `altura_linha * linhas + padding`.

---

## 11. Editor de Template (MVP)

### 11.1. Escopo do MVP

Para a Fase 1, o editor terá:

- Canvas A4 fixo (210mm x 297mm)
- Upload de PDF de fundo (convertido para imagem no cliente)
- Upload de imagens (PNG, JPG, SVG) com drag, resize, rotate
- Upload de fontes (TTF, OTF, WOFF, WOFF2)
- Placeholders de texto ({cliente}, {numero}, etc.)
- Área de itens com altura máxima configurável
- Header/footer repetidos
- Salvar como JSON (cria nova versão do template)

**Fora do MVP:**
- Múltiplos templates por tenant
- Editor visual com timeline/animações
- Colaboração em tempo real
- Versionamento visual de templates (comparação lado a lado)

### 11.2. Modelo JSON do Template

```json
{
  "versao": 1,
  "paginas": [
    {
      "fundo": "base64:...",
      "largura": 210,
      "altura": 297,
      "elementos": [
        {
          "tipo": "texto",
          "x": 20, "y": 30,
          "largura": 100, "altura": 15,
          "conteudo": "{cliente}",
          "fonte": "Inter",
          "tamanho": 14,
          "alinhamento": "left",
          "cor": "#000000"
        },
        {
          "tipo": "imagem",
          "x": 150, "y": 20,
          "largura": 40, "altura": 40,
          "src": "base64:...",
          "ajuste": "contain",
          "rotacao": 0
        },
        {
          "tipo": "area-itens",
          "x": 20, "y": 100,
          "largura": 170, "altura": 150,
          "templateItem": [],
          "quebraPagina": true
        }
      ]
    }
  ],
  "header": { "elementos": [] },
  "footer": { "elementos": [] }
}
```

---

## 12. Auditoria

Toda operação sensível chama `auditoria.service.registrar()`:

```typescript
// services/auditoria.service.ts
export async function registrar(params: {
  tenantId: string
  usuarioId?: string
  acao: string
  entidade: string
  entidadeId?: string
  estadoAnterior?: unknown
  estadoNovo?: unknown
  ip?: string
  userAgent?: string
}) {
  await auditoriaRepo.inserir({
    ...params,
    estadoAnterior: params.estadoAnterior ? JSON.stringify(params.estadoAnterior) : null,
    estadoNovo: params.estadoNovo ? JSON.stringify(params.estadoNovo) : null,
  })
}
```

---

## 13. Segurança

### 13.1. Camadas de Defesa

| Camada | Medida |
|--------|--------|
| Rede | HTTPS/TLS 1.3, HSTS, firewall na VPS |
| Aplicação | Rate limiting, validação Zod, sanitização |
| Sessão | Cookie HttpOnly + Secure + SameSite=Lax, rotação, expiração |
| Dados | AES-256-GCM, Argon2id, RLS |
| Auditoria | Log de eventos sensíveis com IP + user agent |
| Dependências | `npm audit` no CI, Dependabot |

### 13.2. Rate Limiting

```
Login: 5 tentativas / 15 min por IP
API geral: 100 requisições / min por usuário
PDF: 10 gerações / min por usuário
```

### 13.3. Headers de Segurança

```typescript
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'", 'data:'],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true },
}))
```

---

## 14. Performance

| Operação | Meta | Estratégia |
|----------|------|------------|
| Login | < 300ms | Argon2 com parâmetros calibrados |
| Listar orçamentos | < 200ms | Índices em `tenant_id`, `status` |
| Criar/atualizar orçamento | < 400ms | Transação única, cálculos em SQL |
| Gerar PDF | < 2s | Puppeteer com pool de instâncias |
| Carregar template | < 100ms | Cache em memória (TTL 5 min) |

### 14.1. Pool de Puppeteer

Uma única instância do browser reutilizada com múltiplas páginas:

```typescript
let browserInstance: Browser | null = null

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await puppeteer.launch({ headless: true })
  }
  return browserInstance
}
```

---

## 15. Estratégia de Testes (TDD)

### 15.1. Pirâmide

```
        ┌─────────────────┐
        │   E2E (poucos)  │  Playwright (opcional, fase 2)
        ├─────────────────┤
        │ Integração (alguns) │  Vitest + Supertest + PostgreSQL
        ├─────────────────┤
        │   Unitários (muitos) │  Vitest (funções puras, services)
        └─────────────────┘
```

### 15.2. Cobertura Mínima

| Camada | Meta |
|--------|------|
| Services (regras de negócio) | 90% |
| Repositories | 80% |
| Lib (crypto, hash, token) | 100% |
| Rotas | 70% |

### 15.3. Exemplos de Testes Prioritários

**Unitários (Vitest):**
- `calcularTotalOrcamento()` — subtotal, desconto, total
- `criptografar()` / `descriptografar()` — round-trip
- `hashDocumento()` — normalização de CPF/CNPJ
- `gerarTokenPublico()` — unicidade e validação HMAC
- `validarCPF()` / `validarCNPJ()` — dígito verificador
- `criarSnapshot()` — cópia imutável dos dados

**Integração (Vitest + Supertest):**
- Fluxo completo de criação de orçamento
- Envio gera versão correta + snapshot imutável
- Alteração de cliente NÃO reflete em versão emitida
- Aceite registra IP/timestamp/hash corretos
- RLS impede acesso cross-tenant
- Sessão expirada retorna 401
- PDF ausente retorna erro (não regenera)

**E2E (opcional):**
- Operador cria orçamento → cliente aprova via link → status muda

---

## 16. Docker

### 16.1. docker-compose.yml (dev)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ni_doc
      POSTGRES_PASSWORD: ni_doc_dev
      POSTGRES_DB: ni_doc
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgres://ni_doc:ni_doc_dev@postgres:5432/ni_doc
      CRYPTO_KEY: ${CRYPTO_KEY}
      SESSION_SECRET: ${SESSION_SECRET}
      NODE_ENV: development
    ports:
      - "3000:3000"
    depends_on:
      - postgres
    volumes:
      - ./backend/src:/app/src
      - pdfs:/var/ni-doc/pdfs

  frontend:
    build: ./frontend
    ports:
      - "5173:5173"
    depends_on:
      - backend

volumes:
  postgres_data:
  pdfs:
```

### 16.2. docker-compose.prod.yml

Similar ao de dev, mas:

- Sem volumes de código (build imutável)
- Nginx como reverse proxy
- Variáveis de ambiente injetadas pelo host

---

## 17. Deploy (Hostinger VPS)

### 17.1. Fluxo

```
1. Push na main
2. GitHub Actions roda CI (lint + test + build)
3. Se passar, faz SSH na VPS e roda:
   - git pull
   - docker compose -f docker-compose.prod.yml up -d --build
   - docker compose exec backend npm run migrate
4. Nginx já está configurado para proxy reverso + TLS
```

### 17.2. Estrutura na VPS

```
/var/www/ni-doc/          # código
/var/ni-doc/pdfs/         # PDFs gerados (imutáveis)
/var/ni-doc/uploads/      # uploads de imagens/fontes
/etc/nginx/sites-enabled/ # nginx
/etc/letsencrypt/         # certificados TLS
```

---

## 18. Decisões Arquiteturais (ADRs)

### ADR-001: Express em vez de Fastify

**Contexto:** Precisamos de um framework HTTP para o backend.

**Decisão:** Express 5.

**Justificativa:** Mais documentado, mais tutoriais, ideal para quem está inseguro no backend. Fastify seria mais performático, mas a diferença é irrelevante para 20 usuários simultâneos.

### ADR-002: Kysely em vez de ORM

**Contexto:** Precisamos acessar o PostgreSQL com tipagem cuidadosa.

**Decisão:** Kysely (query builder tipado).

**Justificativa:** Mantém controle total sobre SQL, sem mágica de ORM. Tipagem inferida do schema do banco. Curva de aprendizado menor que Drizzle/Prisma para quem já sabe SQL.

### ADR-003: Sessões em PostgreSQL

**Contexto:** Precisamos autenticar usuários.

**Decisão:** Sessões server-side em PostgreSQL + cookie HttpOnly.

**Justificativa:** Simples, auditável, sem dependência externa (Redis). Para 20 usuários, a performance é irrelevante.

### ADR-004: Puppeteer para PDF

**Contexto:** Precisamos gerar PDFs a partir de templates HTML/CSS.

**Decisão:** Puppeteer.

**Justificativa:** Reaproveita o template HTML/CSS do editor visual. Layout complexo sem esforço. Custo: ~300MB de imagem Docker.

### ADR-005: Criptografia em coluna

**Contexto:** Precisamos proteger CPF/CNPJ, e-mail e telefone.

**Decisão:** AES-256-GCM em coluna + hash SHA-256 para busca.

**Justificativa:** Protege dados sensíveis mesmo em backups vazados. Hash permite busca sem expor o dado.

### ADR-006: RLS no PostgreSQL

**Contexto:** Precisamos isolar dados entre tenants.

**Decisão:** Row-Level Security no PostgreSQL.

**Justificativa:** A isolação fica no banco, não no código. Impossível esquecer um `WHERE tenant_id = ...` em uma query.

### ADR-007: Snapshot Pattern para versões emitidas

**Contexto:** Precisamos preservar os dados do orçamento no momento da emissão.

**Decisão:** Rascunhos usam referências (FK); versões emitidas usam snapshot JSONB imutável.

**Justificativa:** Garante que alterações em clientes, empresas ou responsáveis não afetem documentos já emitidos. Preserva integridade jurídica e histórica.

### ADR-008: Versionamento de template

**Contexto:** Templates podem ser alterados, mas versões antigas de orçamentos precisam do layout original.

**Decisão:** Cada alteração no template cria uma nova versão. Versões de orçamento referenciam a versão do template vigente no momento.

**Justificativa:** Garante fidelidade visual de documentos emitidos. Custo baixo (JSONB por versão).

### ADR-009: PDFs imutáveis

**Contexto:** PDFs gerados precisam de validade jurídica.

**Decisão:** PDF armazenado uma única vez, nunca regenerado. Se ausente, retorna erro.

**Justificativa:** Garante que o hash SHA-256 permaneça válido. Impede fraude por regeneração com dados alterados.

---

## 19. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Puppeteer consome muita memória | Alto | Pool de instâncias + limite de concorrência |
| RLS mal configurado vaza dados | Crítico | Testes de integração específicos para cross-tenant |
| Chave de criptografia perdida | Crítico | Backup seguro fora do servidor + rotação documentada |
| PDFs acumulam em disco | Médio | Job de limpeza para PDFs > 1 ano (após retenção legal) |
| Complexidade do editor de template | Alto | MVP simplificado: 1 template ativo, sem comparação visual |
| Snapshot desatualizado por bug | Crítico | Testes que garantem imutabilidade após emissão |

---
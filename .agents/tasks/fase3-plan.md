# Plano de Implementação — Fase 3 (T-301 a T-307)

## Contexto e Estado Atual

- **38 testes passando** nas libs de base (`crypto`, `senha`, `token`, `documento`, `orcamento-calculo`)
- `backend/src/types/database.ts` contém todas as interfaces Kysely prontas
- `"type": "module"` no `package.json` → todos os imports locais **devem usar extensão `.js`**
- `module: "Node16"` no `tsconfig.json` → mesma regra de extensão se aplica ao TypeScript
- Todos os pacotes necessários (express, helmet, cors, cookie-parser, pino-http, express-rate-limit, zod, kysely, pg) **já estão instalados** no `backend/package.json`
- Nenhum pacote extra precisa ser instalado para a Fase 3

## Pacotes — Verificação

| Pacote | Versão instalada | Situação |
|---|---|---|
| `express` | 5.0.1 | ✅ instalado |
| `helmet` | 8.0.0 | ✅ instalado |
| `cors` | 2.8.5 | ✅ instalado |
| `cookie-parser` | 1.4.6 | ✅ instalado |
| `pino-http` | 10.3.0 | ✅ instalado |
| `express-rate-limit` | 7.4.1 | ✅ instalado |
| `zod` | 3.23.8 | ✅ instalado |
| `kysely` | 0.27.4 | ✅ instalado |
| `pg` | 8.13.1 | ✅ instalado |
| `@node-rs/argon2` | 2.2.1 | ✅ instalado |
| `pino` | 9.5.0 | ✅ instalado |

**Nenhum `npm install` necessário.**

## Ordem de Implementação e Justificativas de Dependência

```
T-307 (AuditoriaRepository)
  └── T-301 (Express app + config)
        └── T-302 (UsuarioRepository)
              └── T-303 (SessaoRepository + AuthService)  ← usa usuário + auditoria
                    └── T-304 (Rotas de auth)              ← usa AuthService + schemas
                          └── T-305 (Middlewares auth/tenant) ← usa AuthService
                                └── T-306 (Rate limiting)   ← apenas configura rota existente
```

**Justificativa da ordem:**
1. **T-307 antes de T-303:** `AuthService.login()` registra eventos de auditoria; ter o `AuditoriaRepository` pronto antes evita dependência circular no desenvolvimento.
2. **T-301 (config/env + database) antes de qualquer repositório:** todos os repos dependem da instância Kysely exportada por `config/database.ts`.
3. **T-302 antes de T-303:** `AuthService` chama `UsuarioRepository` para buscar usuário pelo hash de e-mail.
4. **T-303 antes de T-304:** as rotas são apenas a camada HTTP sobre o serviço.
5. **T-305 depois de T-304:** o middleware `autenticar()` depende de `AuthService.validarSessao()`.
6. **T-306 no final:** é apenas configuração de middleware numa rota já existente; zero dependências novas.

---

## Plano Detalhado

- [ ] 1. **T-307 — Repositório e Serviço de Auditoria**

  Criar o repositório e o serviço de auditoria primeiro, porque o `AuthService` (T-303)
  registra eventos de auditoria no login/logout. Ter este módulo pronto desde o início
  evita stubs temporários.

  **Arquivos:**
  - `backend/src/repositories/auditoria.repository.ts`
  - `backend/src/services/auditoria.service.ts`
  - `backend/src/services/__tests__/auditoria.service.test.ts`

  **Interfaces esperadas:**

  ```typescript
  // auditoria.repository.ts
  export interface CriarEventoInput {
    tenantId: string
    usuarioId?: string
    acao: string          // ex: 'login', 'logout', 'criar_orcamento'
    entidade: string      // ex: 'usuarios', 'orcamentos'
    entidadeId?: string
    estadoAnterior?: unknown
    estadoNovo?: unknown
    ip?: string
    userAgent?: string
  }

  export interface FiltroAuditoria {
    tenantId: string
    entidade?: string
    entidadeId?: string
    pagina?: number
    limite?: number
  }

  export interface AuditoriaRepository {
    criar(input: CriarEventoInput): Promise<{ id: string }>
    listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]>
  }

  // auditoria.service.ts — wrapper fino sobre o repository
  export interface AuditoriaService {
    registrar(input: CriarEventoInput): Promise<void>
    listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]>
  }
  ```

  **Dependências:** instância `Kysely<Database>` injetada via parâmetro. Usar
  `Database['eventos_auditoria']` de `types/database.ts`.

  **Abordagem de teste (TDD):**
  - Usar `vi.mock` para o Kysely: mockar `.insertInto().values().returning().executeTakeFirstOrThrow()`
  - e `.selectFrom().where().orderBy().limit().offset().execute()`
  - Não importar nem instanciar Kysely real; injetar o mock via factory
  - Testes cobrem: criar com todos os campos, criar sem campos opcionais, listar filtrado por entidade, listar respeita tenant

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/services/__tests__/auditoria.service.test.ts`

---

- [ ] 2. **T-301 — Configuração do Express**

  Criar a infraestrutura central: validação de env vars, conexão Kysely, app Express
  e server. Esta etapa não depende de nenhum repositório mas é base para todos.

  **Arquivos:**
  - `backend/src/config/env.ts`
  - `backend/src/config/database.ts`
  - `backend/src/errors/app-error.ts`
  - `backend/src/middlewares/error-handler.ts`
  - `backend/src/middlewares/validate.ts`
  - `backend/src/app.ts`
  - `backend/src/server.ts`
  - `backend/src/routes/__tests__/health.test.ts`

  **Interfaces esperadas:**

  ```typescript
  // config/env.ts — schema Zod + parse + export
  export const env = z.object({
    DATABASE_URL: z.string().url(),
    CRYPTO_KEY: z.string().min(1),
    SESSION_SECRET: z.string().min(32),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  }).parse(process.env)

  // config/database.ts — instância Kysely singleton exportada
  export const db: Kysely<Database>

  // errors/app-error.ts
  export class AppError extends Error {
    constructor(
      public readonly statusCode: number,
      public readonly message: string,
      public readonly detalhes?: unknown
    ) { super(message) }
  }

  // middlewares/error-handler.ts
  export function errorHandler(err, req, res, next): void
  // captura AppError → usa statusCode
  // captura ZodError → 400 com detalhes
  // outros → 500 sem vazar stack em produção

  // middlewares/validate.ts
  export function validate(schema: ZodSchema): RequestHandler
  // valida req.body com o schema; lança AppError(400) se inválido

  // app.ts
  export function criarApp(): Express
  // monta middlewares + rotas, não chama listen()

  // server.ts
  // importa env, chama criarApp(), chama app.listen()
  ```

  **Nota:** `app.ts` exporta a função `criarApp()` (não instancia ao importar) para permitir
  que os testes de rota criem instâncias isoladas sem conflito de porta.

  **Rotas registradas em app.ts:**
  - `GET /health` → `{ status: 'ok', timestamp: new Date().toISOString() }`

  **Abordagem de teste (TDD):**
  - `health.test.ts` usa `supertest(criarApp())` — sem porta real
  - Testar: GET /health retorna 200 + JSON esperado
  - Testar: error handler retorna `{ erro: string }` para AppError
  - Testar: error handler retorna 400 para ZodError
  - `env.ts` é testado indiretamente — se o módulo importar sem erro com env vars setadas no setup

  **Setup de variáveis para testes:** criar `backend/src/__tests__/setup.ts` como
  setupFile do Vitest (já existe) — adicionar `process.env['CRYPTO_KEY']`,
  `process.env['SESSION_SECRET']`, `process.env['DATABASE_URL']` com valores fictícios
  para que os módulos carreguem sem erro. Alternativamente definir no próprio teste com
  `vi.stubEnv`.

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/routes/__tests__/health.test.ts`

---

- [ ] 3. **T-302 — Repositório de Usuários**

  Implementar o acesso a dados de usuários com criptografia de e-mail.
  Depende de `config/database.ts` (Kysely) e `lib/crypto.ts` (já pronto).

  **Arquivos:**
  - `backend/src/repositories/usuario.repository.ts`
  - `backend/src/repositories/__tests__/usuario.repository.test.ts`

  **Interface esperada:**

  ```typescript
  export interface CriarUsuarioInput {
    tenantId: string
    nome: string
    email: string           // plain text — será criptografado + hasheado internamente
    senha: string           // plain text — será hasheado internamente
    papel: 'admin' | 'operador'
  }

  export interface UsuarioPublico {
    id: string
    tenantId: string
    nome: string
    email: string           // descriptografado
    papel: 'admin' | 'operador'
    ativo: boolean
    criadoEm: Date
  }

  export interface UsuarioRepository {
    criar(input: CriarUsuarioInput): Promise<UsuarioPublico>
    buscarPorEmail(email: string): Promise<(UsuarioPublico & { senhaHash: string }) | null>
    buscarPorId(id: string): Promise<UsuarioPublico | null>
  }
  ```

  **Detalhes de implementação:**
  - `criar()`: chama `hashDocumento(email.toLowerCase())` para `email_hash`;
    chama `criptografar(email)` para `email_encrypted`;
    chama `hashSenha(senha)` para `senha_hash`
  - `buscarPorEmail()`: calcula hash do email e busca por `email_hash`;
    descriptografa `email_encrypted` antes de retornar
  - `buscarPorId()`: descriptografa `email_encrypted` antes de retornar
  - Injeção: aceita `db: Kysely<Database>` como parâmetro da factory `criarUsuarioRepository(db)`

  **Abordagem de teste (TDD):**
  - `vi.mock` no módulo Kysely: criar objeto fake com métodos encadeados
    (`.insertInto().values().returning().executeTakeFirstOrThrow()` etc.)
  - Testar que `criar()` chama criptografar e hashDocumento (spy em `lib/crypto.ts`)
  - Testar que `buscarPorEmail()` retorna null quando executeTakeFirst retorna undefined
  - Testar que `buscarPorId()` descriptografa o e-mail antes de retornar

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/repositories/__tests__/usuario.repository.test.ts`

---

- [ ] 4. **T-303 — Serviço de Autenticação + Repositório de Sessões**

  Implementar `sessao.repository.ts` e `auth.service.ts`. O serviço de auth
  orquestra: validar credenciais, criar sessão, invalidar sessão, registrar auditoria.
  Depende de T-302 (UsuarioRepository), T-307 (AuditoriaService) e `lib/senha.ts`.

  **Arquivos:**
  - `backend/src/repositories/sessao.repository.ts`
  - `backend/src/services/auth.service.ts`
  - `backend/src/services/__tests__/auth.service.test.ts`

  **Interfaces esperadas:**

  ```typescript
  // sessao.repository.ts
  export interface CriarSessaoInput {
    usuarioId: string
    ip?: string
    userAgent?: string
    expiraEm: Date
  }

  export interface SessaoRepository {
    criar(input: CriarSessaoInput): Promise<{ id: string; expiraEm: Date }>
    buscarPorId(id: string): Promise<SessaoAtiva | null>
    // SessaoAtiva inclui: id, usuarioId, expiraEm, ultimaAtividade
    invalidar(id: string): Promise<void>
    // delete por id
    atualizarAtividade(id: string): Promise<void>
    // UPDATE ultima_atividade = NOW()
  }

  // auth.service.ts
  export interface LoginInput {
    email: string
    senha: string
    ip?: string
    userAgent?: string
  }

  export interface LoginResult {
    sessaoId: string
    expiraEm: Date
    usuario: {
      id: string
      nome: string
      email: string
      papel: 'admin' | 'operador'
      tenantId: string
    }
  }

  export interface AuthService {
    login(input: LoginInput): Promise<LoginResult>
    logout(sessaoId: string): Promise<void>
    validarSessao(sessaoId: string): Promise<{ usuario: UsuarioPublico; sessao: SessaoAtiva } | null>
  }
  ```

  **Detalhes de implementação de `login()`:**
  1. Busca usuário por email via `usuarioRepo.buscarPorEmail()`
  2. Se não encontrar → lança `AppError(401, 'Credenciais inválidas')`
  3. Se `usuario.ativo === false` → lança `AppError(401, 'Usuário inativo')`
  4. Chama `verificarSenha(senha, usuario.senhaHash)`
  5. Se falso → lança `AppError(401, 'Credenciais inválidas')`
  6. Cria sessão com `expiraEm = agora + 8h`
  7. Registra evento de auditoria: `acao='login', entidade='usuarios', entidadeId=usuario.id`
  8. Retorna `LoginResult`

  **Detalhes de `validarSessao()`:**
  - Busca sessão; se `expiraEm < new Date()` retorna `null` (não deleta — deixa para um job futuro)
  - Chama `atualizarAtividade()` em sessões válidas
  - Retorna `{ usuario, sessao }` ou `null`

  **Injeção de dependências:** factory `criarAuthService({ usuarioRepo, sessaoRepo, auditoriaService })`

  **Abordagem de teste (TDD):**
  - Todos os colaboradores injetados como mocks de vi (`vi.fn()`)
  - Testar login bem-sucedido: verifica que sessaoRepo.criar foi chamado e retornou sessaoId
  - Testar login com email inexistente: espera AppError(401)
  - Testar login com usuário inativo: espera AppError(401)
  - Testar login com senha errada: espera AppError(401)
  - Testar logout: verifica que sessaoRepo.invalidar foi chamado
  - Testar validarSessao com sessão expirada: retorna null
  - Testar validarSessao com sessão válida: retorna usuario + sessao

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/services/__tests__/auth.service.test.ts`

---

- [ ] 5. **T-304 — Rotas de Autenticação**

  Criar schemas Zod para os payloads de auth e as rotas HTTP. Depende de T-303
  (AuthService) e T-301 (middlewares validate, error-handler, criarApp).

  **Arquivos:**
  - `backend/src/schemas/auth.schema.ts`
  - `backend/src/routes/auth.routes.ts`
  - `backend/src/routes/__tests__/auth.routes.test.ts`

  **Interfaces esperadas:**

  ```typescript
  // auth.schema.ts
  export const loginSchema = z.object({
    email: z.string().email(),
    senha: z.string().min(8),
  })
  export type LoginPayload = z.infer<typeof loginSchema>

  // auth.routes.ts
  // Exporta Router do Express, recebe authService via parâmetro
  export function criarAuthRouter(authService: AuthService): Router

  // Endpoints:
  // POST /login    — sem auth, validate(loginSchema), chama authService.login()
  //                  resposta: 200 + { usuario } + Set-Cookie: session=<uuid>; HttpOnly; SameSite=Lax
  // POST /logout   — sem auth obrigatório, limpa cookie, chama authService.logout() se cookie presente
  // GET  /me       — usa middleware autenticar (injetado), retorna req.usuario
  ```

  **Cookie de sessão:**
  - Nome: `session`
  - Flags: `httpOnly: true, sameSite: 'lax', secure: env.NODE_ENV === 'production'`
  - MaxAge em ms: `expiraEm.getTime() - Date.now()`

  **Registro em `app.ts`:**
  - `app.use('/api/auth', criarAuthRouter(authService))`
  - Instanciar `authService` com os repos injetados na função `criarApp(db)`

  **Abordagem de teste (TDD):**
  - Usar `supertest` + `vi.mock` do `auth.service.ts`
  - `POST /api/auth/login` com payload válido → 200 + cookie `session` no header
  - `POST /api/auth/login` com payload inválido (sem senha) → 400
  - `POST /api/auth/login` com credenciais inválidas (authService.login lança AppError 401) → 401
  - `POST /api/auth/logout` → 200 + `Set-Cookie: session=; Max-Age=0`
  - `GET /api/auth/me` com cookie válido → 200 + dados do usuário
  - `GET /api/auth/me` sem cookie → 401

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/routes/__tests__/auth.routes.test.ts`

---

- [ ] 6. **T-305 — Middlewares de Auth e Tenant**

  Criar `autenticar()` e `setTenant()`. O `autenticar()` usa `AuthService.validarSessao()`.
  O `setTenant()` usa a instância Kysely diretamente para fazer `set_config`.
  Depende de T-303 (AuthService) e T-301 (AppError, instância db).

  **Arquivos:**
  - `backend/src/middlewares/auth.ts`
  - `backend/src/middlewares/tenant.ts`
  - `backend/src/types/express.d.ts`
  - `backend/src/middlewares/__tests__/auth.test.ts`

  **Interfaces esperadas:**

  ```typescript
  // types/express.d.ts — augmenta o namespace Express
  import type { UsuarioPublico } from '../repositories/usuario.repository.js'
  import type { SessaoAtiva } from '../repositories/sessao.repository.js'

  declare global {
    namespace Express {
      interface Request {
        usuario: UsuarioPublico
        sessao: SessaoAtiva
      }
    }
  }

  // middlewares/auth.ts
  export function criarMiddlewareAuth(authService: AuthService): RequestHandler
  // Lê req.cookies.session
  // Chama authService.validarSessao(sessaoId)
  // Se null → res.clearCookie('session') + AppError(401)
  // Se válido → atribui req.usuario e req.sessao, chama next()

  // middlewares/tenant.ts
  export function criarMiddlewareTenant(db: Kysely<Database>): RequestHandler
  // Executa: await db.executeQuery(sql`SELECT set_config('app.current_tenant', ${tenantId}, TRUE)`)
  // onde tenantId = req.usuario.tenantId
  // Chama next()
  ```

  **Nota sobre tipagem:** com `"strict": true` e `noUncheckedIndexedAccess`, as propriedades
  adicionadas ao `Request` via augmentation precisam ser declaradas como opcionais (`usuario?: ...`)
  ou via cast tipado. Escolha: declarar como obrigatórias no d.ts, aceitar que TypeScript confia
  nos middlewares para garantir que estejam presentes quando a rota os requer.

  **Abordagem de teste (TDD):**
  - Mockar `authService.validarSessao` com `vi.fn()`
  - Testar `autenticar`: sem cookie → 401
  - Testar `autenticar`: validarSessao retorna null → 401 + clearCookie
  - Testar `autenticar`: validarSessao retorna usuário → next() chamado + req.usuario populado
  - Testar `setTenant`: verifica que executeQuery foi chamado com o tenant_id correto

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/middlewares/__tests__/auth.test.ts`

---

- [ ] 7. **T-306 — Rate Limiting no Login**

  Criar o middleware de rate limit e aplicá-lo na rota de login.
  Depende de T-304 (auth.routes.ts já criado).

  **Arquivos:**
  - `backend/src/middlewares/rate-limit.ts`
  - `backend/src/routes/auth.routes.ts` (atualização: aplicar rateLimit em POST /login)

  **Interface esperada:**

  ```typescript
  // middlewares/rate-limit.ts
  import rateLimit from 'express-rate-limit'

  export const loginRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutos
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { erro: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
    skipSuccessfulRequests: false,
  })
  ```

  **Aplicação:** no `criarAuthRouter()`, registrar `loginRateLimit` como middleware
  específico de `router.post('/login', loginRateLimit, validate(loginSchema), handler)`.

  **Abordagem de teste:**
  - Usar `supertest` em sequência: fazer 5 requisições POST /login com credenciais inválidas
    (mockando authService para lançar AppError 401)
  - A 6ª requisição deve retornar 429
  - **Atenção:** o `express-rate-limit` por padrão usa store em memória — funciona bem em testes
    mas a instância do store é compartilhada entre chamadas. Criar uma nova instância do rate
    limiter por teste ou usar `store.resetKey(ip)` entre testes para evitar interferência.

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run backend/src/routes/__tests__/auth.routes.test.ts`

---

- [ ] 8. **Integração e verificação completa**

  Após todos os itens acima, rodar a suíte completa para confirmar que os 38 testes
  existentes continuam passando e os novos testes da Fase 3 também passam.

  **Verify:** `cd /Users/nilson/Dev/ni-doc && npx vitest run`
  Resultado esperado: todos os arquivos de teste passando, sem falhas nos testes das Fases 0–2.

---

## Riscos e Pontos de Atenção

### 1. Imports ESM com extensão `.js` (alta atenção)

Com `"type": "module"` e `"module": "Node16"`, o TypeScript exige que todos os imports
de módulos locais usem a extensão `.js`, mesmo que o arquivo-fonte seja `.ts`:

```typescript
// CORRETO
import { criptografar } from '../lib/crypto.js'
import { Database } from '../types/database.js'

// ERRADO — vai falhar em runtime
import { criptografar } from '../lib/crypto'
```

Qualquer import esquecido causará `ERR_MODULE_NOT_FOUND` em runtime e erro de compilação.

### 2. Configuração de env vars nos testes

O módulo `config/env.ts` chama `z.parse(process.env)` no top-level ao ser importado.
Isso significa que qualquer teste que importe (direta ou indiretamente) `config/env.ts`
ou `config/database.ts` vai falhar se as variáveis não estiverem definidas.

**Solução recomendada:** adicionar no `backend/src/__tests__/setup.ts` (que já é o
`setupFiles` do Vitest):

```typescript
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test'
process.env['CRYPTO_KEY'] = Buffer.alloc(32).toString('base64')
process.env['SESSION_SECRET'] = 'test-secret-com-pelo-menos-32-caracteres-aqui'
process.env['NODE_ENV'] = 'test'
```

Alternativamente, usar `vi.stubEnv()` por arquivo de teste quando precisar de controle
granular. O importante é que o setup aconteça **antes** do módulo `env.ts` ser importado.

### 3. Express 5 — async errors automáticos

O projeto usa Express 5.0.1. No Express 5, `async` handlers propagam erros automaticamente
para o `next` sem precisar de try/catch manual. Isso é diferente do Express 4.
O `error-handler.ts` se beneficia disso — não precisa de `express-async-errors` ou
wrappers especiais.

### 4. Kysely mock nos testes de repositório

O Kysely usa um fluent builder API fortemente tipado (`insertInto().values()...`).
Para mockar corretamente com `vi.mock`, a abordagem mais simples é injetar um objeto
fake como `db` — não tentar mockar o módulo `config/database.ts` globalmente.

Exemplo de padrão de mock:

```typescript
const mockDb = {
  insertInto: vi.fn().mockReturnValue({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockReturnValue({
        executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: 'uuid-fake' })
      })
    })
  }),
  // ... outros métodos conforme necessário
} as unknown as Kysely<Database>
```

Cada teste deve recriar ou resetar os mocks (`vi.clearAllMocks()` no `beforeEach`)
para evitar que um teste afete o próximo.

### 5. Cookie seguro em testes

O supertest não roda sobre HTTPS real, então `secure: true` no cookie causaria que o
cookie não fosse enviado de volta em testes. A flag `secure` deve ser
`env.NODE_ENV === 'production'` — em ambiente de teste `NODE_ENV='test'`, o cookie
será enviado sem `Secure` e os testes funcionarão normalmente.

### 6. Rate limit entre testes

O `express-rate-limit` com store em memória mantém estado entre requisições na mesma
instância do app. Em `auth.routes.test.ts`, criar uma nova instância de app (via
`criarApp()`) ou do router por `describe` block para garantir que o contador do rate
limit resete entre suítes de teste. Alternativamente, expor a instância do limiter e
chamar `limiter.resetKey(ip)` no `afterEach`.

### 7. `req.usuario` tipagem no TypeScript strict

Com `noUncheckedIndexedAccess` e strict, acessar `req.usuario` antes de passar pelo
middleware `autenticar` pode causar erro de tipo "possibly undefined". A augmentation
em `types/express.d.ts` declarará o campo como obrigatório; o contrato arquitetural
garante que toda rota protegida sempre passe pelo middleware. Não usar `!` — a
tipagem por augmentation é suficiente.

### 8. Sessão com expiração — não deletar no validar

`validarSessao()` detecta sessões expiradas e retorna null, mas **não as deleta**.
Deletar no caminho quente de cada requisição desperdiça uma query de escrita.
A limpeza de sessões expiradas ficará para um job de manutenção em fase futura.
Isso está alinhado com o design — registrar no `findings` do FEAT quando implementado.

---

## Resumo de Arquivos por Tarefa

| Tarefa | Novos arquivos | Arquivos modificados |
|---|---|---|
| T-307 | `repositories/auditoria.repository.ts`, `services/auditoria.service.ts`, `services/__tests__/auditoria.service.test.ts` | — |
| T-301 | `config/env.ts`, `config/database.ts`, `errors/app-error.ts`, `middlewares/error-handler.ts`, `middlewares/validate.ts`, `app.ts`, `server.ts`, `routes/__tests__/health.test.ts` | `src/__tests__/setup.ts` |
| T-302 | `repositories/usuario.repository.ts`, `repositories/__tests__/usuario.repository.test.ts` | — |
| T-303 | `repositories/sessao.repository.ts`, `services/auth.service.ts`, `services/__tests__/auth.service.test.ts` | — |
| T-304 | `schemas/auth.schema.ts`, `routes/auth.routes.ts`, `routes/__tests__/auth.routes.test.ts` | `app.ts` |
| T-305 | `middlewares/auth.ts`, `middlewares/tenant.ts`, `types/express.d.ts`, `middlewares/__tests__/auth.test.ts` | — |
| T-306 | `middlewares/rate-limit.ts` | `routes/auth.routes.ts` |

**Total de arquivos novos:** 20  
**Total de arquivos modificados:** 2 (`setup.ts`, `app.ts`, `auth.routes.ts`)

---

## Comando de Verificação Final

```bash
cd /Users/nilson/Dev/ni-doc && npx vitest run
```

Resultado esperado ao concluir toda a Fase 3:
- Todos os testes das Fases 0–2 continuam passando (38 testes)
- Novos testes da Fase 3 passando
- Zero falhas, zero testes em modo skip

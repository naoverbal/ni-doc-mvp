# Implementation Plan — Tarefa 35: Rotas de template

Tarefa pequena e bem escopada, executada na árvore principal (sem worktree):
um arquivo de rota + um schema Zod + testes, mais o registro do router em `app.ts`.

Requirements: RF-013, RF-014. DoD: restrição de papel aplicada; lint e build limpos; testes passando.

## Contexto descoberto (fatos verificados no código)

### Interface real do `TemplateService` (`backend/src/services/template.service.ts`)

Métodos consumidos pelas rotas:

- `buscarAtivo(ctx: TemplateContexto): Promise<TemplatePublico>` — retorna a versão
  ativa do tenant; lança `AppError(404, 'Template não encontrado')` se não houver.
- `salvar(ctx: TemplateContexto, layoutJson: LayoutTemplate): Promise<TemplatePublico>` —
  cria uma NOVA versão (append-only, max+1) e registra auditoria. Retorna a versão criada.
- (não usados pelas rotas desta tarefa: `criarTemplatePadrao(tenantId)`, `buscarPorId(ctx, id)`.)

Tipos de apoio:

- `TemplateContexto = { tenantId: string; usuarioId: string; ip?: string; userAgent?: string }`
  — mesmo shape de `ClienteContexto`/`OrcamentoContexto`.
- `LayoutTemplate = Record<string, unknown>` (exportado de
  `repositories/template.repository.ts`) — JSON genérico; o shape rígido é validado
  pelo Zod na rota.
- `TemplatePublico = { id, tenantId, versao, layoutJson, criadoEm }`.

### Papel do usuário (admin/operador)

- Não existe middleware de papel/autorização no projeto (confirmado:
  `backend/src/middlewares/` só tem `auth`, `tenant`, `validate`, `rate-limit`,
  `error-handler`; nenhum `exigirPapel`/`autorizar`).
- O papel está em `req.usuario.papel: 'admin' | 'operador'`. `req.usuario` é do tipo
  `UsuarioPublico` (augmentação em `backend/src/types/express.d.ts`), anexado pelo
  `criarMiddlewareAuth` em `middlewares/auth.ts`.
- **Decisão:** criar um middleware de papel reutilizável e enxuto
  `criarMiddlewareExigirPapel(papel)` em `backend/src/middlewares/auth.ts` (mesmo arquivo
  do auth, factory no mesmo estilo `criarMiddleware*`) que lança
  `AppError(403, 'Acesso negado')` quando `req.usuario.papel !== papel`. Alternativa
  considerada: checagem inline na rota PUT. Escolhi o middleware porque é testável,
  reutilizável (outras rotas admin virão) e mantém a rota declarativa como as demais
  (`autenticar`, `validate(schema)`). O `AppError(403)` é mapeado para HTTP 403 pelo
  `errorHandler` (já instanceof `AppError`).

### Montagem no `app.ts`

- Padrão de domínio: `const xRepo = criar*Repository(...)`, `const xService =
  criar*Service({ ..., auditoriaService })`, `app.use('/api/<dominio>',
  criar*Router(xService, authService))`. `authService` e `auditoriaService` já existem
  no escopo de `criarApp`. `db` é importado de `./config/database.js`.
- **Prefixo:** `/api/templates` (segue o padrão `/api/<dominio>` plural). As subrotas
  são `/atual` → caminhos finais `GET /api/templates/atual` e `PUT /api/templates/atual`.
- Dependências novas a instanciar em `criarApp`: `criarTemplateRepository({ db })` e
  `criarTemplateService({ templateRepo, auditoriaService })`.
- Observação sobre `setTenant`: os routers de domínio existentes (clientes, orçamentos
  etc.) ainda NÃO aplicam o middleware `tenant.ts` (isso é tarefa separada de wiring de
  RLS, itens 389-393 de tasks.md). Para manter consistência com o padrão atual, o router
  de templates usa apenas `autenticar`, igual aos demais hoje. Não antecipar `setTenant`.

### Padrões de rota (de `clientes.routes.ts` / `orcamentos.routes.ts`)

- Factory `criar*Router(service, authService): Router`.
- `const autenticar = criarMiddlewareAuth(authService)` + `router.use(autenticar)`.
- Helper local `construirContexto(req): TemplateContexto` idêntico aos vizinhos
  (`tenantId: req.usuario.tenantId`, `usuarioId: req.usuario.id`, `ip`, `userAgent`).
- Handlers `async (req, res, next)` com `try/catch (err) { next(err) }`.
- Validação de body via `validate(schema)` (middleware em `middlewares/validate.ts`,
  seta `req.body = result.data` e lança `AppError(400, 'Dados inválidos', ...)`).

### Padrão de schema Zod (de `cliente.schema.ts` / `orcamento.schema.ts`)

- `import { z } from 'zod'`; export do schema + `export type X = z.infer<typeof schema>`.
- Validação apenas de forma; regra de negócio fica no service.

### Padrão de teste de rota (de `clientes.routes.test.ts`)

- Vitest + supertest; `makeAuthService(overrides?)` com `validarSessao` mockado
  retornando `{ usuario, sessao }`; `makeXService(overrides?)` mockando os métodos;
  `makeApp(service, authService)` monta um express mínimo
  (`express.json()` + `cookieParser()` + router + `errorHandler`).
- Autenticação simulada por cookie `session=sessao-id-1`; papel definido pelo
  `usuario` que o `authService` mockado devolve.
- Convenções: pt-BR; imports ESM com extensão `.js` mesmo em `.ts`; Prettier
  (aspas simples, sem ponto e vírgula, 2 espaços, trailing comma all, width 100).

## Comandos de verificação (do `backend/package.json`)

Rodar a partir de `backend/`:

- Testes: `npm test` (vitest run) ou focado `npx vitest run src/routes/__tests__/templates.routes.test.ts`
- Build: `npm run build` (tsc)
- Lint: `npm run lint` (eslint src)

## Arquivos a criar / alterar

- Criar `backend/src/schemas/template.schema.ts`
- Criar `backend/src/routes/templates.routes.ts`
- Criar `backend/src/routes/__tests__/templates.routes.test.ts`
- Alterar `backend/src/middlewares/auth.ts` (adicionar `criarMiddlewareExigirPapel`)
- Alterar `backend/src/app.ts` (instanciar repo/service e montar o router)

## Cenários de teste a cobrir (TDD — escrever teste primeiro)

Mínimos exigidos pela tarefa, mais erros propagados no estilo dos vizinhos:

1. `GET /api/templates/atual` → 200 e o template ativo; `templateService.buscarAtivo`
   chamado com contexto `{ tenantId: 'tenant-1', usuarioId: 'user-1' }`.
2. `GET /api/templates/atual` → 404 quando o service lança `AppError(404)`.
3. `GET /api/templates/atual` → 401 sem cookie `session`.
4. `PUT /api/templates/atual` (usuário **admin**) com body válido → 200 (ou 201, ver
   item 2 do plano) e nova versão; `templateService.salvar` chamado com contexto +
   `layoutJson`.
5. `PUT /api/templates/atual` (usuário **operador**) → 403; `templateService.salvar`
   NÃO é chamado (middleware de papel barra antes).
6. `PUT /api/templates/atual` com body inválido → 400; `salvar` não chamado.
7. `PUT /api/templates/atual` → 401 sem cookie `session`.

## Passos de implementação (ordenados por dependência)

- [ ] 1. Criar o schema Zod do template em `backend/src/schemas/template.schema.ts`.
      Exporta `atualizarTemplateSchema` validando a forma do body do PUT. Como o layout
      é um JSON genérico (`LayoutTemplate = Record<string, unknown>` no repositório),
      o schema valida `{ layoutJson: z.record(z.unknown()) }` (objeto obrigatório,
      não-array) e exporta `type AtualizarTemplatePayload = z.infer<typeof atualizarTemplateSchema>`.
      Rationale: valida só a forma (objeto presente), coerente com os schemas vizinhos
      que deixam regra de negócio no service; o shape detalhado do layout é definido
      pelo editor (tarefa 49) e não deve ser enrijecido aqui.
      Files: `backend/src/schemas/template.schema.ts`
      Verify: `npm run build` (de `backend/`) compila sem erro de tipo no novo arquivo.

- [ ] 2. Adicionar o middleware de papel `criarMiddlewareExigirPapel(papel: 'admin' | 'operador'): RequestHandler`
      em `backend/src/middlewares/auth.ts`. Retorna um handler que chama
      `next(new AppError(403, 'Acesso negado'))` se `req.usuario.papel !== papel`, senão
      `next()`. Importar `AppError` de `../errors/app-error.js`.
      Rationale: middleware declarativo e reutilizável, mapeado para HTTP 403 pelo
      `errorHandler` existente; evita checagem inline duplicada.
      Files: `backend/src/middlewares/auth.ts`
      Verify: `npm run build` compila; coberto pelos testes de rota do passo 4.

- [ ] 3. Escrever os testes de rota PRIMEIRO em
      `backend/src/routes/__tests__/templates.routes.test.ts`, espelhando
      `clientes.routes.test.ts`: `makeAuthService`, `makeTemplateService`
      (mock de `buscarAtivo`/`salvar`), `makeApp`. Incluir um `usuarioOperadorMock`
      (`papel: 'operador'`) e um helper para um `authService` que devolve esse usuário,
      cobrindo os 7 cenários da seção acima. Decidir o código do PUT: usar **200**
      (consistente com `PUT /clientes/:id` e `PUT /orcamentos/:id`, que retornam 200 em
      atualização) — ajustar os asserts de status para 200.
      Files: `backend/src/routes/__tests__/templates.routes.test.ts`
      Verify: `npx vitest run src/routes/__tests__/templates.routes.test.ts` (de `backend/`)
      — testes FALHAM porque o router ainda não existe (vermelho esperado do TDD).

- [ ] 4. Implementar `backend/src/routes/templates.routes.ts`: factory
      `criarTemplatesRouter(templateService: TemplateService, authService: AuthService): Router`.
      Aplicar `router.use(autenticar)`; helper `construirContexto`; rotas:
      `GET /atual` → `templateService.buscarAtivo(ctx)` com `res.json(...)`;
      `PUT /atual` com `criarMiddlewareExigirPapel('admin')` + `validate(atualizarTemplateSchema)`
      → `templateService.salvar(ctx, body.layoutJson)` com `res.json(...)` (200).
      Importar tipos de `../services/template.service.js` e `../repositories/template.repository.js`
      (`LayoutTemplate`), schema de `../schemas/template.schema.js`, middlewares com
      extensão `.js`. Ordem dos middlewares no PUT: papel antes de validate (barra o
      operador sem nem olhar o body — garante que `salvar` não é chamado).
      Files: `backend/src/routes/templates.routes.ts`
      Verify: `npx vitest run src/routes/__tests__/templates.routes.test.ts` — todos os
      7 cenários passam (verde).

- [ ] 5. Registrar o router em `backend/src/app.ts` seguindo o bloco "Orçamento routes":
      `import { criarTemplatesRouter } from './routes/templates.routes.js'`,
      `import { criarTemplateService } from './services/template.service.js'`,
      `import { criarTemplateRepository } from './repositories/template.repository.js'`;
      no corpo de `criarApp`, após o bloco de orçamento:
      `const templateRepo = criarTemplateRepository({ db })`,
      `const templateService = criarTemplateService({ templateRepo, auditoriaService })`,
      `app.use('/api/templates', criarTemplatesRouter(templateService, authService))`.
      Manter o `app.use(errorHandler)` como último middleware.
      Files: `backend/src/app.ts`
      Verify: `npm run build` (de `backend/`) compila sem erros.

- [ ] 6. Verificação final (DoD): rodar da pasta `backend/`
      `npm run lint`, `npm run build` e `npm test`; todos limpos/verdes.
      Em seguida marcar a tarefa 35 como concluída em
      `.kiro/specs/ni-doc-mvp/tasks.md` (trocar `[~]` por `[x]` apenas no item 35).
      Files: `.kiro/specs/ni-doc-mvp/tasks.md`
      Verify: `npm run lint` sem erros, `npm run build` sem erros, `npm test` com todos
      os testes passando (incluindo os novos de templates).

## Notas / suposições

- Código do PUT: **200** por consistência com os outros `PUT` do projeto. A tarefa diz
  "cria uma nova versão" mas não fixa o status; se o revisor preferir 201, é um ajuste
  de uma linha nos asserts + handler.
- Schema do `layoutJson`: validação permissiva (`z.record(z.unknown())`) deliberada —
  o shape real é responsabilidade do editor (tarefa 49). Não enrijecer aqui.
- `setTenant`/RLS: fora do escopo da tarefa 35 e ainda não aplicado nos demais routers;
  seguir o padrão atual (só `autenticar`).

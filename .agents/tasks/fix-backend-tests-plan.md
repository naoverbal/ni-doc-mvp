# Plano de implementação — corrigir testes quebrados do backend (RLS por request)

## Causa raiz (confirmada lendo o código e rodando `npm test --workspace backend`)

Rodada atual: **77 testes falhando** | 468 passando | 4 skipped (46 arquivos).

A migração para RLS por request (commit `f5b32b9`) quebrou os testes em **dois
padrões** descritos na tarefa — ambos confirmados. Além disso, a rodada local
revelou um **terceiro grupo de 3 arquivos** que falha por um motivo distinto e
externo ao escopo (ambiente), documentado abaixo para não ser confundido com os
padrões a corrigir.

### Padrão 1 — repositórios de bootstrap (`getExecutor is not a function`) — confirmado

Os métodos abaixo passaram a usar `sql`...`.execute(db)` (template raw do Kysely,
chamando funções `SECURITY DEFINER`), mas os testes continuam mockando `db` como
objeto literal (`{ insertInto|selectFrom|deleteFrom|updateTable: vi.fn() }`).
`sql.execute(db)` chama internamente `db.getExecutor()`; o literal não tem esse
método → `TypeError: executorProvider.getExecutor is not a function`.

- `src/repositories/usuario.repository.ts`
  - `buscarPorEmail` → `sql`SELECT * FROM rls_usuario_por_email_hash(${emailHash})`.execute(db)`
  - `buscarPorId` → `sql`SELECT * FROM rls_usuario_por_id(${id})`.execute(db)`
  - `criar` → **ainda** usa o builder fluente `db.insertInto('usuarios')...` (NÃO mexer no mock fluente dele)
- `src/repositories/sessao.repository.ts`
  - `criar` → `rls_criar_sessao(...)`; `buscarPorId` → `rls_sessao_por_id`;
    `invalidar` → `rls_invalidar_sessao`; `atualizarAtividade` → `rls_tocar_sessao` — todos via `sql`...`.execute(db)`.
- `src/repositories/orcamento-versao.repository.ts`
  - `buscarPorToken` e `buscarSnapshotPorToken` → `sql`...FROM rls_versao_por_token(${token})`.execute(db)` (≈ linhas 308 e 320).
  - `buscarVersaoAtualPorOrcamento` → **ainda** usa o builder fluente (`db.selectFrom('orcamento_versoes as v')...`) — manter o mock fluente atual.

Testes afetados (apenas estes três arquivos):
`src/repositories/__tests__/usuario.repository.test.ts`,
`.../sessao.repository.test.ts`, `.../orcamento-versao.repository.test.ts`.

### Padrão 2 — rotas autenticadas retornam 500 — confirmado

Cada router de domínio faz `router.use(autenticar)` seguido de `router.use(setTenant())`.
`setTenant` (`src/middlewares/tenant.ts`, alias de `criarMiddlewareTenant`) chama
`executarComTenant(tenantId, fn)` de `src/config/database.ts`, que faz
`driverInterno.acquireConnection()` + `set_config('app.current_tenant', ...)`
contra o pool `pg` real. Sem Postgres no teste, a conexão falha, `.catch(next)`
propaga o erro e o `errorHandler` responde 500. Por isso só passam os casos
"401 sem cookie" (que nem chegam ao `setTenant`); todos os demais viram 500.

Os testes de rota montam a app com `express()` + mocks de service/authService e
**não** mockam `setTenant`/`executarComTenant` nem fornecem banco (confirmado:
`grep setTenant|config/database|middlewares/tenant` nos 5 arquivos → 0 matches).

Testes afetados (5 arquivos):
`src/routes/__tests__/clientes.routes.test.ts`, `empresas.routes.test.ts`,
`responsaveis.routes.test.ts`, `orcamentos.routes.test.ts`, `templates.routes.test.ts`.
Todos usam o mesmo padrão `makeApp(service, authService)` com `express()` + `errorHandler`.

### Grupo 3 — FORA DO ESCOPO: binding nativo do argon2 ausente (3 arquivos)

`src/lib/__tests__/senha.test.ts`, `src/routes/__tests__/health.test.ts` e
`src/services/__tests__/auth.service.test.ts` falham na COLETA (0 testes) com
`Cannot find module .../node_modules/argon2/lib/binding/napi-v3/argon2.node`.
Esses arquivos importam (direta ou transitivamente) `src/lib/senha.ts`, que faz
`import argon2 from 'argon2'`. O ambiente local roda **Node v26**, mas o projeto
fixa **Node 22** (`.nvmrc`); o prebuild nativo do argon2 para esta ABI não foi
instalado (`node_modules/argon2/prebuilds` e `.../napi-v3` não existem).

Isto é um problema de AMBIENTE, não da mudança de RLS. No CI (Node 22, conforme a
tarefa: lint e build passam, só os testes falham) esses 3 arquivos não falham.
**Não altere esses testes nem `senha.ts`.** A ação correta é alinhar o runtime
local (ver "Pré-requisito de ambiente"). Se, após alinhar o Node, estes 3 ainda
falharem, é um problema de instalação independente — reportar, não "consertar"
mexendo em teste.

> 77 falhas = 74 dos Padrões 1 e 2 (dentro do escopo) + 3 do argon2 (ambiente).
> A tarefa menciona ~82/67; os números exatos divergem um pouco, mas a causa raiz
> dos padrões está confirmada. O que corrigimos aqui são os 74 dos Padrões 1 e 2.

---

## Decisões de design (registradas)

1. **Fake executor Kysely reutilizável para o Padrão 1.** A forma idiomática de
   exercitar `sql`...`.execute(db)` sem Postgres é passar um `Kysely<Database>`
   real cujo *driver* devolva linhas controláveis. O próprio repo já contém esse
   padrão embutido em `orcamento-versao.repository.test.ts` (o objeto `executor`
   com `transformQuery/compileQuery/executeQuery/withPlugins` + `getExecutor()`).
   Vou **extrair e generalizar** esse padrão em um helper compartilhado novo:
   `src/__tests__/kysely-fake.ts`. Preferi um `Kysely` real sobre `PostgresDialect`
   com um *driver fake* (em vez de forjar só `getExecutor`) porque assim o `sql`
   raw é compilado pelo compiler real do Postgres — permitindo asserir o SQL e os
   parâmetros compilados — e o helper serve tanto para `sql` raw quanto, se
   preciso, para o builder fluente. Rationale: menos mock frágil, SQL real
   verificável, uma única fonte de verdade entre os 3 testes de repositório.

2. **Neutralizar o efeito de banco do `setTenant` via `vi.mock` nos testes de
   rota (Padrão 2).** Mockar o módulo `../../config/database.js` para que
   `executarComTenant(tenantId, fn)` apenas execute `fn()` (passthrough,
   equivalente ao caminho "escopo já ativo"), sem tocar no pool `pg`. Preferido
   sobre mockar `../../middlewares/tenant.js` porque mantém o `tenant.ts` real no
   caminho de teste (ainda exercita `criarMiddlewareTenant` e a leitura de
   `req.usuario.tenantId`), isolando apenas a dependência de I/O (o banco). NÃO
   altera o comportamento de produção de `tenant.ts`/`database.ts`.

3. **Helper compartilhado para o `vi.mock` das rotas.** Os 5 arquivos repetiriam
   o mesmo `vi.mock('../../config/database.js', ...)`. `vi.mock` é içado (hoisted)
   e precisa de um *factory* estático por arquivo, então não dá para esconder a
   CHAMADA `vi.mock` dentro de uma função importada de forma transparente. Vou
   criar um helper mínimo `src/__tests__/mock-tenant.ts` que exporta o factory
   (ex.: `fakeDatabaseModule()`), e cada teste chama
   `vi.mock('../../config/database.js', () => fakeDatabaseModule())` — uma linha
   por arquivo. Isso centraliza a lógica do stub sem lutar contra o hoisting e
   sem abstração desnecessária.

---

## Pré-requisito de ambiente (antes de confiar na verificação local)

- [ ] 0. Alinhar o runtime ao Node 22 do projeto e garantir o binding nativo do argon2.
      Rode `nvm use` (lê `.nvmrc` = 22) na raiz; se o binding ainda faltar, rode
      `npm rebuild argon2 --workspace backend` (ou reinstale as deps com o Node 22 ativo).
      Files: nenhum (ação de ambiente).
      Verify: `node -v` → v22.x; `node -e "require('argon2')"` sem erro a partir de `backend/`.
      Nota: se o ambiente de execução não permitir trocar o Node, os 3 arquivos do
      Grupo 3 permanecerão falhando por ambiente — isso NÃO invalida a correção dos
      Padrões 1 e 2. Nesse caso, verifique os padrões rodando apenas os arquivos
      afetados (ver passos 5 e 7) e documente a limitação de ambiente no relatório.

---

## Itens de implementação (ordenados por dependência)

- [ ] 1. Criar o helper de fake executor Kysely em `src/__tests__/kysely-fake.ts`.
      Exporta `criarKyselyFake(opts)` que retorna um `{ db: Kysely<Database>, sqlExecutado: Array<{ sql: string; parameters: readonly unknown[] }> }`.
      Internamente instancia um `Kysely<Database>` com `dialect` baseado em `PostgresDialect`
      cujo `createDriver` devolve um driver fake: `acquireConnection` retorna uma conexão
      cujo `executeQuery(compiled)` registra `{ sql, parameters }` em `sqlExecutado` e resolve
      `{ rows }` conforme `opts` — aceitar tanto `rows` fixo quanto uma função
      `(compiled, chamadaIndex) => { rows }` para cenários multi-query (ex.: a transação
      do `orcamento-versao`). Mantém `createAdapter/createIntrospector/createQueryCompiler`
      reais do `PostgresDialect` para compilar o SQL de verdade (permite asserir SQL/params).
      Deve suportar também `transaction().execute(cb)` roteando o `trx` para o mesmo executor,
      para substituir o `makeTrx` artesanal do teste de versão.
      Siga o estilo do projeto (ESM, imports relativos com `.js`, Prettier: aspas simples,
      sem ponto e vírgula, 2 espaços, print width 100, trailing commas `all`).
      Files: backend/src/__tests__/kysely-fake.ts
      Verify: `cd backend && npx tsc --noEmit` compila sem erro (o helper é só tipos+runtime, ainda sem consumidores).

- [ ] 2. Reescrever `sessao.repository.test.ts` para usar o fake executor nos 4 métodos.
      Substituir os mocks literais (`insertInto/selectFrom/deleteFrom/updateTable`) por
      `criarKyselyFake(...)`. Preservar os MESMOS cenários e asserções de comportamento:
      `criar` retorna `{ id, expiraEm }` a partir da row de `rls_criar_sessao`;
      `buscarPorId` mapeia snake_case→camelCase e retorna `null` quando `rows` vazio;
      `invalidar`/`atualizarAtividade` resolvem sem erro. Onde o teste antes asseria o
      nome da tabela/`where`, trocar por asserção sobre o SQL compilado e os parâmetros
      capturados em `sqlExecutado` (ex.: SQL contém `rls_sessao_por_id` e `parameters[0] === id`).
      Files: backend/src/repositories/__tests__/sessao.repository.test.ts
      Verify: `cd backend && npx vitest run src/repositories/__tests__/sessao.repository.test.ts` — todos passam.

- [ ] 3. Reescrever a parte de `sql` raw de `usuario.repository.test.ts`.
      `buscarPorEmail` e `buscarPorId` passam a usar `criarKyselyFake(...)`; manter
      asserções: `null` quando não existe, mapeamento com `email` descriptografado,
      `senhaHash` presente em `buscarPorEmail`, e `hashDocumento` chamado com o email
      normalizado (lowercase) — esta última continua valendo via spy em `crypto`.
      **Manter o mock fluente atual de `criar()`** (ele ainda usa `db.insertInto`), sem alterá-lo.
      Files: backend/src/repositories/__tests__/usuario.repository.test.ts
      Verify: `cd backend && npx vitest run src/repositories/__tests__/usuario.repository.test.ts` — todos passam.

- [ ] 4. Atualizar `orcamento-versao.repository.test.ts`: `buscarPorToken`/`buscarSnapshotPorToken` via fake executor.
      Trocar o mock literal (`selectFrom`→`makeSelectJoinBuilder`) desses dois métodos por
      `criarKyselyFake(...)` devolvendo a row de `rls_versao_por_token` (e `null`/vazio no
      caso "token não existe"). Preservar o `toEqual(...)` do objeto mapeado (camelCase) e a
      asserção de `null`. Refatorar o `executor`/`makeTrx` artesanal já existente para reusar
      o helper do passo 1 quando couber (reduz duplicação); se a refatoração da transação for
      arriscada, manter o `makeTrx` local e aplicar o helper apenas nos dois lookups por token.
      **Não alterar** os testes de `buscarVersaoAtualPorOrcamento` (ainda fluente).
      Files: backend/src/repositories/__tests__/orcamento-versao.repository.test.ts
      Verify: `cd backend && npx vitest run src/repositories/__tests__/orcamento-versao.repository.test.ts` — todos passam.

- [ ] 5. (Checkpoint Padrão 1) Rodar os 3 testes de repositório juntos.
      Files: nenhum.
      Verify: `cd backend && npx vitest run src/repositories/__tests__/sessao.repository.test.ts src/repositories/__tests__/usuario.repository.test.ts src/repositories/__tests__/orcamento-versao.repository.test.ts` — 0 falhas (fecha os ~15 do Padrão 1).

- [ ] 6. Criar o helper de mock do tenant em `src/__tests__/mock-tenant.ts`.
      Exporta `fakeDatabaseModule()` que retorna um objeto compatível com o shape de
      `../../config/database.js` usado em produção pelas rotas: no mínimo
      `executarComTenant: async (_, fn) => fn()` (passthrough) e um `db` stub inócuo
      (`{}` tipado) para satisfazer qualquer import. Documentar que serve só para o
      `vi.mock` dos testes de rota (não toca no pool `pg`).
      Siga o estilo do projeto (ESM, `.js` nos imports, Prettier).
      Files: backend/src/__tests__/mock-tenant.ts
      Verify: `cd backend && npx tsc --noEmit` compila sem erro.

- [ ] 7. Aplicar o `vi.mock` do database nos 5 testes de rota (mesmo padrão em cada arquivo).
      No topo de cada arquivo (após os imports, antes dos `describe`), adicionar:
      `vi.mock('../../config/database.js', () => fakeDatabaseModule())` importando
      `fakeDatabaseModule` de `../../__tests__/mock-tenant.js`. Lembrar que `vi.mock` é
      hoisted — o factory precisa ser estático (chamar a função importada é suportado,
      pois a resolução ocorre no load). NÃO alterar o `makeApp`, os services mock, nem as
      asserções de que o service é chamado com `{ tenantId: 'tenant-1', usuarioId: 'user-1' }`.
      Arquivos (mesma mudança em todos):
      - backend/src/routes/__tests__/clientes.routes.test.ts
      - backend/src/routes/__tests__/empresas.routes.test.ts
      - backend/src/routes/__tests__/responsaveis.routes.test.ts
      - backend/src/routes/__tests__/orcamentos.routes.test.ts
      - backend/src/routes/__tests__/templates.routes.test.ts
      Verify: `cd backend && npx vitest run src/routes/__tests__/clientes.routes.test.ts src/routes/__tests__/empresas.routes.test.ts src/routes/__tests__/responsaveis.routes.test.ts src/routes/__tests__/orcamentos.routes.test.ts src/routes/__tests__/templates.routes.test.ts` — 0 falhas (fecha os ~59 do Padrão 2); os casos "401 sem cookie" seguem passando.

- [ ] 8. Verificação final completa a partir da raiz.
      Files: nenhum.
      Verify (nesta ordem, todos limpos):
        1. `npm run lint` (raiz) — 0 erros/avisos (inclui eslint-plugin-jsx-a11y no frontend, se presente).
        2. `npm run build` (raiz) — tsc do backend e `tsc && vite build` do frontend sem erro.
        3. `npm test` (raiz) — backend: **0 testes falhando**; `rls.integration.test.ts`
           pode permanecer **skipped** (esperado sem Postgres). Se o ambiente estiver em
           Node 22 com argon2 ok (passo 0), os 3 arquivos do Grupo 3 também passam; se o
           ambiente não permitir Node 22, confirmar que as ÚNICAS falhas restantes são as 3
           do argon2 (ambiente) e documentar — nenhuma falha dos Padrões 1/2 deve restar.

---

## Critério de conclusão (Definition of Done)

- `npm run lint`, `npm run build` e `npm test` limpos a partir de `/Users/nilson/Dev/ni-doc`.
- 0 testes dos Padrões 1 e 2 falhando (3 repositórios + 5 rotas corrigidos).
- `rls.integration.test.ts` pode permanecer skipped (sem Postgres) — não mexer nele.
- Nenhuma alteração em lógica de produção (`repositories`, `middlewares`, `services`,
  `config`): a mudança fica contida em arquivos de teste + 2 helpers novos em `src/__tests__/`.
- Grupo 3 (argon2): resolvido por ambiente (Node 22 + binding), não por mudança de teste.

## Observação sobre o commit automático (convenção do projeto)

Ao concluir e verificar, o commit deve ser atômico e no padrão Conventional Commits,
ex.: `test: corrige testes de repositório e rota após RLS por request`. Fazer stage
apenas dos arquivos tocados (os 3 testes de repositório, os 5 testes de rota e os 2
helpers), nunca `git add -A`. Sem push.

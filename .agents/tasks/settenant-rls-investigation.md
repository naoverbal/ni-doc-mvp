# Investigação: setTenant middleware e RLS do PostgreSQL (SOMENTE leitura)

## Resumo da resposta

O middleware `setTenant` (`backend/src/middlewares/tenant.ts`) **existe mas nunca é
usado em runtime**: não é importado em `app.ts` nem registrado em nenhum router de
domínio. As únicas referências a ele estão no próprio arquivo e no teste unitário
`backend/src/middlewares/__tests__/auth.test.ts`.

Como consequência, o GUC `app.current_tenant` **nunca é setado durante um request
real**. As policies de RLS da migration `002_rls_policies.sql` usam
`current_setting('app.current_tenant', TRUE)::uuid`. O segundo parâmetro `TRUE`
(`missing_ok`) faz `current_setting` retornar `NULL` em vez de dar erro quando o GUC
não existe — então a comparação `tenant_id = NULL::uuid` resulta em `NULL` (não
verdadeiro), e **a policy barraria TODAS as linhas**. Isso só não quebra a aplicação
hoje porque o backend conecta como um papel que **ignora RLS** (owner da tabela ou
`BYPASSRLS` / superusuário, o padrão de desenvolvimento — confirmado pelo uso de
`SET LOCAL row_security = off` no seed). Ou seja: **o RLS está efetivamente inativo em
runtime**, e o isolamento entre tenants depende **exclusivamente** do filtro
aplicacional `WHERE tenant_id = ...` escrito manualmente em cada query dos
repositórios.

Isso é uma divergência direta da steering do projeto (`.kiro/steering/structure.md`):
"Multi-tenancy via Postgres RLS … Never bypass this." Na prática o RLS está sendo
contornado por padrão.

## Evidências

### 1. `setTenant` não é usado em lugar nenhum do fluxo de request

- Definição e alias em `backend/src/middlewares/tenant.ts`:
  - `criarMiddlewareTenant(db)` executa
    `sql\`SELECT set_config('app.current_tenant', ${tenantId}, true)\``.
  - `export const setTenant = criarMiddlewareTenant` (apenas alias semântico).
- Grep por `setTenant|criarMiddlewareTenant|current_tenant|SET LOCAL|set_config`
  em `backend/**/*.ts` retorna somente:
  - o próprio `tenant.ts`;
  - o teste `backend/src/middlewares/__tests__/auth.test.ts` (testa o middleware
    isoladamente, com `db.executeQuery` mockado — Pool nunca conecta);
  - `backend/src/db/seed.ts` (usa `SET LOCAL row_security = off`, não o GUC de tenant);
  - artefatos compilados em `dist/`.
- `backend/src/app.ts` importa `criarMiddlewareAuth`, serviços e repositórios, mas
  **não importa** `tenant.ts`. Nenhum `app.use(setTenant)` global.
- Todos os routers de domínio registram só autenticação (grep em
  `backend/src/routes/*.routes.ts`):
  - `clientes.routes.ts:27` → `router.use(autenticar)`
  - `empresas.routes.ts:31` → `router.use(autenticar)`
  - `responsaveis.routes.ts:27` → `router.use(autenticar)`
  - `orcamentos.routes.ts:41` → `router.use(autenticar)`
  - Nenhum deles cria ou registra o middleware de tenant.

### 2. RLS depende de `app.current_tenant`, que nunca é setado em runtime

- `backend/src/db/migrations/002_rls_policies.sql`: todas as policies usam
  `current_setting('app.current_tenant', TRUE)::uuid`, com `ENABLE`+`FORCE ROW LEVEL
  SECURITY` em todas as tabelas tenant-scoped (usuarios, clientes, empresas,
  responsaveis_tecnicos, orcamentos, templates, eventos_auditoria, e tabelas-filhas
  via `EXISTS`).
- Como `setTenant` nunca roda, o GUC não existe no backend. Com `missing_ok = TRUE`,
  `current_setting` retorna `NULL`; a condição da policy vira `tenant_id = NULL` →
  `NULL` → linha **negada**. Portanto, se o papel do banco respeitasse RLS, nenhuma
  query de domínio retornaria linhas.
- Que a app funciona hoje indica que o papel usado em `DATABASE_URL` **não respeita
  RLS** (owner/superuser/BYPASSRLS). `FORCE ROW LEVEL SECURITY` força RLS inclusive
  para o owner, mas **não** para superusuário nem para papéis com `BYPASSRLS` — e o
  seed assume justamente esse cenário privilegiado (`SET LOCAL row_security = off`
  "requer superusuário/BYPASSRLS, o caso padrão em desenvolvimento",
  `backend/src/db/seed.ts`). Conclusão: RLS está inativo na prática.

### 3. Conexão Kysely/pg: `SET LOCAL`/`set_config(..., true)` não teria efeito mesmo se chamado

- `backend/src/config/database.ts`: um único `Pool` (`max: 10`) por trás de um
  `Kysely` com `PostgresDialect`. Não há wrapper que fixe uma conexão por request.
- `set_config('app.current_tenant', ..., true)` e `SET LOCAL` são **transaction-local**:
  só valem dentro da mesma transação. Fora de transação, cada `.execute()` do Kysely
  pega uma conexão arbitrária do pool, roda o statement e a devolve — o setting não
  sobrevive à próxima query.
- Mesmo que `setTenant` fosse registrado como middleware, ele chama
  `db.executeQuery(...)` **sem transação**. Esse `set_config(..., true)` seria
  descartado imediatamente (fim do statement implícito) e **não** estaria ativo quando
  o repositório rodasse a query seguinte, possivelmente em outra conexão do pool.
- Padrão de queries dos repositórios (confirmado em
  `backend/src/repositories/cliente.repository.ts` e
  `backend/src/repositories/orcamento.repository.ts`):
  - **Leituras** (`buscarPorId`, `buscarPorNome`, `buscarPorDocumentoHash`) e
    `desativar`/`atualizar` do cliente rodam direto em `db` (conexão avulsa do pool,
    sem transação).
  - **Escritas de orçamento** (`criar`, `atualizar`) usam `db.transaction().execute(...)`,
    mas **nenhuma** executa `set_config` dentro da transação. Logo, mesmo nessas
    transações o GUC não é propagado.

### 4. Risco de segurança atual

- O isolamento entre tenants depende **somente** do filtro aplicacional. Todas as
  queries de domínio incluem `.where('tenant_id', '=', tenantId)` explicitamente
  (verificado em `cliente.repository.ts`: `buscarPorId`, `buscarPorNome`,
  `buscarPorDocumentoHash`, `atualizar`, `desativar`; e em `orcamento.repository.ts`:
  `buscarPorId`, `atualizar`). O `tenantId` vem de `req.usuario.tenantId`, montado em
  `construirContexto` nos routers a partir da sessão autenticada.
- O RLS **não** é uma segunda camada de defesa ativa hoje — é "defense in depth" apenas
  no papel. Qualquer query futura que esqueça o `WHERE tenant_id = ...` vazaria dados
  entre tenants sem nenhuma rede de proteção do banco.
- Pontos de atenção concretos onde o filtro aplicacional é a única barreira:
  - `cliente.repository.ts#criar` não valida `tenant_id` contra RLS — confia no input
    do service.
  - Em `orcamento.repository.ts`, as tabelas-filhas (`orcamento_itens`,
    `orcamento_versoes`, `orcamento_aceites`) são acessadas por `orcamento_id` dentro de
    transação; o isolamento delas depende do join/escopo pelo orçamento-pai no código,
    não de RLS. Ex.: `buscarItens(id)` e `deleteFrom('orcamento_itens').where('orcamento_id','=',id)`
    filtram só por `orcamento_id`, sem `tenant_id` — seguro apenas porque o `id` do
    orçamento já foi resolvido via query com `tenant_id`.
- Não há testes de integração com Postgres real exercitando RLS (busca por
  "integration" só acha arquivo em `node_modules`). O comentário no próprio
  `tenant.ts` admite que a verificação ponta-a-ponta "fica para os testes de
  integração" — que não existem. Portanto o comportamento de RLS nunca foi validado
  de verdade.

## Conclusões

1. `setTenant` é código morto em runtime; está testado isoladamente mas nunca
   registrado no pipeline Express.
2. O RLS da migration 002 está habilitado no schema, porém inerte em execução: sem o
   GUC setado e com um papel de banco que ignora RLS, as policies não filtram nada.
3. Mesmo se `setTenant` fosse plugado como está, não funcionaria: `set_config(..., true)`
   fora de transação (e as leituras usam conexão avulsa do pool) não persiste até as
   queries dos repositórios.
4. O isolamento real entre tenants hoje é 100% aplicacional (`WHERE tenant_id`), o que
   contraria a steering ("Never bypass this") e remove a camada de defesa do banco.

## Recomendações (não implementadas)

Para ativar o RLS por request de forma consistente seria necessário:

1. **Executar com um papel que respeite RLS.** O backend deve conectar com um papel
   **sem** `BYPASSRLS` e que **não** seja owner das tabelas (ou manter o owner, já que
   as policies usam `FORCE ROW LEVEL SECURITY`, mas garantir que não é superusuário).
   Caso contrário qualquer policy é ignorada. O papel privilegiado deve ficar restrito
   a migrations/seed.

2. **Fixar uma conexão por request e setar o GUC nela.** O padrão transaction-local
   (`SET LOCAL`/`set_config(..., true)`) só funciona se **todas** as queries do request
   rodarem na mesma transação/conexão. Opções:
   - Abrir uma transação por request (ex.: middleware que faz
     `db.transaction().execute(...)` envolvendo o handler, ou via
     `db.connection()`/`withConnection`), rodar `set_config('app.current_tenant', tenant, true)`
     e passar essa `Transaction`/conexão adiante para os repositórios.
   - Isso exige mudar a injeção de dependências: hoje os repositórios recebem o `db`
     global (pool) em `app.ts`; passariam a receber a conexão/transação por request
     (ex.: via `AsyncLocalStorage` ou repassando `trx` pelo contexto do service).

3. **Onde registrar `setTenant`.** Depois de resolver a transação-por-request, registrar
   o middleware de tenant **logo após** `autenticar` em cada router de domínio (ou um
   `app.use` global protegido por auth), pois depende de `req.usuario.tenantId`.

4. **Impacto nos repositórios.** Com RLS ativo, os `WHERE tenant_id = ...` passam a ser
   redundância defensiva (recomenda-se mantê-los como defense-in-depth). As queries em
   tabelas-filhas por `orcamento_id` passariam a ser protegidas pelas policies via
   `EXISTS`. As escritas de orçamento já usam transação — bastaria setar o GUC no início
   dessa transação (ou herdar a conexão do request).

5. **Testes de integração.** Criar testes com Postgres real (ex.: Testcontainers ou o
   serviço do docker-compose) conectando com um papel não-privilegiado, provando que:
   (a) com o GUC setado só o tenant corrente enxerga suas linhas; (b) sem o GUC, nenhuma
   linha retorna; (c) tentativas cross-tenant falham no banco mesmo se o filtro
   aplicacional for omitido. Hoje não existe nenhum teste assim.

6. **Decisão arquitetural a registrar.** Se a equipe optar por manter o isolamento
   apenas aplicacional no MVP, a steering deveria ser atualizada para refletir isso e o
   middleware/migration de RLS marcados como "não ativos" — para não dar falsa sensação
   de proteção. A recomendação, porém, é ativar o RLS conforme a steering vigente.

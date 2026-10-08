# Rotas REST de orçamentos sob `/api/orcamentos`

A Tarefa 30 adiciona o router HTTP de orçamentos: cinco endpoints (POST, GET lista, GET/:id, PUT/:id, DELETE/:id) com validação Zod de forma, delegação ao `OrcamentoService` já existente e registro em `app.ts`. O router é uma factory `criarOrcamentosRouter(orcamentoService, authService)` que aplica `autenticar` globalmente e repassa `tenantId`/`usuarioId` ao service via um contexto montado a partir de `req.usuario`. A regra de negócio de 409 (editar/excluir só em rascunho) permanece no service e é apenas propagada pela rota. O diff corresponde exatamente aos cinco arquivos de aceitação e a evidência de lint/build/test está presente e completa.

Watch for: o router registra apenas `autenticar`, sem `setTenant` — mas isso espelha fielmente os routers vizinhos (clientes/empresas/responsaveis), que também não aplicam `setTenant`; a propagação de tenant acontece via `tenantId` no contexto, não via RLS. É um padrão pré-existente, fora do escopo desta tarefa (possible, informativo).

**Verdict**: APPROVED

## High-level view

A abordagem segue o padrão de camadas já estabelecido no projeto: a rota valida forma (Zod) e monta o contexto de tenant/usuário, o service aplica regra de negócio e auditoria, o repositório detém o SQL. O router de orçamentos é indistinguível em estrutura dos routers irmãos, o que satisfaz o requisito de "espelhar clientes/empresas/responsaveis".

A superfície da API cobre os cinco verbos exigidos. A listagem aceita `status` (validado contra o enum na rota, com `AppError(400)`), `pagina` e `tamanhoPagina` (parseados e validados como inteiros positivos). O 409 de não-rascunho não é duplicado na rota: a rota só repassa o erro lançado pelo service. Multi-tenancy é respeitada porque todas as chamadas ao repositório recebem `ctx.tenantId` e o repositório filtra por `tenant_id` em toda query.

A cobertura de teste é a camada de rota com service e auth mockados (supertest), e exercita os oito itens do DoD mais caminhos de erro (404, 400 do service, status fora do enum). O que não é exercitado aqui é a integração real com Postgres/RLS — coerente com o escopo de teste de rota, mas significa que a propagação de tenant ponta-a-ponta não é verificada por estes testes.

O requisito literal menciona `setTenant`, que existe como middleware (`middlewares/tenant.ts`) mas não é usado por nenhum router no código-base atual. Mirrorar os irmãos (sem `setTenant`) é a interpretação correta do critério "espelhando clientes/empresas/responsaveis"; aplicar `setTenant` só aqui divergiria do padrão e não teria efeito sem os testes de integração com Postgres.

<details>
<summary>Issues (2)</summary>

1. **`setTenant` ausente (pré-existente, não bloqueante)** — o requisito cita `autenticar + setTenant`, mas nenhum router no projeto usa `setTenant`; a tenancy é propagada via `tenantId` no contexto. O router de orçamentos espelha os irmãos corretamente. Nenhuma ação nesta tarefa; se a equipe quiser ativar RLS por request, é uma mudança transversal a todos os routers, com testes de integração, em tarefa separada.
2. **`STATUS_ORCAMENTO` duplicado na rota (não-bloqueante)** — a lista de status na rota duplica literalmente a união `OrcamentoStatus` do repositório; um status novo no domínio precisa ser replicado à mão ou o filtro rejeitará valor válido. Considerar derivar de uma fonte única.

</details>

<details>
<summary>Details</summary>

### Origem do 409

A regra "só edita/exclui em rascunho" está no service (`atualizar`/`deletar` buscam o existente e lançam `AppError(409, ...)` se `status !== 'rascunho'`). A rota não reimplementa nem antecipa essa checagem — apenas propaga via `next(err)`. O repositório `deletar` também re-valida o status e lança 409 (defesa em profundidade na camada de dados, pré-existente da tarefa 28); isso não é duplicação na rota, que é o ponto exigido pelo critério.

### Parsing e validação dos query params da listagem

`GET /` trata três query params fora do Zod, direto na rota:

```
status         → precisa estar em STATUS_ORCAMENTO, senão AppError(400, 'status inválido')
pagina         → Number.isInteger && >= 1, senão AppError(400, 'pagina inválida')
tamanhoPagina  → Number.isInteger && >= 1, senão AppError(400, 'tamanhoPagina inválido')
```

A constante `STATUS_ORCAMENTO` local duplica a união `OrcamentoStatus` do repositório: um status novo no domínio precisa ser replicado à mão aqui ou o filtro rejeitará um valor válido. `tamanhoPagina` não tem teto imposto na rota (um cliente pode pedir `tamanhoPagina=100000`) — fora do DoD, mas é uma superfície de carga que vale conhecer.

### Montagem do contexto e multi-tenancy

`construirContexto` lê `tenantId`/`usuarioId` de `req.usuario`. Todo método do service repassa `ctx.tenantId` ao repositório, que filtra por `tenant_id` em `buscarPorId`, `listarPorTenant`, `atualizar` e `deletar`. Não há caminho na rota que consulte sem `tenantId`. A isolação depende da correção do `autenticar` e do filtro explícito no repositório — ambos pré-existentes e não alterados aqui, portanto não há sobre eles RLS no banco que capture um `tenantId` ausente, apenas o filtro aplicacional.

### Cobertura de teste

Os 23 testes cobrem os oito itens do DoD: POST 201 com asserção de que o service recebeu o contexto de tenant e o body; GET lista (sem filtro, por status, com paginação) com asserção dos argumentos repassados; GET/:id com itens; PUT 200; DELETE 204 sem corpo; PUT/DELETE 409 via service; 401 sem cookie em todas as rotas; 400 do Zod (sem título, itens vazio, clienteId ausente) com asserção de que o service não é chamado. Também cobrem propagação de 404 e de 400 vindos do service.

O POST verifica que `criar` recebeu exatamente `bodyValido` — como `validate` substitui `req.body` pela saída parseada do Zod, a asserção só se mantém porque o payload de teste não tem campos extras nem coerção; um payload com chaves extras seria stripado e a igualdade estrita falharia. Não é defeito, mas é uma asserção sensível ao schema.

Not tested: integração real com Postgres e RLS (propagação de tenant ponta-a-ponta); teto de `tamanhoPagina`; o caminho em que `authService.validarSessao` retorna `null` (sessão expirada → 401) é coberto no teste do próprio middleware, não aqui, o que é adequado.

### Aderência a convenções

Verificado contra os critérios: imports relativos com `.js`, naming em português, factory com injeção de dependências, erros via `AppError`, estilo Prettier (aspas simples, sem ponto e vírgula, indent 2, trailing comma, width 100), e separação forma (Zod) / regra de negócio no schema. Nenhum desvio.

### Evidência

`task30-evidence.md` registra lint (exit 0), build/tsc (exit 0) e vitest (27 arquivos, 300 testes, exit 0, incluindo os 23 testes deste arquivo), mais o mapeamento DoD → teste. Presente e completa; conforme instrução, as suítes não foram reexecutadas.

</details>

<details>
<summary>File map</summary>

- `backend/src/schemas/orcamento.schema.ts` — schemas Zod `criarOrcamentoSchema`/`atualizarOrcamentoSchema` + `itemSchema` (forma apenas).
- `backend/src/routes/orcamentos.routes.ts` — factory `criarOrcamentosRouter`, cinco endpoints, parsing de query params da listagem.
- `backend/src/routes/__tests__/orcamentos.routes.test.ts` — 23 testes de rota (service + auth mockados via supertest).
- `backend/src/app.ts` — registro do router sob `/api/orcamentos` antes do `errorHandler`.
- `.agents/tasks/task30-evidence.md` — evidência de lint/build/test.

Diff completo: `git show 37b461f`.

</details>

# Rotas de template (GET/PUT /api/templates/atual)

Adiciona o router de templates com `GET /api/templates/atual` (versão ativa do tenant) e `PUT /api/templates/atual` (cria nova versão, restrito a admin). O router consome o `TemplateService` já existente (`buscarAtivo`/`salvar`) sem reescrevê-lo, introduz um schema Zod de forma (`atualizarTemplateSchema`) e um middleware reutilizável `criarMiddlewareExigirPapel` em `auth.ts` que devolve 403 via `AppError`. A composição em `app.ts` segue o mesmo padrão factory-DI dos demais domínios. O commit é atômico, segue Conventional Commits e carrega evidência explícita de build/lint/test.

Watch for: nenhuma preocupação bloqueante. A única observação (não bloqueante) é que o novo `criarMiddlewareExigirPapel` cobre apenas o caminho `admin` nos testes de rotas; o ramo `operador` do parâmetro não é exercido, mas é simétrico e sem risco (likely).

**Verdict**: APPROVED

## High-level view

O escopo da tarefa é satisfeito integralmente. `GET /atual` chama `templateService.buscarAtivo(ctx)` e propaga o `AppError(404)` do service quando não há template; `PUT /atual` cria nova versão via `templateService.salvar(ctx, layoutJson)`, com o guard de papel aplicado antes do `validate` para barrar o operador sem inspecionar o body. Autenticação é exigida em todas as rotas via `router.use(autenticar)`.

A autorização por papel foi extraída para um middleware genérico `criarMiddlewareExigirPapel('admin')` em `auth.ts`, que lança `AppError(403, 'Acesso negado')` roteado pelo `errorHandler`. É um acréscimo limpo e reutilizável; depende de `req.usuario`, que é tipado como não-opcional em `express.d.ts`, então o acesso a `req.usuario.papel` é type-safe.

A superfície de API fica em `/api/templates`, registrada em `app.ts` com o mesmo encadeamento factory-repo→service→router dos vizinhos. O schema valida apenas a forma (`layoutJson` como objeto genérico), decisão deliberada e documentada: o shape detalhado é responsabilidade do editor visual (tarefa 49).

A cobertura de testes com supertest/vitest exercita os seis caminhos relevantes (GET 200/404/401, PUT 200-admin/403-operador/400/401), assertando inclusive que `salvar` não é chamado nos ramos 403 e 400. O commit é atômico (5 arquivos, todos desta tarefa), não há push, e `tasks.md` não foi tocado.

<details>
<summary>Issues (1)</summary>

1. **Ramo `operador` do middleware de papel não testado** — `criarMiddlewareExigirPapel` aceita `'admin' | 'operador'`, mas apenas `'admin'` é instanciado e testado. Não bloqueante; se desejar cobertura simétrica, adicionar um teste que exija `operador`. (likely)

</details>

<details>
<summary>Details</summary>

### Escopo da tarefa conferido contra o código

Os quatro requisitos declarados estão implementados e verificáveis no diff (confirmed):

- `GET /atual` retorna o template ativo: a rota chama `templateService.buscarAtivo(ctx)` e responde `res.json(template)`. O teste "retorna 200 e o template ativo do tenant" assere o corpo e que `buscarAtivo` recebeu o contexto com `tenantId`/`usuarioId` corretos.
- `PUT /atual` cria nova versão restrita a admin: a rota encadeia `exigirAdmin, validate(atualizarTemplateSchema)` e chama `templateService.salvar(ctx, dados.layoutJson)`. O teste admin confirma 200 e `versao: 2`.
- Operador recebe 403: `makeAuthService(usuarioOperadorMock)` + `PUT` resulta em 403, e o teste assere `salvar` **não** chamado — ou seja, o guard barra antes de qualquer efeito.
- O `TemplateService` não foi reescrito: `template.service.ts` não aparece no diff; o router apenas consome `buscarAtivo`/`salvar` da interface existente.

### Ordem admin-guard antes de validate

A rota PUT posiciona `exigirAdmin` antes de `validate`. O efeito é que um operador recebe 403 independentemente do corpo enviado, sem que o body seja inspecionado — comportamento desejável (não vaza informação de validação a quem não tem permissão) e documentado em comentário na própria rota. Os testes 403 e 400 cobrem os dois ramos de forma distinta, confirmando a separação.

### Middleware de papel reutilizável

`criarMiddlewareExigirPapel(papel)` lança `AppError(403, 'Acesso negado')` quando `req.usuario.papel` difere do exigido. Fica em `auth.ts` ao lado de `criarMiddlewareAuth`, com comentário indicando a dependência de ordem (`req.usuario` só existe após autenticação). O parâmetro aceita `'admin' | 'operador'`, mas somente `'admin'` é usado em produção e nos testes; o ramo `operador` é simétrico e inócuo, apenas não exercitado. Observação não bloqueante.

### Schema de validação de forma

`atualizarTemplateSchema = z.object({ layoutJson: z.record(z.unknown()) })` valida apenas a presença de `layoutJson` como objeto (não-array). O comentário deixa claro que a validação detalhada do layout pertence ao editor visual (tarefa 49) e não deve ser enrijecida aqui — decisão coerente com `LayoutTemplate = Record<string, unknown>` no repositório. `z.record` rejeita `undefined`/ausência, o que sustenta o teste 400 com body `{}`.

### Evidência de verificação

O corpo do commit registra a verificação executada de `backend/`: `npm run build` (tsc sem erros), `npm run lint` (limpo) e `npm test` (364 testes, 33 arquivos), com os 7 testes de `templates.routes` cobrindo os caminhos citados e métricas de cobertura por arquivo. Conforme instrução, não reexecutei as suítes; a evidência está presente e é específica, dispensando spot-check.

</details>

<details>
<summary>File map</summary>

- `backend/src/routes/templates.routes.ts` — novo router com GET/PUT `/atual`, guard de admin e `construirContexto`.
- `backend/src/schemas/template.schema.ts` — novo schema Zod de forma `atualizarTemplateSchema`.
- `backend/src/middlewares/auth.ts` — adiciona `criarMiddlewareExigirPapel` (403 via AppError).
- `backend/src/app.ts` — monta repo/service/router de template no padrão dos demais domínios.
- `backend/src/routes/__tests__/templates.routes.test.ts` — 7 testes supertest/vitest (GET 200/404/401, PUT 200/403/400/401).

Diff completo: `git show ee5e0af`.

</details>

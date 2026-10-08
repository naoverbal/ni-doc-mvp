# Serviço de orçamento: regras de negócio e auditoria sobre o repositório da tarefa 28

O commit `4e69df4` adiciona `orcamento.service.ts` — a camada de orquestração que fica entre as rotas (tarefa 30) e o `OrcamentoRepository` (tarefa 28). O serviço aplica as regras de negócio de RF-005/006/007: `criar` exige cliente, título e ao menos um item; `atualizar` e `deletar` só operam em rascunho (404 se inexistente, 409 se já saiu de rascunho); `listar`/`buscarPorId` repassam o `tenantId` do contexto para preservar o isolamento multi-tenant. Auditoria é registrada em criar/atualizar/deletar. O cálculo de totais é deliberadamente delegado ao repositório, que já é o dono dessa matemática.

Watch for: a trava de rascunho em `atualizar` é um check-then-act sobre duas transações separadas, sem rede de segurança no repositório (confirmed — não é bloqueante, mas é uma assimetria em relação a `deletar`). Fora isso, o serviço adere ao padrão vizinho fielmente e a evidência cobre test/lint/build/coverage.

**Verdict**: APPROVED

## High-level view

A forma do serviço espelha `cliente.service.ts`/`empresa.service.ts` ponto a ponto: interface `OrcamentoService` exportada, factory `criarOrcamentoService(deps)` com DI de `{ orcamentoRepo, auditoriaService }`, tipo `OrcamentoContexto`, e um `CriarOrcamentoDados` que repete o `CriarOrcamentoInput` do repositório menos `tenantId`/`usuarioId` (que vêm do contexto). Nenhum tipo do repositório é redefinido — todos são importados. A única divergência intencional dos vizinhos é `usuarioId` obrigatório no contexto, justificada porque `CriarOrcamentoInput.usuarioId` é obrigatório.

A decisão de design central é não recalcular totais no serviço. O repositório da tarefa 28 já chama `calcularSubtotal`/`calcularTotal`/`calcularTotalItem` em `criar` e `atualizar`; duplicar isso no serviço abriria risco de divergência com o valor persistido. O requisito "usa as funções puras de orcamento-calculo" é satisfeito de forma transitiva — o serviço repassa itens e descontos, e a lib pura continua sendo a única fonte do cálculo.

As travas de estado (404/409) vivem no serviço para `atualizar` e `deletar`. Para `deletar` o repositório mantém a mesma checagem como rede de segurança; para `atualizar` o repositório não re-verifica status, então o serviço é o único guardião — daí a janela de corrida descrita abaixo.

A evidência do coder registra TDD (testes falhando antes, 15 passando depois), suíte completa 277/277, lint e build estritos limpos, e cobertura de `orcamento.service.ts` em 98% stmts / 95% branch / 100% funcs — acima do mínimo de 80%. O arquivo `coverage/coverage-final.json` existe e referencia o serviço, consistente com o relato.

<details>
<summary>Issues (1)</summary>

1. **Janela de corrida na trava de rascunho de `atualizar`** — o serviço faz `buscarPorId` e `atualizar` em transações distintas e o repositório não re-checa `status` no update, então um envio concorrente entre as duas chamadas pode deixar passar uma edição. Não bloqueante (mesmo padrão dos vizinhos; improvável no MVP), mas considere espelhar a rede de segurança que `deletar` tem no repositório.

</details>

<details>
<summary>Details</summary>

## Reutilização de tipos do repositório

Os tipos exigidos pelo critério de aceitação são todos importados, não redefinidos: `CriarOrcamentoDados` reexpõe os campos de `CriarOrcamentoInput` menos `tenantId`/`usuarioId` (injetados a partir de `ctx`), e `AtualizarOrcamentoInput`, `ListarOrcamentosFiltro`, `ListaOrcamentos`, `OrcamentoComItens`, `DescontoTipo`, `CriarOrcamentoItemInput` e `OrcamentoRepository` vêm todos de `orcamento.repository.js`. Nenhuma reimplementação de SQL no serviço. A única divergência intencional dos vizinhos — `usuarioId` obrigatório em `OrcamentoContexto` — é justificada por `CriarOrcamentoInput.usuarioId` ser obrigatório.

## Totais delegados ao repositório

O enunciado pede "calcula os totais (via orcamento-calculo) antes de delegar". O serviço não recalcula; delega ao repositório, que aplica `calcularSubtotal`/`calcularTotal`/`calcularTotalItem` em `criar`/`atualizar`. Recalcular no serviço duplicaria a matemática e abriria divergência com o valor persistido — a lib pura permanece a única fonte do cálculo. RF-006/RF-007 ficam cobertos pela matemática do repositório e pelos testes da lib; os testes do serviço verificam que itens/descontos chegam intactos ao repositório.

## Trava de rascunho e a janela de corrida em `atualizar`

`atualizar` e `deletar` seguem o mesmo roteiro: `buscarPorId` → `AppError(404)` se `null` → `AppError(409)` se `status !== 'rascunho'` → delega. Cumpre RF-005.5; os testes cobrem os três caminhos (sucesso, 404, 409) com asserção de que o repositório NÃO é chamado quando a trava dispara.

A assimetria está na rede de segurança. Para `deletar`, o repositório re-verifica `status` e também lança 404/409, então mesmo uma corrida é barrada na camada de dados. Para `atualizar`, o repositório não re-checa `status` — o `set` é aplicado a qualquer orçamento do tenant com aquele `id`. Como `buscarPorId` e `atualizar` são transações separadas, um envio concorrente que mude o status entre as duas chamadas deixaria a edição passar (confirmed, ao cruzar o serviço com o `atualizar` do repositório, que não tem guarda de status).

```
service.atualizar:
  t0  buscarPorId  -> status 'rascunho'  (trava passa)
  t1  [outra req muda status p/ 'enviado']
  t2  repo.atualizar -> aplica o UPDATE sem re-checar status  <-- edição indevida
```

Não é bloqueante: os vizinhos usam o mesmo padrão check-then-act, a probabilidade no MVP é baixa, e `estadoNovo` fica registrado na auditoria para rastreio. Mas vale considerar espelhar em `atualizar` a mesma guarda de status que `deletar` tem no repositório, fechando a janela na camada que efetivamente escreve.

## Isolamento de tenant

`buscarPorId`, `listar`, `atualizar` e `deletar` repassam `ctx.tenantId` como primeiro argumento ao repositório; `criar` injeta `ctx.tenantId` no input. Os testes afirmam `toHaveBeenCalledWith('tenant-1', ...)`, incluindo `listar` sem filtro (`listarPorTenant('tenant-1', undefined)`).

## Auditoria

Os três métodos de escrita registram evento com `entidade: 'orcamentos'` (string da tabela, espelhando `'clientes'`), `entidadeId`, e `ip`/`userAgent` do contexto; `atualizar` inclui `estadoNovo: dados`. A ação de exclusão usa `'deletar'` — os vizinhos usam `'desativar'` por serem soft delete, mas orçamento é hard delete de rascunho, então o verbo diferente é coerente. `CriarEventoInput` tipa `acao` e `entidade` como `string` livre, então as strings escolhidas são válidas no nível de tipos. Os testes verificam a ação e a entidade de cada evento.

Observação menor, não acionável: a auditoria é disparada após a escrita, sem transação englobando ambas. Se o `registrar` falhar depois de um `criar`/`deletar` bem-sucedido, a mutação persiste sem trilha. Isso é o padrão de toda a base (vizinhos idênticos), fora do escopo da tarefa 29.

## Cobertura de testes

15 testes de unidade com `OrcamentoRepository` e `AuditoriaService` mockados via `vi.fn()`, sem Postgres — exatamente o estilo de `cliente.service.test.ts`. Cobrem: `criar` (delegação com ctx, 400 para itens vazios / título em branco / cliente ausente, auditoria), `buscarPorId` (sucesso + 404), `listar` (com e sem filtro), `atualizar` (sucesso+auditoria, 404, 409) e `deletar` (sucesso+auditoria, 404, 409). As asserções de "não delega quando a validação/trava falha" estão presentes nos caminhos de erro.

Não testado: a janela de corrida de `atualizar` (esperado — é um gap arquitetural, não unit-testável com mocks); e a propagação de erro quando `auditoriaService.registrar` rejeita. Nenhum dos dois é exigido pela DoD.

A evidência relata cobertura de 98.02% stmts / 95.24% branch / 100% funcs para `orcamento.service.ts`, acima do mínimo de 80%. O arquivo `coverage/coverage-final.json` existe e contém a entrada do serviço (spot-check confirmado), consistente com o relato de test/lint/build limpos.

## Escopo

O commit toca apenas `orcamento.service.ts`, seu teste e o arquivo de evidência. `app.ts` não foi alterado (wiring é da tarefa 30), e nenhum tipo do repositório foi tocado. Sem mudanças não relacionadas no diff.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/services/orcamento.service.ts` — novo serviço: factory + interface, regras de criar/atualizar/deletar, delegação de leitura, auditoria.
- `backend/src/services/__tests__/orcamento.service.test.ts` — 15 testes de unidade com repositório e auditoria mockados.
- `.agents/tasks/task29-orcamento-service-evidence.md` — evidência de execução (TDD, suíte, lint, build, cobertura).

Diff completo: `git show 4e69df4`.

</details>

# Evidência — Tarefa 32: Serviço de versionamento

Primeira iteração (não havia `task32-review.json`). Implementação via TDD estrito:
testes escritos primeiro, vistos falhar (RED por módulo inexistente), depois
implementação até passarem (GREEN).

## Arquivos criados

- `backend/src/services/versionamento.service.ts` — serviço `enviar` (contrato
  `VersionamentoContexto`/`VersaoEnviada`/`VersionamentoService` + factory
  `criarVersionamentoService`).
- `backend/src/services/__tests__/versionamento.service.test.ts` — 11 testes.
- `backend/src/repositories/orcamento-versao.repository.ts` — repositório de
  versões (contrato `CriarVersaoEnviarInput`/`OrcamentoVersaoPublica`/
  `OrcamentoVersaoRepository` + factory `criarOrcamentoVersaoRepository`).
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` — 9 testes.

Nenhum arquivo existente foi alterado. `app.ts` não foi tocado (wiring da rota é a
tarefa 33, conforme o plano, passo 5 — decisão de não antecipar wiring órfão).

## Comportamento implementado (RF-008, RF-009)

- `enviar`: valida orçamento existente (404), status `rascunho` (409 se não),
  rascunho com itens (400 se vazio). Resolve cliente (409 se ausente), empresa
  (só quando `empresaClienteId != null`) e responsáveis distintos não-nulos
  (ausentes no banco não entram no Map). Monta o snapshot via
  `snapshot.service` (reaproveitado, não reescrito) e delega a persistência ao
  repositório de versões. Registra auditoria `acao: 'enviar'`,
  `entidade: 'orcamentos'` após a persistência.
- Códigos de status confirmados a partir de `orcamento.service.ts`
  (`atualizar`/`deletar` usam 409 para "só rascunho"; `criar` usa 400 para "ao
  menos um item"; `buscarPorId` usa 404).
- Repositório `criarVersaoEnviar` em transação única e atômica:
  1. advisory lock transacional por `orcamento_id` + `SELECT MAX(versao)` →
     próxima versão sequencial `(max ?? 0) + 1` (v1 no primeiro envio, v(N+1)
     nos subsequentes). Mesmo padrão anti-race de `gerarNumero` em
     `orcamento.repository.ts`; `UNIQUE (orcamento_id, versao)` é a rede final.
  2. resolve `template_id` ativo de `tenants_template_ativo` por `tenant_id`;
     se ausente → `AppError(409, 'Tenant não possui template ativo')`.
  3. invalida o aceite anterior: `DELETE orcamento_aceites` cujas `versao_id`
     pertencem a versões do orçamento (no-op no primeiro envio).
  4. gera `id` da versão (`randomUUID`) antes do token, token público único via
     `gerarTokenPublico(versaoId)` (lib/token), insere a versão com
     `pdf_path`/`pdf_hash` nulos (PDF é tarefa 40) e `expira_em = null`.
  5. atualiza o orçamento: `status = 'enviado'`, `versao_atual = N`,
     `atualizado_em = now`.

## Verificação (rodada a partir de `backend/`)

### RED (antes da implementação)
`npm run test -- --run src/services/__tests__/versionamento.service.test.ts
src/repositories/__tests__/orcamento-versao.repository.test.ts`
→ 2 suites falharam: `Failed to load url ../versionamento.service.js` e
`../orcamento-versao.repository.js` (módulos inexistentes). RED esperado.

### GREEN (após implementação)
Mesmos arquivos: **20 testes passando** (11 serviço + 9 repositório).

### `npm run format`
Prettier aplicado; `versionamento.service.ts`,
`versionamento.service.test.ts` e `orcamento-versao.repository.test.ts`
reformatados; demais inalterados.

### `npm run build` (tsc)
Sem erros (exit 0).

### `npm run lint` (eslint src)
Limpo (exit 0).

### `npm run test` (vitest run — suíte completa)
**30 arquivos de teste, 329 testes passando.** (exit 0)

### `npm run test:coverage`
Totais do diretório:
- `src/services` → 99.66% stmts / 98.33% branch / 100% funcs / 99.66% lines
- `src/repositories` → 99.55% stmts / 88.63% branch / 100% funcs / 99.55% lines

Por arquivo (extraído de `coverage/coverage-final.json`):
- `services/versionamento.service.ts` → **100% de statements (80/80)**
- `repositories/orcamento-versao.repository.ts` → **95.6% de statements (87/91)**

Ambos ≥ 80% (DoD atendido). Thresholds globais de 80% do projeto continuam verdes.

## Fora de escopo (não feito, conforme plano)
- Geração de PDF (tarefa 40) — `pdf_path`/`pdf_hash` nulos.
- Rota `POST /:id/enviar` (tarefa 33) — nenhum wiring em `app.ts`.
- Módulo de template (tarefa 34) — apenas leitura de `tenants_template_ativo`.
- Nenhuma migration criada (schema de `orcamento_versoes`/`orcamento_aceites` já existe).
- Commit não realizado nesta etapa (feito em passo final após aprovação do review).

# Evidência — Tarefa 29: Serviço de Orçamento (Fase 5)

Spec: `.kiro/specs/ni-doc-mvp` — tarefa 29 (RF-005/RF-006/RF-007). Primeira iteração
(não havia `task29-review.json`). Implementado via TDD: testes escritos primeiro,
vistos falhar (módulo inexistente), depois implementação até passar.

## Arquivos criados

- `backend/src/services/orcamento.service.ts` — serviço de orçamento.
- `backend/src/services/__tests__/orcamento.service.test.ts` — 15 testes de unidade
  (mocks de `OrcamentoRepository` e `AuditoriaService`, sem Postgres).

## Arquivos alterados

Nenhum. O repositório da tarefa 28 (`orcamento.repository.ts`) foi consumido sem
modificação; `app.ts` não foi alterado (wiring das rotas é da tarefa 30).

## Decisões de design relevantes

- **Totais delegados ao repositório.** O `orcamento.repository.ts` (tarefa 28) já aplica
  `calcularSubtotal`/`calcularTotal`/`calcularTotalItem` em `criar`/`atualizar`. O serviço
  valida regras e repassa itens/descontos ao repositório (dono do cálculo), evitando
  duplicação e divergência com o valor persistido.
- **Trava de rascunho no serviço.** `atualizar`/`deletar` fazem `buscarPorId` → `AppError(404)`
  se ausente → `AppError(409)` se `status !== 'rascunho'` → delega (RF-005.5). O repositório
  mantém 404/409 como rede de segurança em `deletar`.
- **`OrcamentoContexto.usuarioId` obrigatório** porque `CriarOrcamentoInput.usuarioId` é
  obrigatório (RF-005.3).
- **Auditoria** registrada em `criar`/`atualizar`/`deletar` com `entidade: 'orcamentos'`,
  `entidadeId`, `ip`/`userAgent` do contexto (`estadoNovo` nos updates). Ação de exclusão: `'deletar'`.
- **`criar` valida** `clienteId`, `titulo` (não-vazio após trim) e `itens.length >= 1`
  (`AppError(400)`); validação de formato Zod fica para a tarefa 30.

## Comandos executados e resultados (de dentro de `backend/`)

### TDD — testes falham antes da implementação
`npm test -- orcamento.service`
```
FAIL  src/services/__tests__/orcamento.service.test.ts
Error: Failed to load url ../orcamento.service.js ... Does the file exist?
Test Files  1 failed (1)
```

### TDD — testes passam após a implementação
`npm test -- orcamento.service`
```
✓ src/services/__tests__/orcamento.service.test.ts (15 tests) 7ms
Test Files  1 passed (1)
Tests  15 passed (15)
```

### Format
`npm run format` → sem reescritas em `orcamento.service.ts`/teste (reportados `unchanged`).

### Lint
`npm run lint` (eslint src) → exit 0, sem erros.

### Build (TypeScript estrito)
`npm run build` (tsc) → exit 0, sem erros.

### Suíte completa
`npm test`
```
Test Files  26 passed (26)
Tests  277 passed (277)
```
Nenhuma suíte quebrada; nenhum skip indevido. Os 15 novos testes estão incluídos.

### Cobertura
`npm run test:coverage` → `src/services` agregado: Stmts 99.54 / Branch 97.61 / Funcs 100.

Por arquivo (`coverage/coverage-final.json`), `src/services/orcamento.service.ts`:
```
statements: 98.02%
branches:   95.24%
functions:  100.00%
```
Todos acima do mínimo de 80%.

## Fora de escopo (não feito)

- Rotas HTTP e schemas Zod de orçamento (tarefa 30).
- Wiring em `app.ts`.
- Versionamento/envio/PDF (Fase 6+).
- Tarefa 29 NÃO foi marcada como concluída em `tasks.md`.

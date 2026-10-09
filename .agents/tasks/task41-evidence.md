# Evidência — Tarefa 41: Serviço de Aceite (Fase 9)

Primeira iteração (não havia `task41-review.json`). Implementada via TDD, direto
em `/Users/nilson/Dev/ni-doc/backend`. Requisitos: RF-019, RF-020, RF-021.

## Arquivos criados / alterados

Criados:

- `backend/src/repositories/orcamento-aceite.repository.ts` — repositório de
  aceite. Interface `OrcamentoAceiteRepository` + factory
  `criarOrcamentoAceiteRepository({ db })`. `aprovarAceite` roda em UMA transação:
  advisory lock por `versao_id` → relê o status do orçamento ligado à versão
  (join filtrando por `tenant_id`) → rejeita versão inexistente ou orçamento já
  `aprovado` (409) → insere em `orcamento_aceites` → `UPDATE orcamentos SET
  status='aprovado'` por `tenant_id`. `buscarPorVersao` mapeia a linha ou null.
  SQL isolado no repositório; `mapRowAceite` snake→camel; `COLUNAS_ACEITE as const`.
- `backend/src/repositories/__tests__/orcamento-aceite.repository.test.ts` —
  8 testes (mock-based do Kysely, mesmo padrão de orcamento-versao).
- `backend/src/services/aceite.service.ts` — serviço. Interface `AceiteService`
  + factory `criarAceiteService(deps)`; shapes `AprovarViaClienteInput`,
  `AceiteManualInput`, `AceiteRegistrado` exportados.
- `backend/src/services/__tests__/aceite.service.test.ts` — 17 testes.

Alterados (adições do escopo da tarefa, sem tocar no comportamento existente):

- `backend/src/repositories/orcamento-versao.repository.ts` — adicionados
  `buscarPorToken(token)` e `buscarVersaoAtualPorOrcamento(tenantId, orcamentoId)`
  + interface `VersaoPorToken` (join versão↔orçamento projetando tenant, número,
  pdf_hash, token, expira_em e status do orçamento). `mapRowVersaoPorToken`.
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` —
  +4 testes para os dois métodos novos.

## Comportamentos cobertos (DoD)

- `aprovarViaCliente`: localiza a versão por `token_publico`, valida o HMAC
  (`validarTokenPublico`) e a expiração (relógio injetado), rejeita token
  inválido/expirado (410) e orçamento já aprovado (409) e versão sem `pdf_hash`
  (409). Persiste `metodo='cliente'` com IP/UA/hash. Mensagem genérica no 410.
- `aceiteManual`: exige justificativa não-vazia (400), carrega orçamento (404 se
  ausente) e versão vigente (409 se não houver), persiste `metodo='operador'`
  com `usuarioId` e `justificativa`. Status → `aprovado` via repositório.
- Comprovante PDF (RF-021): ambos os fluxos chamam `pdfService.gerarPdf` com HTML
  determinístico contendo número, versão, data/hora, IP, UA, hash e método; nome
  com sufixo `-aceite` (`{numero}-aceite-v{versao}.pdf`) para não colidir com o
  PDF do orçamento. Reusa a geração da Fase 8 sem alterá-la.
- Evidências (IP, UA, hash, método) registradas no `orcamento_aceites`.
- Auditoria: `acao='aprovar'` (cliente) e `acao='aceite_manual'` (operador),
  `entidade='orcamentos'`, `entidadeId=orcamentoId`, repassando IP/UA.

## Suposições (fora do escopo)

- Sem integração de e-mail (lib de e-mail é a Fase 11, tarefas 51–52) — nenhum
  `emailService` injetado.
- Rotas públicas (tarefa 42) e rota de aceite manual (tarefa 43) NÃO foram
  implementadas, conforme o escopo. Apenas o serviço + acesso a dados + testes.
- `htmlRenderer` é injetado para o wiring futuro, mas o comprovante usa HTML
  próprio determinístico (o html-renderer é específico do layout de orçamento).

## Comandos executados (a partir de `backend/`)

### `npm run build` (tsc)

Compilou sem erros. Exit 0.

### `npm run lint` (eslint src)

Sem erros. Exit 0.

### `npm run test:coverage` (vitest run --coverage)

```
Test Files  40 passed (40)
     Tests  450 passed (450)
All files   98.43 stmts | 91.95 branch | 98.99 funcs | 98.43 lines
```

Thresholds globais (80%) satisfeitos. Exit 0.

Cobertura dos arquivos da tarefa (relatório por arquivo):

- `src/services/aceite.service.ts` — 98.62% stmts | 96.29% branch | 85.71% funcs
  | 98.62% lines (linhas descobertas 251–252: `void _htmlRenderer`, sem lógica).
- `src/repositories/orcamento-aceite.repository.ts` — 100% em todas as métricas.
- Métodos novos de `orcamento-versao.repository.ts` cobertos pelos +4 testes
  (arquivo permanece em 100% stmts).

Suites novas (confirmação):

```
✓ src/services/__tests__/aceite.service.test.ts (17 tests)
✓ src/repositories/__tests__/orcamento-aceite.repository.test.ts (8 tests)
✓ src/repositories/__tests__/orcamento-versao.repository.test.ts (15 tests)
```

Nenhum arquivo temporário foi criado durante a verificação (o relatório de
cobertura fica em `coverage/`, já ignorado pelo git). Nenhum commit feito nesta
etapa (commit é do passo de merge pós-review).

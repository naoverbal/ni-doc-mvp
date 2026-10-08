# Evidência — Task 24: Repositório e serviço de empresas

Iteração: primeira (não havia `empresa-review.json`).

## Arquivos criados

- `backend/src/repositories/empresa.repository.ts`
- `backend/src/repositories/__tests__/empresa.repository.test.ts`
- `backend/src/services/empresa.service.ts`
- `backend/src/services/__tests__/empresa.service.test.ts`

Nenhuma rota, schema ou alteração em `app.ts` (fora de escopo — task 25).
Nenhum módulo já entregue (cliente etc.) foi modificado.

## Gates (executados em `backend/`)

| Gate | Comando | Resultado |
|------|---------|-----------|
| Testes novos | `npm run test -- --run src/repositories/__tests__/empresa.repository.test.ts src/services/__tests__/empresa.service.test.ts` | exit 0 — 26 passed (12 repo + 14 service) |
| Build (tsc strict) | `npm run build` | exit 0 — compila limpo |
| Lint | `npm run lint` | exit 0 — zero erros/avisos |
| Format | `npm run format` | aplicado (empresa.service.ts reformatado) |
| Suíte completa | `npm run test -- --run` | exit 0 — 194 passed (20 arquivos), sem regressões |

## Cobertura (`npm run test:coverage -- --run`)

- `src/repositories`: 100% stmts / 100% funcs / 91.01% branch
- `src/services`: 100% stmts / 100% funcs / 98.11% branch

Acima do alvo de 80% para serviços/repositórios.

## Decisões de design (diferenças em relação a cliente)

- `razao_social` (obrigatório) + `nome_fantasia` (opcional) no lugar de `nome`.
- `tipo: 'tenant' | 'cliente_pj'` no lugar de `tipo_pessoa`.
- CNPJ opcional: quando presente, valida com `validarCNPJ`, grava `cnpj_hash` +
  `cnpj_encrypted` e checa duplicidade por tenant; quando ausente, ambas as colunas
  ficam null e a checagem é pulada.
- Sem campo `observacoes` (não existe na tabela `empresas`).
- `buscarPorNomeETipo(tenantId, termo, tipo)`: ILIKE em `razao_social` + filtro por
  `tipo` + `ativo = true`, ordenado por `razao_social`, limite 20 (autocomplete RF-011.2).

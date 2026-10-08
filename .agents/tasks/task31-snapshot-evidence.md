# Evidências — Tarefa 31: Serviço de snapshot

Serviço de montagem PURO do snapshot JSONB imutável do orçamento no momento da
emissão (RF-008; Correctness Properties nº 2 — imutabilidade — e nº 3 —
integridade). Sem banco, sem persistência, sem repositório. Persistência e
versionamento são da Tarefa 32 (não tocados).

## Arquivos

- `backend/src/services/snapshot.service.ts` (implementação)
- `backend/src/services/__tests__/snapshot.service.test.ts` (testes Vitest)

## Ciclo TDD

1. RED: teste escrito primeiro falhou por módulo `../snapshot.service.js`
   inexistente.
2. GREEN: serviço implementado; 9 testes passam.
3. Refino: build + lint limpos sem ajustes de formatação necessários.

## Comandos rodados (de `/Users/nilson/Dev/ni-doc/backend`)

### `npm run test -- --run src/services/__tests__/snapshot.service.test.ts`

```
✓ src/services/__tests__/snapshot.service.test.ts (9 tests) 4ms
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

Casos cobertos (mínimos obrigatórios + extras de ramo):

1. Monta snapshot completo (cliente, empresa, itens, totais, responsável aninhado).
2. `data_emissao` no formato ISO `YYYY-MM-DD` (string, JSON-serializável).
3. Imutabilidade: mutar cliente/empresa/itens de origem não altera o snapshot.
4. Array `itens` (e cada item) não compartilha referência com a entrada.
5. `empresa_cliente === null` quando empresa ausente, `null` ou `undefined`.
6. `responsavel === null` quando o item não tem `responsavelId` ou o id não está no Map.
7. `desconto_global === null` sem desconto e `{ tipo, valor }` quando presente.
8. `desconto_global === null` quando só tipo OU só valor está presente.
9. Totais (`subtotal`, `total`, `total` do item) copiados exatamente.

### `npm run build`

Compila sem erros de tipo (TS estrito: `strict`, `noUncheckedIndexedAccess`,
`noImplicitOverride`). Exit code 0.

### `npm run lint`

ESLint sem erros. Exit code 0.

### Cobertura (`npm run test:coverage` restrito ao serviço)

```
File               | % Stmts | % Branch | % Funcs | % Lines
 ...hot.service.ts |     100 |      100 |     100 |     100
```

100% em statements, branches, funções e linhas no `snapshot.service.ts`
(≥ 80% exigido). Obs.: o threshold global de 80% é medido pela suíte completa;
ao rodar só este arquivo de teste o total global aparece baixo por design.

## Decisões de design

- **`data_emissao` → `YYYY-MM-DD`.** `OrcamentoComItens.dataEmissao` é `Date`;
  a coluna é `DATE` e o design 5.2 mostra `"2026-10-01"`. Convertido de forma
  determinística com `toISOString().slice(0, 10)` (UTC, sem hora/fuso).
  JSON-serializável e estável independente do fuso do processo. Documentado em
  comentário no serviço (`montarDataEmissao`).
- **`responsaveisPorId: Map<string, ResponsavelPublico>`** recebido já resolvido
  pelo chamador (Tarefa 32), mantendo o serviço puro. Item com `responsavelId`
  nulo ou id ausente do Map → `responsavel: null`.
- **`empresaCliente?: EmpresaPublica | null`** opcional; `empresa_cliente` fica
  `null` quando ausente/`null`/`undefined`.
- **`desconto_global`** só é preenchido quando tipo E valor estão presentes
  (espelha o repositório de orçamentos); caso contrário `null`.
- **Cópia profunda por valor:** todos os objetos/arrays são construídos campo a
  campo (sem spread da entrada, sem reuso do array `itens`). Como os campos são
  primitivos (`string`/`number`/`null`), não há referências compartilhadas.

## Fora do escopo (não feito)

- Sem persistência no banco, sem migration.
- `versionamento.service.ts` (Tarefa 32) e rota de envio (Tarefa 33) não tocados.
- `tasks.md` não marcado como concluído.
- Interfaces dos repositórios não alteradas (apenas importadas com `import type`).

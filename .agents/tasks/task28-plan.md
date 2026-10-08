# Implementation Plan — Tarefa 28 (Fase 5): Repositório de Orçamentos

Implementa `orcamento.repository.ts` + testes, seguindo TDD e espelhando o padrão de
`cliente.repository.ts` / `empresa.repository.ts` / `responsavel.repository.ts`.

## Contexto e decisões de design (lidas do código real, não assuma)

### Padrão de repositório existente
- Os repositórios recebem `db: Kysely<Database>` e retornam um objeto que implementa uma
  interface exportada. Interfaces de input/output são exportadas (ex.: `CriarClienteInput`,
  `ClientePublico`).
- `mapRow*` converte explicitamente `snake_case` (DB) → `camelCase` (domínio).
- **Nenhuma query usa `WHERE tenant_id` só para isolamento** nos repos atuais? — ATENÇÃO: os
  repos atuais (cliente/empresa/responsavel) AINDA filtram `.where('tenant_id', '=', tenantId)`
  explicitamente além da RLS. Siga o mesmo: o orçamento recebe `tenantId` nos métodos de leitura
  e filtra por ele, exatamente como `cliente.repository.ts`. A RLS é defesa em profundidade; o
  filtro explícito permanece para espelhar o padrão e manter os testes mock-based consistentes.
- **Assinatura do factory:** o enunciado da tarefa exige explicitamente
  `criarOrcamentoRepository({ db })` (parâmetro objeto com `db`). Isso DIVERGE dos repos atuais,
  que recebem `db` posicional (`criarClienteRepository(db)`). **Decisão:** seguir o enunciado
  (autoridade máxima) e usar `criarOrcamentoRepository({ db }: { db: Kysely<Database> })`. Deixe
  um comentário em português explicando a divergência de assinatura em relação aos repos vizinhos.

### Testes são 100% mock-based (NÃO há banco real nos testes de repositório)
- `cliente.repository.test.ts` e `responsavel.repository.test.ts` mockam o Kysely com
  _builders fluentes_ (`makeInsertBuilder`, `makeSelectBuilder`, `makeUpdateBuilder`), cada método
  encadeável (`values`, `where`, `returning`, `orderBy`, `limit`...) retorna o próprio builder e os
  terminais (`execute`, `executeTakeFirst`, `executeTakeFirstOrThrow`) resolvem com um resultado mockado.
- `vitest.config.ts` injeta env (`DATABASE_URL` fake, `CRYPTO_KEY`, etc.) via `env`,
  `setupFiles` e `globalSetup`. **Não** há conexão real nem aplicação de migrations/RLS nos unit tests.
- **Decisão sobre "setup de tenant / RLS" mencionado no enunciado:** os testes existentes NÃO sobem
  Postgres nem exercitam RLS de verdade; eles verificam o comportamento do repositório com mocks.
  Siga EXATAMENTE esse mecanismo. O "teste de isolamento de tenant" aqui = assert de que os métodos
  de leitura/escrita aplicam o filtro `.where('tenant_id', '=', tenantId)` (e, para itens, operam via
  `orcamento_id`), e não um teste de RLS ponta-a-ponta. Documente isso num comentário no arquivo de teste.

### Mock de transação (necessário para `criar` e `atualizar`)
`criar` e `atualizar` precisam ser atômicos. O Kysely expõe `db.transaction().execute(cb)` onde `cb`
recebe um `trx` com a mesma interface de query builder. Mock sugerido:
```ts
function makeTrx() {
  const trx = {
    insertInto: vi.fn(),
    selectFrom: vi.fn(),
    updateTable: vi.fn(),
    deleteFrom: vi.fn(),
  }
  // cada um retorna o builder apropriado configurado no teste
  return trx
}
function makeDbComTransacao(trx: unknown) {
  return {
    transaction: () => ({ execute: (cb: (t: unknown) => unknown) => cb(trx) }),
    // selectFrom/etc. no nível do db também, se o método usar fora de transação
  } as unknown as Kysely<Database>
}
```
Adicione um `makeDeleteBuilder` (métodos `where`, `execute`/`executeTakeFirst`) análogo aos existentes.

### Colunas reais (derivadas de `types/database.ts` + `001_initial_schema.sql`)

**Tabela `orcamentos`:**
`id, tenant_id, numero, cliente_id, empresa_cliente_id, usuario_id, titulo, descricao, status,
data_emissao, validade_dias, desconto_global_tipo, desconto_global_valor, subtotal, total,
versao_atual, observacoes, condicoes_pagamento, criado_em, atualizado_em`.
- `status` default `'rascunho'`; CHECK em `('rascunho','enviado','aprovado','reprovado','expirado','cancelado')`.
- `data_emissao` DATE default `CURRENT_DATE`; `validade_dias` INTEGER default 30; `versao_atual` default 0.
- NUMERIC: `desconto_global_valor`, `subtotal`, `total` → o driver `pg` **retorna string**; no `database.ts`
  são `string`/`Generated<string>`. **mapRow deve converter para `number`** no domínio.
- `UNIQUE (tenant_id, numero)`.

**Tabela `orcamento_itens`:**
`id, orcamento_id, ordem, nome, descricao, quantidade, unidade, valor_unitario, desconto_tipo,
desconto_valor, total, responsavel_id, criado_em`.
- NUMERIC: `quantidade` (12,4), `valor_unitario` (12,2), `desconto_valor` (12,2), `total` (12,2) →
  strings do pg; converter para `number` no mapRow.
- `quantidade` default 1, `unidade` default `'un'`. CHECK `desconto_tipo IN ('percentual','fixo')`.
- RLS via EXISTS em `orcamentos` (sem `tenant_id` próprio): queries de itens filtram por `orcamento_id`.

### Numeração sequencial `ORC-{ANO}-{SEQ}` sem race condition — decisão
- Não existe sequence/tabela de contador no schema (confirmado em migrations 001–003; o seed usa
  números fixos `ORC-2025-0001`). Portanto a geração é responsabilidade do repositório.
- **Decisão:** gerar o número DENTRO da mesma transação de `criar`, computando o próximo sequencial a
  partir do maior `numero` existente do tenant no ano corrente, com trava de concorrência via
  **advisory lock transacional por (tenant, ano)**:
  1. `data_emissao` define o ano (default `CURRENT_DATE` → usar `EXTRACT(YEAR ...)`); como o insert
     usa o default do banco, derive o ano no app com `new Date().getFullYear()` para montar o prefixo,
     e assuma `data_emissao = CURRENT_DATE` (coerente com o default). Documente essa premissa.
  2. `SELECT pg_advisory_xact_lock(hashtext($tenantId || ':' || $ano))` — serializa a geração por
     tenant+ano apenas durante a transação (liberado no commit/rollback), sem bloquear tenants/anos distintos.
  3. `SELECT MAX(CAST(SUBSTRING(numero FROM 'ORC-\d{4}-(\d+)$') AS INTEGER)) FROM orcamentos
     WHERE tenant_id = $1 AND numero LIKE 'ORC-{ANO}-%'` → próximo = `(max ?? 0) + 1`.
  4. Formatar `ORC-${ano}-${String(seq).padStart(4, '0')}`.
  - Use `sql` template tag do Kysely (`import { sql } from 'kysely'`) para o advisory lock e, se
    preferir, para o MAX; o `UNIQUE (tenant_id, numero)` é a rede de segurança final.
  - **Justificativa:** advisory lock transacional + leitura do MAX dentro da mesma transação elimina
    a janela de corrida entre "ler o último" e "inserir", sem precisar de nova migration (fora do
    escopo da tarefa 28) nem de sequence global (que não é por-tenant+ano). É a abordagem segura de
    menor impacto no schema atual.
  - Nos **unit tests** (mock), não há Postgres: o teste verifica que (a) o advisory lock é emitido
    antes do SELECT de MAX, (b) o formato gerado é `ORC-{ANO}-0001` quando MAX=null e
    `ORC-{ANO}-0043` quando MAX=42, mockando o retorno do SELECT de MAX. A ausência de race é
    garantida pelo design (lock + leitura na transação) e documentada; a verificação ponta-a-ponta
    sob concorrência fica para testes de integração (mesma convenção do middleware `tenant.ts`).

### Regra exata do `deletar` — decisão
- Design/§8.2: `DELETE /api/orcamentos/:id` = "Remove rascunho"; `PUT` em enviado → 409. RF-005.5:
  edição irrestrita só enquanto `rascunho`.
- **Decisão:** `deletar` só apaga quando `status === 'rascunho'`. Caso contrário lança
  `AppError(409, 'Só é possível excluir orçamentos em rascunho')` (409 Conflict, coerente com o
  PUT-em-enviado→409 do design). Se o orçamento não existir para o tenant, lançar
  `AppError(404, 'Orçamento não encontrado')`. Implementar lendo o status primeiro (filtrado por
  tenant) e então `deleteFrom('orcamentos')`; os itens somem via `ON DELETE CASCADE`.

## Assinaturas a implementar (concretas)

```ts
// interfaces de input
export interface CriarOrcamentoItemInput {
  nome: string
  descricao?: string
  quantidade: number
  unidade?: string            // default 'un' aplicado no insert
  valorUnitario: number
  descontoTipo?: 'percentual' | 'fixo'
  descontoValor?: number
  responsavelId?: string
  // 'ordem' é atribuída pelo repositório pela posição no array (1-based)
}

export interface CriarOrcamentoInput {
  tenantId: string
  clienteId: string
  empresaClienteId?: string
  usuarioId: string
  titulo: string
  descricao?: string
  validadeDias?: number        // default 30
  descontoGlobalTipo?: 'percentual' | 'fixo'
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]   // >= 1 (RF-005.4); validação de Zod é da tarefa 30, mas o repo assume não-vazio
}

export interface AtualizarOrcamentoInput {
  clienteId?: string
  empresaClienteId?: string
  titulo?: string
  descricao?: string
  validadeDias?: number
  descontoGlobalTipo?: 'percentual' | 'fixo'
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]   // SUBSTITUI todos os itens
}

// interfaces de output
export interface OrcamentoItemPublico {
  id: string
  ordem: number
  nome: string
  descricao: string | null
  quantidade: number
  unidade: string
  valorUnitario: number
  descontoTipo: 'percentual' | 'fixo' | null
  descontoValor: number | null
  total: number
  responsavelId: string | null
}

export interface OrcamentoComItens {
  id: string
  tenantId: string
  numero: string
  clienteId: string
  empresaClienteId: string | null
  usuarioId: string
  titulo: string
  descricao: string | null
  status: 'rascunho' | 'enviado' | 'aprovado' | 'reprovado' | 'expirado' | 'cancelado'
  dataEmissao: Date
  validadeDias: number
  descontoGlobalTipo: 'percentual' | 'fixo' | null
  descontoGlobalValor: number | null
  subtotal: number
  total: number
  versaoAtual: number
  observacoes: string | null
  condicoesPagamento: string | null
  criadoEm: Date
  atualizadoEm: Date
  itens: OrcamentoItemPublico[]
}

export interface ListarOrcamentosFiltro {
  status?: 'rascunho' | 'enviado' | 'aprovado' | 'reprovado' | 'expirado' | 'cancelado'
  pagina?: number        // 1-based, default 1
  tamanhoPagina?: number // default 20
}

export interface ListaOrcamentos {
  itens: OrcamentoResumo[]   // SEM os itens do orçamento (lista enxuta)
  total: number              // total de registros (para paginação)
  pagina: number
  tamanhoPagina: number
}

// OrcamentoResumo = subset de OrcamentoComItens sem `itens` (id, numero, titulo, status,
// clienteId, subtotal, total, versaoAtual, dataEmissao, criadoEm). Exportar a interface.

export interface OrcamentoRepository {
  criar(input: CriarOrcamentoInput): Promise<OrcamentoComItens>
  buscarPorId(tenantId: string, id: string): Promise<OrcamentoComItens | null>
  atualizar(tenantId: string, id: string, dados: AtualizarOrcamentoInput): Promise<OrcamentoComItens | null>
  listarPorTenant(tenantId: string, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  deletar(tenantId: string, id: string): Promise<void>
}

export function criarOrcamentoRepository(deps: { db: Kysely<Database> }): OrcamentoRepository
```

Notas de implementação:
- Importar `calcularTotalItem`, `calcularSubtotal`, `calcularTotal` de `../lib/orcamento-calculo.js`
  e computar `total` de cada item + `subtotal` + `total` do orçamento no `criar`/`atualizar`
  (RF-006.4, RF-007). NUMERIC vai como `number` no insert (o driver aceita; mapRow lê de volta como string→number).
- Imports relativos COM `.js` (`../types/database.js`, `../lib/orcamento-calculo.js`, `../errors/app-error.js`).
- `mapRowOrcamento` e `mapRowItem` convertem NUMERIC string→number via `Number(...)` (null-safe para
  `desconto_global_valor`/`desconto_valor`).
- `buscarPorId`: dois selects (orçamento + itens `ORDER BY ordem ASC`), ou um select de itens após
  confirmar o orçamento; retornar `null` se o orçamento não existir.
- `atualizar`: dentro de transação → `updateTable('orcamentos')` dos campos presentes +
  `atualizado_em = NOW()`, recalcula subtotal/total, `deleteFrom('orcamento_itens').where('orcamento_id','=',id)`
  e reinsere os itens com `ordem` 1-based. Retorna `buscarPorId` do resultado (ou monta o objeto).
  Se o orçamento não existir para o tenant, retornar `null`.
- `listarPorTenant`: `where('tenant_id','=',tenantId)`, filtro opcional `.where('status','=',...)`,
  `orderBy('criado_em','desc')`, `limit`/`offset` para paginação, e um `count` separado para `total`.

## Code style (obrigatório)
Prettier: aspas simples, SEM ponto-e-vírgula, indentação 2 espaços, trailing commas `all`,
print width 100. Identificadores/comentários em português.

---

## Itens do plano (TDD: teste primeiro, depois implementação)

- [ ] 1. Criar o arquivo de testes com o scaffolding de mocks e os helpers de builder.
      Criar `backend/src/repositories/__tests__/orcamento.repository.test.ts` copiando os helpers
      `makeInsertBuilder`/`makeSelectBuilder`/`makeUpdateBuilder` de `cliente.repository.test.ts`,
      e adicionar `makeDeleteBuilder` (`where`→self, `execute`/`executeTakeFirst` terminal) e os
      helpers de transação `makeTrx`/`makeDbComTransacao` descritos acima. Importar
      `criarOrcamentoRepository` de `../orcamento.repository.js` (ainda não existe → testes falham
      ao compilar/rodar, como esperado em TDD). Adicionar comentário em pt-BR explicando que os
      testes são mock-based e que RLS é verificada por testes de integração (como `tenant.ts`).
      Files: backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — a suíte roda e FALHA porque o
      módulo do repositório ainda não existe (red do TDD).

- [ ] 2. Criar o esqueleto do repositório: imports, todas as interfaces exportadas e o factory
      `criarOrcamentoRepository({ db })` com os 5 métodos lançando `throw new Error('não implementado')`.
      Inclui os tipos de Row internos (`OrcamentoRow`, `OrcamentoItemRow`) e os `mapRow*` com conversão
      NUMERIC string→number. Comentário em pt-BR sobre a divergência de assinatura (`{ db }`).
      Files: backend/src/repositories/orcamento.repository.ts
      Verify: `cd backend && npm run build` — compila (tsc) sem erros de tipo. (A suíte do item 1
      ainda falha por lógica não implementada.)

- [ ] 3. Escrever os testes de `criar()` e implementar `criar()`.
      Testes: (a) insere orçamento + itens dentro de `db.transaction().execute(...)` — assert de que
      `transaction` foi chamado e que insert em `orcamentos` e em `orcamento_itens` ocorreu no `trx`;
      (b) gera `numero` `ORC-{ANO}-0001` quando o SELECT de MAX retorna null e `ORC-{ANO}-0043` quando
      retorna 42, com `ano = new Date().getFullYear()`; (c) o advisory lock
      (`pg_advisory_xact_lock`) é emitido ANTES do SELECT de MAX (verificar ordem das chamadas no trx);
      (d) `status` inicial não é forçado no insert (usa default `rascunho`) OU é setado como `'rascunho'`
      — escolher e assertar; (e) `ordem` dos itens é 1-based pela posição no array; (f) `subtotal`/`total`
      calculados via `orcamento-calculo` conferem com um caso conhecido; (g) retorna `OrcamentoComItens`
      com NUMERIC já convertido para `number`. Implementar `criar()` conforme a decisão de numeração.
      Files: backend/src/repositories/orcamento.repository.ts, backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — os testes de `criar()` passam.

- [ ] 4. Escrever os testes de `buscarPorId()` e implementar.
      Testes: (a) retorna `null` quando o orçamento não existe (select do orçamento resolve `undefined`);
      (b) retorna o orçamento COM `itens` ordenados por `ordem` ASC — assert de `.orderBy('ordem','asc')`
      e de que os itens vêm mapeados (NUMERIC→number); (c) filtra por `tenant_id` (assert
      `.where('tenant_id','=',tenantId)`). Implementar.
      Files: backend/src/repositories/orcamento.repository.ts, backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — testes de `buscarPorId()` passam.

- [ ] 5. Escrever os testes de `atualizar()` e implementar.
      Testes: (a) tudo ocorre dentro de transação; (b) SUBSTITUI itens: `deleteFrom('orcamento_itens')`
      filtrando por `orcamento_id` e reinsere os novos com `ordem` recomputada; (c) atualiza campos do
      orçamento presentes em `AtualizarOrcamentoInput` + `atualizado_em`; (d) recalcula `subtotal`/`total`;
      (e) retorna `null` quando o orçamento não existe para o tenant. Implementar.
      Files: backend/src/repositories/orcamento.repository.ts, backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — testes de `atualizar()` passam.

- [ ] 6. Escrever os testes de `listarPorTenant()` e implementar (paginação + filtro + isolamento).
      Testes: (a) filtra por `tenant_id` (isolamento de tenant); (b) aplica `.where('status','=',...)`
      somente quando `filtro.status` definido; (c) aplica `limit`/`offset` corretos para
      `pagina`/`tamanhoPagina` (ex.: página 2, tamanho 20 → offset 20, limit 20); (d) retorna `total`,
      `pagina`, `tamanhoPagina` e a lista de resumos sem o array `itens` do orçamento; (e) `orderBy`
      `criado_em desc`. Implementar.
      Files: backend/src/repositories/orcamento.repository.ts, backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — testes de `listarPorTenant()` passam.

- [ ] 7. Escrever os testes de `deletar()` e implementar a regra de rascunho.
      Testes: (a) deleta quando `status === 'rascunho'` (assert `deleteFrom('orcamentos')` filtrado por
      tenant+id); (b) lança `AppError(409, ...)` quando status é `enviado`/`aprovado`/etc. — usar
      `await expect(...).rejects.toBeInstanceOf(AppError)` e checar `statusCode === 409`; (c) lança
      `AppError(404, ...)` quando o orçamento não existe para o tenant. Implementar lendo o status
      primeiro e então deletando (itens caem por `ON DELETE CASCADE`).
      Files: backend/src/repositories/orcamento.repository.ts, backend/src/repositories/__tests__/orcamento.repository.test.ts
      Verify: `cd backend && npm run test -- orcamento.repository` — testes de `deletar()` passam.

- [ ] 8. Rodar a suíte completa, lint, build e cobertura; corrigir pendências de estilo/tipo.
      Garantir Prettier (sem ponto-e-vírgula, aspas simples, print width 100) e ESLint limpos, e que o
      arquivo novo mantém a cobertura ≥ 80% exigida (meta do MVP; repositório deve ficar bem acima).
      Files: (nenhum novo; ajustes finos nos dois arquivos criados)
      Verify (todos de dentro de `backend/`):
        - `npm run test` → toda a suíte verde (sem quebrar outros repos).
        - `npm run lint` → sem erros.
        - `npm run build` → tsc sem erros.
        - `npm run test:coverage` → thresholds de 80% satisfeitos; conferir a linha de
          `orcamento.repository.ts` no relatório por arquivo.

## Fora de escopo (NÃO fazer nesta tarefa)
- NÃO implementar o service (tarefa 29) nem as rotas (tarefa 30).
- NÃO criar/alterar migrations (a numeração é resolvida no repositório via advisory lock, sem schema novo).
- NÃO marcar a tarefa 28 como concluída no `tasks.md`.
- NÃO tocar arquivos vizinhos nem fazer limpeza não relacionada.

## Lacunas / premissas assumidas
- O enunciado cita "setup de tenant / RLS" nos testes, mas os testes de repositório existentes são
  mock-based e NÃO sobem Postgres. Assumi o padrão real do repo (mocks) e tratei "isolamento de tenant"
  como asserção de filtro `tenant_id`/`orcamento_id`. Se o revisor exigir testes de integração com
  Postgres real + RLS, isso seria um novo mecanismo não presente hoje (decisão a escalar).
- `criar` assume `data_emissao = CURRENT_DATE` (default do banco) para derivar o ANO do número; o ano
  é computado no app com `new Date().getFullYear()`. Coerente com o default do schema.
- `AtualizarOrcamentoInput.itens` é obrigatório (substituição total). Se o produto quiser update parcial
  sem mexer em itens, seria uma variação futura; o enunciado diz "SUBSTITUI os itens".

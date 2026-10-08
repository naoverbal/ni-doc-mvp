# Implementation Plan — Tarefa 29: Serviço de Orçamento (Fase 5)

Spec: `.kiro/specs/ni-doc-mvp` — tarefa 29 (RF-005, RF-006, RF-007).
Trabalho direto na árvore atual (sem worktree). Backend em `/Users/nilson/Dev/ni-doc/backend`.
TDD obrigatório: teste primeiro, ver falhar, implementar, ver passar.

## Contexto descoberto na exploração

- **Padrão de service** (`cliente.service.ts`, `empresa.service.ts`, `responsavel.service.ts`):
  interface exportada `*Service`; factory `criar*Service(deps)`; tipo de contexto
  `*Contexto { tenantId; usuarioId?; ip?; userAgent? }`; tipos de entrada exportados;
  DI de `{ <entidade>Repo, auditoriaService }`. Auditoria registrada em criar/atualizar/
  desativar com `auditoriaService.registrar({ tenantId, usuarioId, acao, entidade, entidadeId, estadoNovo?, ip, userAgent })`.
- **Repositório** `orcamento.repository.ts` (tarefa 28, já existe) expõe `OrcamentoRepository`
  com `criar`, `buscarPorId`, `atualizar`, `listarPorTenant`, `deletar`. Assinaturas exatas a reutilizar:
  - `criar(input: CriarOrcamentoInput): Promise<OrcamentoComItens>`
  - `buscarPorId(tenantId, id): Promise<OrcamentoComItens | null>`
  - `atualizar(tenantId, id, dados: AtualizarOrcamentoInput): Promise<OrcamentoComItens | null>`
  - `listarPorTenant(tenantId, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>`
  - `deletar(tenantId, id): Promise<void>` — já lança `AppError(404)` se ausente e `AppError(409)` se não-rascunho.
  - Tipos a reutilizar (NÃO reinventar): `OrcamentoStatus`, `DescontoTipo`, `CriarOrcamentoInput`,
    `CriarOrcamentoItemInput`, `AtualizarOrcamentoInput`, `OrcamentoComItens`, `OrcamentoItemPublico`,
    `OrcamentoResumo`, `ListarOrcamentosFiltro`, `ListaOrcamentos`.
  - `CriarOrcamentoInput` exige `tenantId`, `clienteId`, `usuarioId`, `titulo`, `itens: CriarOrcamentoItemInput[]`.
- **Cálculo**: `orcamento.repository.ts` JÁ calcula `subtotal`/`total`/`total do item` internamente
  via `calcularSubtotal`/`calcularTotal`/`calcularTotalItem` em `criar` e `atualizar`. Ver "Decisão de totais" abaixo.
- **AppError**: `AppError(statusCode, message, detalhes?)` de `../errors/app-error.js`.
- **Teste de service**: `__tests__/*.service.test.ts` usam Vitest com `vi.fn()` mockando repositório e
  `auditoriaService` (sem Postgres). `makeDeps(overrides)` monta os mocks; `ctx = { tenantId, usuarioId }`.
  Asserções usam `rejects.toMatchObject({ statusCode })` e `expect(...).toHaveBeenCalledWith(expect.objectContaining({ acao, entidade }))`.
- **ESM Node16**: imports relativos COM `.js` (`../errors/app-error.js`, `../repositories/orcamento.repository.js`, `./auditoria.service.js`).
- **Comandos reais** (de `backend/package.json`): `npm test` → `vitest run`; `npm run lint` → `eslint src`; `npm run build` → `tsc`.
- Entidade de auditoria para orçamentos: usar a string da tabela, **`'orcamentos'`** (espelha `'clientes'`, `'empresas'`, `'responsaveis_tecnicos'`).

## Decisões de design

1. **Totais: delegados ao repositório, não recalculados no service.** O enunciado pede "calcula os
   totais (via orcamento-calculo) antes de delegar", mas o repositório da tarefa 28 **já** aplica
   `calcularSubtotal`/`calcularTotal`/`calcularTotalItem` em `criar`/`atualizar`. Reimplementar no
   service duplicaria a matemática e abriria risco de divergência com o valor persistido. Decisão:
   o service **não** recalcula; valida regras de negócio e repassa itens/descontos ao repositório, que
   é o dono do cálculo. Os testes verificam que o service delega com os dados corretos e retorna os
   totais que o repositório devolve (RF-006/RF-007 permanecem cobertos pela matemática do repo + testes da lib).
2. **`OrcamentoContexto` exige `usuarioId` obrigatório** (diferente dos vizinhos onde é opcional),
   porque `CriarOrcamentoInput.usuarioId` é obrigatório (RF-005.3 associa `usuario_id`). Tipo:
   `{ tenantId: string; usuarioId: string; ip?: string; userAgent?: string }`.
3. **Trava de rascunho em `atualizar` vive no service.** O repositório `atualizar` NÃO checa status.
   O service faz `buscarPorId` primeiro → `AppError(404)` se `null` → `AppError(409, 'Só é possível editar orçamentos em rascunho')`
   se `status !== 'rascunho'` → delega. (RF-005.5: edição irrestrita só em rascunho.)
4. **`deletar` no service pré-checa via `buscarPorId`** para 404/409 e auditoria consistentes, antes de
   chamar `orcamentoRepo.deletar`. O repo também lança 404/409 como rede de segurança, mas a regra e a
   auditoria ficam no service (coerente com a decisão 3 e com a instrução da tarefa).
5. **`criar` valida presença de cliente, título e ≥1 item** antes de delegar (RF-005.4), lançando
   `AppError(400)` com mensagem específica. Validação de formato detalhada (Zod) é da tarefa 30.
6. **`listar`/`buscar` repassam `ctx.tenantId`** ao repositório — isolamento de tenant preservado.
   `buscarPorId` do service lança `AppError(404)` quando o repo retorna `null` (padrão dos vizinhos).

## Forma do service (resumo da API a implementar)

```
export interface OrcamentoContexto { tenantId: string; usuarioId: string; ip?: string; userAgent?: string }

export interface CriarOrcamentoDados {   // espelha CriarOrcamentoInput SEM tenantId/usuarioId (vêm do ctx)
  clienteId: string
  empresaClienteId?: string
  titulo: string
  descricao?: string
  validadeDias?: number
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]
}

export interface OrcamentoService {
  criar(ctx, dados: CriarOrcamentoDados): Promise<OrcamentoComItens>
  buscarPorId(ctx, id: string): Promise<OrcamentoComItens>
  listar(ctx, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  atualizar(ctx, id: string, dados: AtualizarOrcamentoInput): Promise<OrcamentoComItens>
  deletar(ctx, id: string): Promise<void>
}

export function criarOrcamentoService(deps: { orcamentoRepo: OrcamentoRepository; auditoriaService: AuditoriaService }): OrcamentoService
```

`DescontoTipo`, `CriarOrcamentoItemInput`, `AtualizarOrcamentoInput`, `OrcamentoComItens`,
`ListarOrcamentosFiltro`, `ListaOrcamentos`, `OrcamentoRepository` são **importados** de
`../repositories/orcamento.repository.js` — não redefinir.

## Itens do plano

- [ ] 1. Escrever os testes do serviço (TDD — primeiro, devem falhar por ausência do módulo).
      Criar `backend/src/services/__tests__/orcamento.service.test.ts` espelhando
      `cliente.service.test.ts`/`empresa.service.test.ts`: `makeDeps(overrides)` com `orcamentoRepo`
      (todos os 5 métodos como `vi.fn()` com retornos mock) e `auditoriaService` (`registrar`/`listar`),
      `ctx = { tenantId: 'tenant-1', usuarioId: 'user-1' }`, e um `orcamentoMock: OrcamentoComItens`
      (com `itens: [...]`) e `listaMock: ListaOrcamentos`. Cobrir:
      - `criar()`: delega com `tenantId`/`usuarioId` do ctx e retorna o orçamento; `toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'tenant-1', usuarioId: 'user-1', clienteId, titulo }))`;
        AppError(400) quando `itens` vazio; AppError(400) quando `titulo` ausente/vazio; AppError(400) quando `clienteId` ausente; registra auditoria `{ acao: 'criar', entidade: 'orcamentos' }`; NÃO delega quando a validação falha.
      - `buscarPorId()`: retorna quando existe e chama `orcamentoRepo.buscarPorId('tenant-1', id)`; AppError(404) quando repo retorna `null`.
      - `listar()`: delega para `orcamentoRepo.listarPorTenant('tenant-1', filtro)` e repassa o filtro.
      - `atualizar()`: delega e audita `{ acao: 'atualizar', entidade: 'orcamentos' }` quando status `rascunho`;
        AppError(404) quando `buscarPorId` → `null`; AppError(409) quando status `enviado` (mock de `buscarPorId` com status não-rascunho) e NÃO chama `orcamentoRepo.atualizar`.
      - `deletar()`: chama `orcamentoRepo.deletar('tenant-1', id)` e audita `{ acao: 'deletar'|'excluir', entidade: 'orcamentos' }` quando `rascunho`;
        AppError(404) quando `buscarPorId` → `null`; AppError(409) quando não-rascunho e NÃO chama `orcamentoRepo.deletar`.
      Files: `backend/src/services/__tests__/orcamento.service.test.ts`
      Verify: `cd backend && npm test -- orcamento.service` — os testes do novo arquivo FALHAM (módulo inexistente / comportamento ausente). Falha esperada nesta etapa.

- [ ] 2. Implementar o serviço de orçamento para fazer os testes passarem.
      Criar `backend/src/services/orcamento.service.ts` seguindo a "Forma do service" acima e as
      decisões de design. Importar tipos e `OrcamentoRepository` de `../repositories/orcamento.repository.js`
      e `AuditoriaService` de `./auditoria.service.js`, `AppError` de `../errors/app-error.js` (todos com `.js`).
      Regras: `criar` valida `clienteId`, `titulo` (não-vazio após trim) e `itens.length >= 1` (AppError 400),
      monta `CriarOrcamentoInput` com `tenantId`/`usuarioId` do ctx e delega; `atualizar`/`deletar` fazem
      `buscarPorId` → 404/409 (rascunho) antes de delegar; auditoria em `criar`/`atualizar`/`deletar`
      (`entidade: 'orcamentos'`, `entidadeId`, `estadoNovo` nos updates, `ip`/`userAgent` do ctx).
      NÃO escrever SQL; NÃO reimplementar cálculo de totais.
      Files: `backend/src/services/orcamento.service.ts`
      Verify: `cd backend && npm test -- orcamento.service` — todos os testes do arquivo PASSAM.

- [ ] 3. Garantir build estrito e lint limpos no backend.
      Rodar o compilador TypeScript estrito e o ESLint; corrigir qualquer erro de tipo
      (ex.: imports sem `.js`, campos opcionais com `exactOptional`/`noUncheckedIndexedAccess`).
      Files: nenhum novo (ajustes nos arquivos das etapas 1–2 se necessário).
      Verify: `cd backend && npm run build && npm run lint` — ambos terminam sem erros.

- [ ] 4. Rodar a suíte completa do backend e confirmar que nada regrediu.
      Files: nenhum.
      Verify: `cd backend && npm test` — toda a suíte passa (incluindo os novos testes de orçamento).

## Fora de escopo (não fazer aqui)

- Rotas/HTTP e schemas Zod de orçamento → tarefa 30.
- Wiring em `app.ts` (`criarOrcamentoService`) → acompanha a tarefa 30 (rotas). Pode ser mencionado,
  mas não é exigido pela tarefa 29; não alterar `app.ts` nesta tarefa.
- Versionamento/envio/snapshot → Fase 6 (tarefas 31–33).

## Lacunas e suposições

- A tarefa pede "calcula os totais (via orcamento-calculo) antes de delegar"; como o repositório já o
  faz, assumimos delegação (Decisão 1) para evitar duplicação. Se a revisão exigir o cálculo também no
  service, basta chamar `calcularSubtotal`/`calcularTotal` e comparar/anexar — mas isso contraria o DRY
  e o dono atual do cálculo (repo). Mantida a delegação.
- Ação de auditoria para exclusão: usar `'deletar'` (verbo consistente com `atualizar`/`criar`);
  os vizinhos usam `'desativar'` por serem soft delete, mas orçamento é hard delete de rascunho.
  Os testes aceitam a string escolhida desde que `entidade: 'orcamentos'`.

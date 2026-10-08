# Evidência — Tarefa 34: Serviço de Templates

Fase 7 (Templates). Backend, TDD estrito, rodando diretamente no workspace (sem worktree).
Primeira iteração (não existia `task34-review.json`).

## Arquivos criados

- `backend/src/repositories/template.repository.ts`
- `backend/src/services/template.service.ts`
- `backend/src/repositories/__tests__/template.repository.test.ts`
- `backend/src/services/__tests__/template.service.test.ts`

Nenhuma alteração em `src/types/database.ts` foi necessária: `TemplateTable` e
`TenantTemplateAtivoTable` já estavam declaradas e registradas em `Database`.

## Comportamentos implementados

- `criarPadrao(tenantId)`: cria a versão 1 com `LAYOUT_PADRAO` (shape do seed
  `003_seed_dev.sql`) e ativa o ponteiro `tenants_template_ativo`. Sem auditoria
  (ocorre no bootstrap do tenant, antes de haver contexto de usuário).
- `salvar({ tenantId, layoutJson })`: append-only. Advisory lock transacional por
  tenant → `MAX(versao)` → `+1` → `INSERT` nova linha → upsert do ponteiro ativo
  (`ON CONFLICT (tenant_id) DO UPDATE`). Nunca faz `UPDATE`/`DELETE` em `templates`.
- `buscarAtivo(tenantId)`: join `tenants_template_ativo → templates`, filtrado por
  `tenants_template_ativo.tenant_id`.
- `buscarPorId(tenantId, id)`: filtra por `tenant_id` E `id` (defesa em profundidade).
- Serviço: `salvar` registra auditoria (`acao: 'atualizar'`, `entidade: 'templates'`,
  `entidadeId` = id da nova versão); `buscarAtivo`/`buscarPorId` lançam `AppError(404)`
  quando o repositório retorna `null`.
- DoD (imutabilidade/versionamento): testes garantem que `salvar` após `max=1` insere
  `versao=2` sem tocar na v1 (sem `updateTable`/`deleteFrom` em templates) e que a v1
  segue recuperável via `buscarPorId` — no repositório e no serviço.

## Convenções seguidas

- Factory functions (`criarTemplateRepository({ db })`, `criarTemplateService({ templateRepo, auditoriaService })`).
- Repositório é o único lugar com Kysely; `mapRowTemplate` traduz snake_case ↔ camelCase.
- Versionamento sem race espelhando `gerarNumero` do `orcamento.repository.ts`.
- `layout_json` serializado com `JSON.stringify` (mesmo padrão de `auditoria.repository.ts`).
- Testes de repositório espelham os builders fluentes de `orcamento.repository.test.ts`
  (mesmo mock de transação + executor falso para `sql`).
- ESM Node16 (imports com `.js`), pt-BR em identificadores/comentários, TS estrito.

## Verificação (rodada em `backend/`)

### `npm test -- template` (novos testes)

```
 ✓ src/services/__tests__/template.service.test.ts (10 tests)
 ✓ src/repositories/__tests__/template.repository.test.ts (13 tests)
 Test Files  2 passed (2)
      Tests  23 passed (23)
```

### `npm run build` (tsc)

Sem erros. Exit code 0.

### `npm run lint` (eslint src)

Limpo, sem warnings. Exit code 0.

### `npx prettier --check` (4 arquivos criados)

```
Checking formatting...
All matched files use Prettier code style!
```

(Os dois arquivos de teste foram ajustados com `prettier --write` antes do check final.)

### `npm run test:coverage` (suíte completa)

```
 Test Files  32 passed (32)
      Tests  357 passed (357)
```

Cobertura dos arquivos novos: `template.repository.ts` e `template.service.ts` em
100% (statements/branches/functions/lines) na tabela de cobertura. Mínimo de 80%
do projeto mantido.

## Pendências / fora de escopo

- Rotas e schemas Zod de template: tarefa 35.
- Ligação de `criarPadrao` ao fluxo de criação de tenant (`app.ts`/serviço de tenant):
  não há serviço de criação de tenant no backend hoje (o seed insere direto no SQL);
  o método fica disponível para quem construir esse fluxo.

A tarefa 34 NÃO foi marcada em `tasks.md` e NÃO houve commit (conforme instruções).

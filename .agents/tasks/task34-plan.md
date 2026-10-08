# Plano de Implementação — Tarefa 34: Serviço de Templates

Fase 7 (Templates). Backend, TDD estrito, rodando diretamente no workspace (sem worktree).
Escopo: **repositório + serviço de templates** e seus testes. **NÃO** inclui rotas nem schemas
Zod (tarefa 35, fora do escopo).

## Confirmações da investigação (requirements / design / código)

- **RF-013** (`.kiro/specs/ni-doc-mvp/requirements.md`): cada tenant tem exatamente **um template
  ativo**; ao criar um tenant o sistema cria um **template padrão**; o template pode ser editado a
  qualquer momento; cada alteração **versiona** (auditoria + reprodução fiel de versões antigas de
  orçamento, que referenciam a versão vigente na emissão).
- **RF-014**: editor visual (frontend) — fora do escopo desta tarefa; aqui só o modelo JSON de
  layout trafega como `layout_json` (JSONB).
- **design.md §9.4 (Alteração de Template)**: salvar cria nova versão (`versao = última + 1`),
  atualiza `tenants_template_ativo.template_id`, registra evento em `eventos_auditoria`; versões
  anteriores permanecem **imutáveis**. **ADR-008** confirma append-only por versão.
- **Schema** (migration `001_initial_schema.sql`): `templates(id, tenant_id, versao, layout_json
  JSONB, criado_em, UNIQUE(tenant_id, versao))` e `tenants_template_ativo(tenant_id PK,
  template_id)`. Índice `idx_templates_tenant (tenant_id, versao DESC)`.
- **Database interface** (`src/types/database.ts`): `TemplateTable` e `TenantTemplateAtivoTable`
  **já declaradas** e registradas em `Database` (`templates`, `tenants_template_ativo`).
  `layout_json: unknown`, `versao: number`, `criado_em: GeneratedDate`, `id: Generated<string>`.
  → **Nenhuma alteração em `database.ts` é necessária.**
- **RLS**: isolamento por tenant é feito pelo middleware `tenant.ts` (`set_config('app.current_tenant', ...)`),
  não pelos repositórios. Mesmo assim, seguir o padrão dos repos vizinhos e manter `WHERE tenant_id`
  como defesa em profundidade (`cliente.repository.ts`, `orcamento.repository.ts`).
- **Padrão de teste de repositório**: `cliente.repository.test.ts` **mocka o Kysely com builders
  fluentes** (`makeInsertBuilder`/`makeSelectBuilder`/`makeUpdateBuilder`), sem banco real. Seguir
  exatamente esse padrão; para `salvar` (que usa transação) será preciso mockar
  `db.transaction().execute(cb)` executando o callback com um `trx` mock (ver item 4).
- **Padrão de teste de serviço**: `orcamento.service.test.ts` injeta repositório + `AuditoriaService`
  como mocks `vi.fn()` e verifica delegação, erros `AppError` e chamada de auditoria.
- **Auditoria** (`auditoria.service.ts` + `auditoria.repository.ts`): `registrar(input: CriarEventoInput)`
  com `{ tenantId, usuarioId?, acao, entidade, entidadeId?, estadoAnterior?, estadoNovo?, ip?, userAgent? }`.
- **AppError** (`src/errors/app-error.ts`): `new AppError(statusCode, message, detalhes?)`,
  campo público `statusCode`.
- **Versionamento sem race** — padrão `gerarNumero` em `orcamento.repository.ts`: advisory lock
  transacional (`pg_advisory_xact_lock(hashtext(...))`) + `MAX(...)` + `+1`, tudo dentro de
  `db.transaction().execute`. Reaproveitar essa estratégia para `max(versao)+1`.

## Decisões de design (registradas)

1. **Assinatura das factories (objeto de deps, não posicional).** `criarTemplateRepository({ db })`
   e `criarTemplateService({ templateRepo, auditoriaService })`. Justificativa: o enunciado da
   tarefa pede explicitamente `criarTemplateService({ templateRepo, auditoriaService })`; o
   `orcamento.repository.ts` já usa deps-objeto (`criarOrcamentoRepository({ db })`), então o
   repositório segue o mesmo estilo por consistência com o módulo mais próximo (orçamento), que é
   o vizinho funcional desta fase.

2. **`salvar` é append-only + ponteiro ativo, em transação única.** Dentro de
   `db.transaction().execute`: (a) advisory lock por tenant; (b) `SELECT MAX(versao)` do tenant;
   (c) `INSERT` nova linha com `versao = (max ?? 0) + 1`; (d) **upsert** em `tenants_template_ativo`
   (`INSERT ... ON CONFLICT (tenant_id) DO UPDATE SET template_id = excluded.template_id`).
   Justificativa: garante atomicidade (versão + ponteiro juntos) e serializa a geração de versão por
   tenant sem bloquear outros tenants, espelhando `gerarNumero`. Nunca faz `UPDATE` da linha de
   template existente → imutabilidade (DoD / ADR-008).

3. **`criarTemplatePadrao` cria v1 + ativa, em transação.** Insere `versao = 1` com `layout_json`
   padrão e grava `tenants_template_ativo`. Reaproveita o mesmo caminho interno de `salvar`
   (versão calculada = 1 quando não há template). Justificativa: um único ponto de verdade para
   "inserir versão + ativar". O `layout_json` padrão espelha o shape do seed
   (`003_seed_dev.sql`): `{ formato: 'A4', orientacao: 'retrato', margens, secoes: [...] }`,
   exportado como constante `LAYOUT_PADRAO`.

4. **Auditoria fica no serviço, não no repositório.** `salvar` registra evento após persistir
   (`acao: 'atualizar'`, `entidade: 'templates'`, `entidadeId: <id da nova versão>`), espelhando
   `orcamento.service.ts`. `criarTemplatePadrao` **não** registra auditoria por padrão (ocorre no
   bootstrap de criação de tenant, antes de haver usuário/contexto; o requirement de auditoria
   RF-004 cita "alteração de template", não a criação automática do padrão). Se o chamador tiver
   contexto, a auditoria da criação do tenant cobre o evento. Mantém o serviço simples e alinhado
   ao fluxo §9.4 (auditoria é da *alteração*).

5. **`layout_json` tipado como `unknown` no DB; na borda do domínio usamos um alias `LayoutTemplate = Record<string, unknown>`.**
   Justificativa: o schema real do JSON é definido pelo editor (tarefa 49) e validado por Zod nas
   rotas (tarefa 35); aqui não cabe fixar um shape rígido. O repositório insere o objeto como está
   (o driver `pg`/Kysely serializa JSONB) e retorna `layout_json` como `LayoutTemplate`.

6. **Mapeamento `mapRow*`.** `mapRowTemplate(row): TemplatePublico` traduz snake_case→camelCase
   (`tenant_id`→`tenantId`, `layout_json`→`layoutJson`, `criado_em`→`criadoEm`). `layout_json`
   chega como objeto JS do driver (JSONB) → cast para `LayoutTemplate`.

## Interfaces e assinaturas (contrato)

### `template.repository.ts`

```ts
export type LayoutTemplate = Record<string, unknown>

export const LAYOUT_PADRAO: LayoutTemplate // shape do seed 003 (A4, retrato, margens, secoes)

export interface TemplatePublico {
  id: string
  tenantId: string
  versao: number
  layoutJson: LayoutTemplate
  criadoEm: Date
}

export interface SalvarTemplateInput {
  tenantId: string
  layoutJson: LayoutTemplate
}

export interface TemplateRepository {
  // cria v1 e ativa; usado no bootstrap de criação de tenant
  criarPadrao(tenantId: string): Promise<TemplatePublico>
  // cria nova versão (max+1) e atualiza o ponteiro ativo; append-only
  salvar(input: SalvarTemplateInput): Promise<TemplatePublico>
  // versão atualmente ativa (join via tenants_template_ativo)
  buscarAtivo(tenantId: string): Promise<TemplatePublico | null>
  // versão específica (filtrada por tenant_id — defesa em profundidade)
  buscarPorId(tenantId: string, id: string): Promise<TemplatePublico | null>
}

export function criarTemplateRepository(deps: { db: Kysely<Database> }): TemplateRepository
```

Linha do banco e colunas:

```ts
interface TemplateRow {
  id: string
  tenant_id: string
  versao: number
  layout_json: unknown
  criado_em: Date
}
const COLUNAS_TEMPLATE = ['id', 'tenant_id', 'versao', 'layout_json', 'criado_em'] as const
function mapRowTemplate(row: TemplateRow): TemplatePublico
```

Esboço de versionamento transacional (dentro de `salvar` e reutilizado por `criarPadrao`):

```ts
return db.transaction().execute(async (trx) => {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`.execute(trx)
  const r = await sql<{ max: number | null }>`
    SELECT MAX(versao) AS max FROM templates WHERE tenant_id = ${tenantId}
  `.execute(trx)
  const versao = (r.rows[0]?.max ?? 0) + 1
  const row = await trx.insertInto('templates')
    .values({ tenant_id: tenantId, versao, layout_json: JSON.stringify(layoutJson) /* ou objeto, confirmar no item 2 */ })
    .returning(COLUNAS_TEMPLATE).executeTakeFirstOrThrow()
  await trx.insertInto('tenants_template_ativo')
    .values({ tenant_id: tenantId, template_id: (row as TemplateRow).id })
    .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ template_id: (row as TemplateRow).id }))
    .execute()
  return mapRowTemplate(row as TemplateRow)
})
```

> Nota de implementação (item 2): confirmar durante a codificação se `layout_json` deve ser passado
> como objeto JS ou `JSON.stringify(...)`. `auditoria.repository.ts` usa `JSON.stringify` para
> colunas JSONB; seguir o **mesmo padrão** (string) salvo se um teste de integração provar que o
> driver aceita o objeto diretamente. Decidir pela consistência com o repo vizinho (stringify).

### `template.service.ts`

```ts
export interface TemplateContexto { // espelha OrcamentoContexto
  tenantId: string
  usuarioId: string
  ip?: string
  userAgent?: string
}

export interface TemplateService {
  criarPadrao(tenantId: string): Promise<TemplatePublico>
  salvar(ctx: TemplateContexto, layoutJson: LayoutTemplate): Promise<TemplatePublico>
  buscarAtivo(ctx: TemplateContexto): Promise<TemplatePublico>      // AppError(404) se não houver
  buscarPorId(ctx: TemplateContexto, id: string): Promise<TemplatePublico> // AppError(404) se não existe
}

interface TemplateServiceDeps { templateRepo: TemplateRepository; auditoriaService: AuditoriaService }
export function criarTemplateService(deps: TemplateServiceDeps): TemplateService
```

Comportamento:
- `salvar`: delega `templateRepo.salvar({ tenantId: ctx.tenantId, layoutJson })`, depois
  `auditoriaService.registrar({ tenantId, usuarioId, acao: 'atualizar', entidade: 'templates',
  entidadeId: template.id, estadoNovo: { versao }, ip, userAgent })`.
- `buscarAtivo`: `AppError(404, 'Template não encontrado')` se o repo retornar `null`.
- `buscarPorId`: `AppError(404, 'Template não encontrado')` se `null`.
- `criarPadrao`: delega ao repo (sem auditoria — ver decisão 4).

## Itens do plano (ordenados por dependência)

- [ ] 1. Escrever os testes do repositório (TDD, vermelho primeiro) em
      `backend/src/repositories/__tests__/template.repository.test.ts`, espelhando os helpers de
      mock fluente de `cliente.repository.test.ts` e o mock de transação necessário para `salvar`
      (ver item 4). Casos: ver seção "Casos de teste". Importar de `../template.repository.js`.
      Files: `backend/src/repositories/__tests__/template.repository.test.ts`
      Verify: `cd backend && npm test -- template.repository` — testes **falham** por módulo
      inexistente (vermelho esperado do TDD).

- [ ] 2. Implementar `backend/src/repositories/template.repository.ts` com as interfaces/mapRow/
      `LAYOUT_PADRAO` acima. `criarPadrao` e `salvar` compartilham o helper transacional
      (advisory lock + MAX+1 + insert + upsert do ponteiro ativo). `buscarAtivo` faz `innerJoin`
      de `tenants_template_ativo` com `templates` filtrando por `tenant_id`. `buscarPorId` filtra
      por `tenant_id` e `id`. Imports relativos com extensão `.js`.
      Files: `backend/src/repositories/template.repository.ts`
      Verify: `cd backend && npm test -- template.repository` — todos os testes do item 1 passam.

- [ ] 3. Escrever os testes do serviço (TDD) em
      `backend/src/services/__tests__/template.service.test.ts`, espelhando
      `orcamento.service.test.ts` (mocks `vi.fn()` de `TemplateRepository` e `AuditoriaService`).
      Casos: ver seção "Casos de teste". Importar de `../template.service.js`.
      Files: `backend/src/services/__tests__/template.service.test.ts`
      Verify: `cd backend && npm test -- template.service` — testes **falham** (vermelho esperado).

- [ ] 4. Implementar `backend/src/services/template.service.ts` conforme o contrato acima
      (delegação ao repo, auditoria em `salvar`, `AppError(404)` em `buscarAtivo`/`buscarPorId`).
      Imports com extensão `.js`.
      Files: `backend/src/services/template.service.ts`
      Verify: `cd backend && npm test -- template.service` — todos os testes do item 3 passam.

- [ ] 5. Verificação final do módulo e do pacote: build TypeScript estrito, lint, formatação e
      suíte completa com cobertura (mínimo 80%).
      Files: nenhum (ou pequenos ajustes de lint/format nos arquivos criados).
      Verify, na pasta `backend/`:
      - `npm run build` — `tsc` sem erros (checa `strict`, `noUncheckedIndexedAccess`).
      - `npm run lint` — ESLint limpo.
      - `npx prettier --check src/repositories/template.repository.ts src/services/template.service.ts src/repositories/__tests__/template.repository.test.ts src/services/__tests__/template.service.test.ts`
        — sem diferenças (aspas simples, sem `;`, indent 2, trailing commas all, width 100).
      - `npm run test:coverage` — toda a suíte verde; cobertura dos novos arquivos ≥ 80%.

- [ ] 6. Fechar a tarefa: em `.kiro/specs/ni-doc-mvp/tasks.md`, marcar o item 34 de `[~]` para
      `[x]` (somente após o item 5 passar inteiro). Não alterar outras tarefas.
      Files: `.kiro/specs/ni-doc-mvp/tasks.md`
      Verify: inspeção visual — apenas a linha da tarefa 34 muda para `[x]`.

## Casos de teste

### Repositório (`template.repository.test.ts`)

Mocks fluentes como em `cliente.repository.test.ts`. Para `salvar`/`criarPadrao`, mockar
`db.transaction` retornando `{ execute: (cb) => cb(trxMock) }`, onde `trxMock` expõe
`insertInto` (builder com `values`/`returning`/`onConflict`/`execute`/`executeTakeFirstOrThrow`) e
é usado por `sql\`...\`.execute(trx)`. Para o `MAX(versao)`, mockar o retorno de
`sql.execute(trx)` como `{ rows: [{ max: <n|null> }] }` (seguir como `orcamento.repository.test.ts`
lida com `sql`, se existir mock lá; caso não exista teste de `gerarNumero`, mockar `execute` do
objeto compilado — manter padrão de builders fluentes e **não** inventar banco real).

- `criarPadrao()`:
  - insere `versao = 1` com `layout_json = LAYOUT_PADRAO` quando não há templates (`max = null`).
  - grava o ponteiro em `tenants_template_ativo` com o `template_id` da linha criada.
  - retorna `TemplatePublico` com `layoutJson` mapeado (camelCase) e `versao = 1`.
- `salvar()`:
  - calcula `versao = max + 1` (ex.: `max = 3` → insere `versao = 4`); **não** faz `UPDATE` em
    linha existente (verificar que só `insertInto('templates')` é chamado, nunca `updateTable`).
  - faz upsert do ponteiro ativo (`onConflict` em `tenant_id`) para o novo `template_id`.
  - passa `tenant_id` do input no insert (isolamento).
  - retorna `TemplatePublico` com a nova `versao` e `layoutJson` recebido.
- `buscarAtivo()`:
  - retorna `null` quando não há ponteiro/linha.
  - retorna a versão ativa (join `tenants_template_ativo`→`templates`) filtrando por `tenant_id`.
- `buscarPorId()`:
  - retorna `null` quando não existe.
  - retorna a versão específica, com `where('tenant_id', ...)` **e** `where('id', ...)`.
- **DoD — imutabilidade/versionamento**: após `salvar` com `max = 1`, a chamada insere `versao = 2`
  e **nunca** altera/apaga a `versao = 1` (assertar ausência de `updateTable('templates')` e
  `deleteFrom('templates')`); `buscarPorId` da v1 continua recuperável (mock retorna a linha v1).

### Serviço (`template.service.test.ts`)

Mocks `vi.fn()` de `TemplateRepository` e `AuditoriaService`; `ctx = { tenantId, usuarioId }`.

- `criarPadrao()`:
  - delega a `templateRepo.criarPadrao(tenantId)` e retorna o resultado.
  - **não** chama `auditoriaService.registrar` (decisão 4).
- `salvar()`:
  - delega a `templateRepo.salvar({ tenantId, layoutJson })` com o layout informado.
  - registra auditoria com `acao: 'atualizar'`, `entidade: 'templates'`,
    `entidadeId` = `id` da nova versão (`expect.objectContaining`).
  - retorna o `TemplatePublico` do repo.
- `buscarAtivo()`:
  - retorna o template quando o repo devolve um valor; delega `buscarAtivo(tenantId)`.
  - lança `AppError(404)` quando o repo devolve `null` (`rejects.toMatchObject({ statusCode: 404 })`).
- `buscarPorId()`:
  - retorna o template e delega `buscarPorId(tenantId, id)`.
  - lança `AppError(404)` quando `null`.
- **DoD — versionamento visível no serviço**: ao `salvar` duas vezes (mock do repo devolvendo
  `versao: 1` e depois `versao: 2`), o serviço repassa ambas e audita cada salvamento; a v1
  permanece acessível via `buscarPorId` (mock), confirmando que salvar não a sobrescreve.

## Lacunas / premissas

- **Fluxo de criação de tenant**: `criarTemplatePadrao` deve ser chamado quando um tenant é criado.
  Não há hoje um serviço de criação de tenant no backend (o seed insere direto no SQL). A **ligação**
  (`app.ts`/serviço de tenant chamando `templateService.criarPadrao`) está **fora do escopo** desta
  tarefa (que entrega repo+service+testes); o método fica disponível para quem criar o fluxo de
  tenant. Premissa aceita; registrar em `findings` para a tarefa seguinte.
- **Serialização de `layout_json` (objeto vs `JSON.stringify`)**: resolver na implementação seguindo
  o padrão de `auditoria.repository.ts` (stringify). Os testes mockam o builder, então não dependem
  da escolha; a verificação real é o build + eventual teste de integração futuro.
- **Formato exato do `LAYOUT_PADRAO`**: adotado o shape do seed `003_seed_dev.sql`
  (`formato`/`orientacao`/`margens`/`secoes`), que é o padrão já aceito pelo projeto.

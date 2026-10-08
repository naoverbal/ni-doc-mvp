# Implementation Plan — Tarefa 32: Serviço de versionamento

Criar o serviço de versionamento (`enviar`) que transforma um orçamento `rascunho`
em uma versão imutável enviada: monta o snapshot (via snapshot service da tarefa 31),
persiste uma nova versão sequencial em `orcamento_versoes` com token público único,
muda o status do orçamento para `enviado`, invalida o aceite anterior (ao reenviar) e
registra auditoria. **PDF fora de escopo** (tarefa 40): `pdf_path`/`pdf_hash` ficam nulos.

Requisitos: RF-008, RF-009. Fluxo de referência: design seção 9.2 (Enviar Orçamento).
Trabalho direto no workspace (sem worktree). **NÃO** implementar a rota de envio (tarefa 33).

## Contexto confirmado no código (leitura obrigatória antes de implementar)

- `backend/src/services/snapshot.service.ts` — `criarSnapshotService(): SnapshotService`
  com `montar(input: MontarSnapshotInput): OrcamentoSnapshot`. `MontarSnapshotInput` =
  `{ orcamento: OrcamentoComItens; cliente: ClientePublico; empresaCliente?: EmpresaPublica | null; responsaveisPorId: Map<string, ResponsavelPublico> }`.
  O serviço é PURO: o chamador (este serviço) resolve cliente, empresa e responsáveis.
- `backend/src/lib/token.ts` — `gerarTokenPublico(versaoId: string): string` retorna
  `uuid.hmac`, com o HMAC vinculado ao `versaoId`. **Implicação de design (ver decisão 3):**
  o `id` da versão precisa existir ANTES de gerar o token.
- `backend/src/errors/app-error.ts` — `new AppError(statusCode, message, detalhes?)`.
- `backend/src/repositories/orcamento.repository.ts` — `OrcamentoComItens` (campos
  `status: OrcamentoStatus`, `versaoAtual: number`, `itens: OrcamentoItemPublico[]`,
  cada item com `responsavelId: string | null`), `buscarPorId(tenantId, id)`.
- `backend/src/repositories/{cliente,empresa,responsavel}.repository.ts` — todos expõem
  `buscarPorId(tenantId, id): Promise<...Publico | null>`.
- `backend/src/services/auditoria.service.ts` — `registrar(input: CriarEventoInput)`
  com `{ tenantId, usuarioId?, acao, entidade, entidadeId?, estadoNovo?, ip?, userAgent? }`.
- `backend/src/services/orcamento.service.ts` — padrão de status codes a seguir:
  **400** para regra de entrada inválida (ex.: sem itens); **409** para conflito de estado
  (status != `rascunho`). Já usado em `atualizar`/`deletar`.
- Schema (`001_initial_schema.sql`): `orcamento_versoes` tem `template_id UUID NOT NULL
  REFERENCES templates(id)`, `token_publico VARCHAR(128) NOT NULL UNIQUE`,
  `UNIQUE (orcamento_id, versao)`, `pdf_path`/`pdf_hash` nuláveis. `orcamento_aceites`
  tem `UNIQUE (versao_id)` e `ON DELETE CASCADE` por `versao_id`.
  `tenants_template_ativo (tenant_id PK, template_id NOT NULL)` já existe e é populado no seed.
- Testes de serviço: mock dos repositórios/serviços via `vi.fn()` (ver
  `orcamento.service.test.ts`). Testes de repositório: mocks fluentes do Kysely + mock de
  `db.transaction().execute(cb => cb(trx))` (ver `orcamento.repository.test.ts`).

## Decisões de design (registradas aqui; não é documento de design)

1. **Novo repositório `orcamento-versao.repository.ts` (infra mínima que o serviço exige).**
   Não existe repositório de versões. O repositório de orçamento não cobre
   `orcamento_versoes`/`orcamento_aceites`. Criar um repositório novo seguindo o padrão
   do projeto (factory `criar*`, `mapRow*`, queries Kysely, snake_case↔camelCase). Assinatura
   da factory: `criarOrcamentoVersaoRepository({ db })` (objeto), igual a
   `criarOrcamentoRepository`. Mantém SQL fora do serviço (regra de camadas).

2. **`template_id` resolvido de `tenants_template_ativo`, não do módulo de template.**
   A coluna é `NOT NULL`, mas o módulo de template (tarefa 34) ainda não existe. Para não
   exceder o escopo, o repositório de versão lê o `template_id` ativo diretamente de
   `tenants_template_ativo` por `tenant_id` (query mínima, dona do SQL no repositório). Se não
   houver template ativo, lançar `AppError(409, 'Tenant não possui template ativo')` — estado
   inconsistente que impede o envio. (Quando a tarefa 34 existir, essa leitura pode migrar para
   o template service sem mudar o contrato do serviço de versionamento.)

3. **Ordem token↔versão: gerar o `id` da versão no app antes do token.**
   `gerarTokenPublico` vincula o HMAC ao `versaoId`. Para evitar insert+update em duas etapas,
   o repositório gera `const versaoId = randomUUID()` (de `node:crypto`), chama
   `gerarTokenPublico(versaoId)` e insere a linha já com `id = versaoId` e `token_publico`
   definidos. Isso garante token único por versão e HMAC válido para o id persistido.
   **Decisão de camada:** a geração de token acontece no **repositório**, junto do insert, porque
   depende do `id` gerado ali e deve ocorrer na mesma transação; o serviço orquestra, o
   repositório persiste. (Alternativa — serviço gera id+token e passa ao repo — também é válida;
   escolhida a primeira por manter `randomUUID`/token colados ao insert atômico. Implementador:
   seguir esta.)

4. **Versionamento sequencial derivado de `orcamento_versoes`, não só de `versao_atual`.**
   A próxima versão é `MAX(versao) + 1` por `orcamento_id` (0 → v1 no primeiro envio), lido
   dentro da transação com advisory lock por `orcamento_id` (mesmo padrão anti-race de
   `gerarNumero` em `orcamento.repository.ts`). O `UNIQUE (orcamento_id, versao)` é a rede de
   segurança. `orcamentos.versao_atual` é atualizado para N em conjunto (consistência com o
   design 9.2.g).

5. **Transação única no repositório para o envio.** `criarVersaoEnviar` executa em uma
   `db.transaction()`: (a) advisory lock + cálculo da próxima versão; (b) resolve `template_id`
   ativo; (c) invalida o aceite anterior; (d) insere a versão; (e) atualiza o orçamento
   (`status='enviado'`, `versao_atual=N`, `atualizado_em=now`). Atomicidade: ou tudo é
   persistido, ou nada (RF-008/RF-009). A auditoria é registrada **pelo serviço, após** o commit
   (segue o padrão dos outros serviços, que auditam fora da transação do repositório).

6. **Invalidação do aceite anterior = DELETE do aceite da versão anterior.**
   `orcamento_aceites` tem `UNIQUE (versao_id)` e cada aceite referencia uma `versao_id`. Como
   cada nova versão tem `versao_id` novo, um aceite antigo fica ligado à versão antiga. "Invalidar
   o aceite anterior" ao reenviar significa remover o aceite da(s) versão(ões) anterior(es) do
   mesmo orçamento, para que um orçamento reenviado não seja tratado como já aprovado. Implementação:
   `DELETE FROM orcamento_aceites WHERE versao_id IN (SELECT id FROM orcamento_versoes WHERE orcamento_id = ?)`.
   No primeiro envio não há aceite — o delete é no-op. (Decisão: DELETE, não soft-flag, pois a
   tabela não possui coluna de status/invalidado e o aceite válido corrente é sempre o da última
   versão enviada.)

7. **Contexto do serviço idêntico ao `OrcamentoContexto`.** Reusar a forma
   `{ tenantId, usuarioId, ip?, userAgent? }` (definida em `orcamento.service.ts`). O serviço de
   versionamento define seu próprio `VersionamentoContexto` com os mesmos campos (sem importar o
   do orçamento, para não acoplar), ou importa — escolha: **definir local** `VersionamentoContexto`
   para manter o módulo autossuficiente.

8. **Status codes confirmados.** `enviar`:
   - orçamento inexistente → `AppError(404, 'Orçamento não encontrado')` (igual a
     `orcamento.service.buscarPorId`).
   - status != `rascunho` (já `enviado`/`aprovado`/etc.) → `AppError(409, ...)` (igual à regra de
     `atualizar`/`deletar`, que usam 409 para "só rascunho").
   - rascunho sem itens → `AppError(400, 'Orçamento deve ter ao menos um item')` (igual à mensagem
     de `orcamento.service.criar`).
   - sem template ativo → `AppError(409, ...)` (decisão 2).

## Contrato público do serviço (a ser exportado)

Em `backend/src/services/versionamento.service.ts`:

```ts
export interface VersionamentoContexto {
  tenantId: string
  usuarioId: string
  ip?: string
  userAgent?: string
}

export interface VersaoEnviada {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  templateId: string
  pdfPath: string | null   // sempre null nesta tarefa
  pdfHash: string | null   // sempre null nesta tarefa
  enviadoEm: Date
  expiraEm: Date | null
}

export interface VersionamentoService {
  enviar(ctx: VersionamentoContexto, orcamentoId: string): Promise<VersaoEnviada>
}

export function criarVersionamentoService(deps: {
  orcamentoRepo: OrcamentoRepository
  orcamentoVersaoRepo: OrcamentoVersaoRepository
  clienteRepo: ClienteRepository
  empresaRepo: EmpresaRepository
  responsavelRepo: ResponsavelRepository
  snapshotService: SnapshotService
  auditoriaService: AuditoriaService
}): VersionamentoService
```

Em `backend/src/repositories/orcamento-versao.repository.ts`:

```ts
export interface CriarVersaoEnviarInput {
  tenantId: string
  orcamentoId: string
  snapshot: unknown            // OrcamentoSnapshot serializável em JSONB
  expiraEm?: Date | null       // derivado de validadeDias; pode ser null no MVP
}
export interface OrcamentoVersaoPublica {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  templateId: string
  pdfPath: string | null
  pdfHash: string | null
  enviadoEm: Date
  expiraEm: Date | null
}
export interface OrcamentoVersaoRepository {
  criarVersaoEnviar(input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica>
}
export function criarOrcamentoVersaoRepository(deps: { db: Kysely<Database> }): OrcamentoVersaoRepository
```

> Nota sobre `expira_em`: a coluna é `TIMESTAMPTZ NULL`. Derivar de `data_emissao + validade_dias`
> é possível, mas o design 9.2 não exige o cálculo nesta etapa e `orcamento_versoes` não guarda
> `validade_dias`. **Decisão:** no MVP desta tarefa, inserir `expira_em = null` (não bloqueia o
> fluxo nem a tarefa 42, que trata expiração). Deixar o campo no contrato para evolução.

## Comandos de verificação (rodar de `/Users/nilson/Dev/ni-doc/backend`)

- `npm run test -- --run src/services/__tests__/versionamento.service.test.ts`
- `npm run test -- --run src/repositories/__tests__/orcamento-versao.repository.test.ts`
- `npm run test:coverage` (serviço ≥ 80%)
- `npm run build`
- `npm run lint`

## Ciclo TDD — itens ordenados por dependência

- [ ] 1. (RED) Escrever os testes do serviço de versionamento.
      Criar `src/services/__tests__/versionamento.service.test.ts` importando
      `criarVersionamentoService` de `../versionamento.service.js` e os tipos reais com
      `import type` (`.js`): `OrcamentoRepository`/`OrcamentoComItens`/`OrcamentoStatus`,
      `OrcamentoVersaoRepository`/`OrcamentoVersaoPublica`, `ClienteRepository`,
      `EmpresaRepository`, `ResponsavelRepository`, `SnapshotService`, `AuditoriaService`.
      Montar `makeDeps()` com todos os repos/serviços mockados por `vi.fn()` (padrão de
      `orcamento.service.test.ts`), fixtures de orçamento com itens, e um
      `orcamentoVersaoRepo.criarVersaoEnviar` que resolve uma `OrcamentoVersaoPublica` fake.
      Casos a cobrir (todos devem falhar por módulo inexistente):
      1. **envia rascunho com itens:** chama `clienteRepo.buscarPorId`, resolve responsáveis
         únicos dos itens (um `responsavelRepo.buscarPorId` por id distinto, ids nulos ignorados),
         chama `empresaRepo.buscarPorId` só quando `empresaClienteId != null`, chama
         `snapshotService.montar` com o `responsaveisPorId` montado, e delega a persistência a
         `orcamentoVersaoRepo.criarVersaoEnviar` com `{ tenantId, orcamentoId, snapshot }`;
         retorna a `VersaoEnviada` com `pdfPath`/`pdfHash` nulos.
      2. **404** quando `orcamentoRepo.buscarPorId` resolve `null`.
      3. **409** quando status != `rascunho` (ex.: `enviado`, `aprovado`) — e
         `criarVersaoEnviar` **não** é chamado.
      4. **400** quando o rascunho não tem itens (`itens: []`) — e `criarVersaoEnviar` não é chamado.
      5. **auditoria:** `auditoriaService.registrar` chamado com
         `{ acao: 'enviar', entidade: 'orcamentos', entidadeId: orcamentoId }` (e `usuarioId`/`ip`/
         `userAgent` do contexto) após a persistência.
      6. **snapshot recebe empresa `null`** quando `empresaClienteId` é `null` (empresaRepo não é
         chamado) e empresa resolvida quando presente.
      7. **responsáveis distintos:** itens com `responsavelId` repetido não geram buscas duplicadas
         (assertar nº de chamadas de `responsavelRepo.buscarPorId`); id ausente no banco não quebra
         (resolve `null` → não entra no Map).
      Files: src/services/__tests__/versionamento.service.test.ts
      Verify: `npm run test -- --run src/services/__tests__/versionamento.service.test.ts` falha
      (módulo `../versionamento.service.js` inexistente) — RED esperado.

- [ ] 2. (RED) Escrever os testes do repositório de versão.
      Criar `src/repositories/__tests__/orcamento-versao.repository.test.ts` seguindo o padrão
      mock-fluente de `orcamento.repository.test.ts` (builders de insert/select/update/delete e
      `makeTrx`/`makeDbComTransacao` com executor falso para o `sql` cru do advisory lock + MAX).
      Casos:
      1. **primeiro envio cria v1:** `MAX(versao)` resolve `null` → insere `versao = 1`;
         assert `insertInto('orcamento_versoes')`, `updateTable('orcamentos')` com
         `{ status: 'enviado', versao_atual: 1 }`, e que a transação foi usada.
      2. **envio subsequente cria v(N+1):** `MAX(versao)` resolve `3` → insere `versao = 4` e
         `versao_atual = 4`.
      3. **token único e válido:** `token_publico` inserido tem o formato `uuid.hmac` e
         `validarTokenPublico(token, id)` é `true` para o `id` inserido (importar
         `validarTokenPublico` de `../../lib/token.js`; definir `SESSION_SECRET` no teste —
         conferir `src/__tests__/setup.ts`/`vitest.config.ts` e, se necessário, setar
         `process.env.SESSION_SECRET` no `beforeAll`).
      4. **template_id ativo:** o SELECT em `tenants_template_ativo` por `tenant_id` é usado e o
         `template_id` resolvido vai para o insert; quando o select resolve `undefined`, lança
         `AppError(409, ...)`.
      5. **invalida aceite anterior:** `deleteFrom('orcamento_aceites')` é chamado com o filtro por
         `versao_id IN (versões do orçamento)` dentro da transação.
      6. **pdf nulo:** o insert envia `pdf_path: null`, `pdf_hash: null`.
      7. **anti-race (asserção de design):** os SQLs crus executados são, em ordem, advisory lock e
         depois `MAX` (igual ao teste de numeração do orçamento).
      Files: src/repositories/__tests__/orcamento-versao.repository.test.ts
      Verify: `npm run test -- --run src/repositories/__tests__/orcamento-versao.repository.test.ts`
      falha (módulo inexistente) — RED esperado.

- [ ] 3. (GREEN) Implementar o repositório de versão.
      Criar `src/repositories/orcamento-versao.repository.ts` seguindo as decisões 2–6:
      factory `criarOrcamentoVersaoRepository({ db })`, interfaces exportadas (`CriarVersaoEnviarInput`,
      `OrcamentoVersaoPublica`, `OrcamentoVersaoRepository`), `mapRow*` snake_case↔camelCase e
      `COLUNAS_VERSAO`. `criarVersaoEnviar` roda em `db.transaction().execute(async (trx) => {...})`:
      (a) `pg_advisory_xact_lock(hashtext(orcamentoId))` + `SELECT MAX(versao) ... WHERE orcamento_id = ?`
      via `sql`...`.execute(trx)`; `proximaVersao = (max ?? 0) + 1`; (b)
      `SELECT template_id FROM tenants_template_ativo WHERE tenant_id = ?` → se ausente,
      `throw new AppError(409, 'Tenant não possui template ativo')`; (c)
      `DELETE FROM orcamento_aceites WHERE versao_id IN (SELECT id FROM orcamento_versoes WHERE orcamento_id = ?)`;
      (d) `const versaoId = randomUUID()` (`node:crypto`), `const tokenPublico = gerarTokenPublico(versaoId)`
      (de `../lib/token.js`), insert em `orcamento_versoes` com `id: versaoId`, `orcamento_id`,
      `versao: proximaVersao`, `snapshot` (passar o objeto — Kysely/pg serializa JSONB; conferir se
      precisa `JSON.stringify` como em `auditoria.repository.ts` e seguir o que o build/driver aceitar),
      `template_id`, `pdf_path: null`, `pdf_hash: null`, `token_publico: tokenPublico`,
      `expira_em: input.expiraEm ?? null`, retornando `COLUNAS_VERSAO`; (e)
      `updateTable('orcamentos').set({ status: 'enviado', versao_atual: proximaVersao, atualizado_em: new Date() }).where('tenant_id','=',tenantId).where('id','=',orcamentoId)`.
      Retornar `mapRowVersao(row)`. Respeitar `noUncheckedIndexedAccess`, ESM `.js`, Prettier
      (aspas simples, sem `;`, 2 espaços, trailing comma all, width 100), nomes/comentários pt-BR.
      Files: src/repositories/orcamento-versao.repository.ts
      Verify: `npm run test -- --run src/repositories/__tests__/orcamento-versao.repository.test.ts`
      — todos os testes passam (GREEN).

- [ ] 4. (GREEN) Implementar o serviço de versionamento.
      Criar `src/services/versionamento.service.ts` com o contrato público acima. `enviar`:
      1. `const orcamento = await orcamentoRepo.buscarPorId(ctx.tenantId, orcamentoId)`; se `null` →
         `AppError(404, 'Orçamento não encontrado')`.
      2. se `orcamento.status !== 'rascunho'` → `AppError(409, 'Só é possível enviar orçamentos em rascunho')`.
      3. se `orcamento.itens.length === 0` → `AppError(400, 'Orçamento deve ter ao menos um item')`.
      4. `const cliente = await clienteRepo.buscarPorId(ctx.tenantId, orcamento.clienteId)`; se `null`
         → `AppError(409, 'Cliente do orçamento não encontrado')` (defesa; dados vivos exigidos pelo
         snapshot).
      5. `empresaCliente`: só busca quando `orcamento.empresaClienteId != null`; resultado `null` é aceitável.
      6. responsáveis: coletar ids distintos não-nulos de `orcamento.itens`, buscar cada um via
         `responsavelRepo.buscarPorId`, montar `Map<string, ResponsavelPublico>` apenas com os
         encontrados (ids ausentes → não entram; o snapshot trata como `null`).
      7. `const snapshot = snapshotService.montar({ orcamento, cliente, empresaCliente, responsaveisPorId })`.
      8. `const versao = await orcamentoVersaoRepo.criarVersaoEnviar({ tenantId: ctx.tenantId, orcamentoId, snapshot, expiraEm: null })`.
      9. `await auditoriaService.registrar({ tenantId: ctx.tenantId, usuarioId: ctx.usuarioId, acao: 'enviar', entidade: 'orcamentos', entidadeId: orcamentoId, ip: ctx.ip, userAgent: ctx.userAgent })`.
      10. retornar `VersaoEnviada` a partir de `versao` (pdf nulos).
      `import type` dos repos/serviços com `.js`. Mesmas regras de estilo/ESM/pt-BR.
      Files: src/services/versionamento.service.ts
      Verify: `npm run test -- --run src/services/__tests__/versionamento.service.test.ts` — passa (GREEN).

- [ ] 5. (Wiring opcional — confirmar necessidade) Compor o serviço em `app.ts`.
      A tarefa 32 pede só o serviço + testes; a rota de envio é a tarefa 33. **Decisão:** NÃO
      registrar rota aqui. Compor o `versionamentoService` em `app.ts` é opcional e de baixo risco;
      como a tarefa 33 fará o wiring junto da rota, **não** alterar `app.ts` nesta tarefa para manter
      o escopo mínimo (evita wiring órfão sem rota). Se o revisor exigir composição antecipada,
      adicionar as factories em `app.ts` seguindo o padrão existente (criar `orcamentoVersaoRepo`,
      `snapshotService`, e `versionamentoService` com todas as deps) sem expor rota.
      Files: (nenhum por padrão)
      Verify: `npm run build` continua compilando.

- [ ] 6. (Refactor + verificação final) Build, lint e cobertura.
      Rodar `npm run format` se o lint/prettier apontar; garantir tipos estritos
      (`noUncheckedIndexedAccess` ao ler `rows[0]`, `.get()` do Map, `select` possivelmente
      `undefined`). Conferir cobertura do serviço ≥ 80%.
      Files: (ajustes de formatação, se necessário)
      Verify: de `/Users/nilson/Dev/ni-doc/backend`: `npm run build` sem erros; `npm run lint` ok;
      `npm run test:coverage` com os dois novos arquivos passando e cobertura do serviço ≥ 80%.

- [ ] 7. Fechar a tarefa em `tasks.md`.
      Após verde total (passos 1–6), mudar o item 32 de `[~]` para `[x]` em
      `.kiro/specs/ni-doc-mvp/tasks.md` (apenas o item 32).
      Files: .kiro/specs/ni-doc-mvp/tasks.md
      Verify: o item 32 aparece como `[x]`; nenhum outro item alterado.

## NÃO fazer
- Não gerar PDF nem preencher `pdf_path`/`pdf_hash` (tarefa 40).
- Não implementar a rota `POST /:id/enviar` (tarefa 33).
- Não criar o módulo de template (tarefa 34); apenas ler `tenants_template_ativo`.
- Não criar migration (schema de `orcamento_versoes`/`orcamento_aceites` já existe).
- Não alterar interfaces existentes de repositórios/serviços (importar com `import type`).
- Não exceder o escopo: só `versionamento.service.ts`, `orcamento-versao.repository.ts` e seus testes.

## Riscos / lacunas assumidas
- **Serialização JSONB do `snapshot`:** o driver `pg`/Kysely pode exigir `JSON.stringify` (como em
  `auditoria.repository.ts`) ou aceitar o objeto direto para coluna `JSONB`. Assumir o padrão já
  usado no projeto (stringify) se o build/types reclamarem; validar no passo 3.
- **`template_id` em ambiente sem seed:** se um tenant não tiver `tenants_template_ativo`, o envio
  falha com 409 (decisão 2). Em testes, mockar o select para retornar um `template_id`.
- **`expira_em` nulo** no MVP desta tarefa (decisão/ nota de contrato); cálculo de expiração não é
  requisito de RF-008/RF-009 aqui.

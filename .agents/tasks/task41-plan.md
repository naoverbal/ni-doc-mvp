# Implementation Plan — Tarefa 41: Serviço de Aceite (Fase 9)

Backend TypeScript ESM (Node 22, Express 5, Kysely/PostgreSQL 16, Zod, Vitest).
Trabalho feito DIRETAMENTE em `/Users/nilson/Dev/ni-doc/backend` (sem worktree).
Ciclo TDD obrigatório: escrever o teste → vê-lo falhar → implementar → vê-lo
passar → refatorar. Escopo: APENAS o serviço de aceite, o acesso a dados que ele
exige e seus testes. NÃO implementar rotas públicas (tarefa 42) nem a rota de
aceite manual (tarefa 43).

Requisitos cobertos: RF-019 (aprovação do cliente), RF-020 (aceite manual),
RF-021 (comprovante de aceite). DoD: evidências registradas (IP, UA, hash,
método), comprovante PDF gerado, auditoria registrada.

---

## Decisões de design (contexto, não re-arquitetura)

Fatos verificados no código, não suposições:

- **Tabela `orcamento_aceites`** (migration `001_initial_schema.sql`, e tipo
  `OrcamentoAceiteTable` já registrado em `src/types/database.ts`):
  `id` UUID PK · `versao_id` UUID NOT NULL FK→`orcamento_versoes` ON DELETE
  CASCADE · `metodo` VARCHAR(20) CHECK IN (`'cliente'`,`'operador'`) ·
  `usuario_id` UUID NULL FK→`usuarios` · `ip` VARCHAR(45) NULL · `user_agent`
  TEXT NULL · `hash_documento` CHAR(64) NOT NULL · `justificativa` TEXT NULL ·
  `criado_em` TIMESTAMPTZ default NOW · **`UNIQUE (versao_id)`** (um aceite por
  versão — a rede de segurança contra aceite duplicado no nível do banco).

- **Precisa criar o repositório de aceite?** Sim.
  `src/repositories/orcamento-aceite.repository.ts` não existe. Será criado com
  interface + factory `criarOrcamentoAceiteRepository({ db })`, seguindo o padrão
  dos vizinhos (`orcamento-versao.repository.ts`, `auditoria.repository.ts`):
  SQL isolado no repositório, `mapRow*` traduzindo snake_case↔camelCase.

- **Como `aprovarViaCliente` localiza a versão a partir do token.** O token tem
  formato `uuid.hmac` (`src/lib/token.ts`), onde o HMAC liga um UUID **aleatório**
  (não o id da versão) ao `versaoId`. Logo o serviço NÃO consegue derivar o
  `versaoId` do token: ele precisa **buscar a versão por `token_publico`**
  (coluna `UNIQUE`, com índice `idx_versoes_token`) e só então validar o HMAC com
  `validarTokenPublico(token, versao.id)`. Por isso o `orcamento-versao.repository`
  ganha um método de leitura `buscarPorToken`. Mensagem de erro genérica em
  qualquer falha de token (RF-019.7).

- **Hash do documento registrado no aceite.** É o `pdf_hash` da versão (SHA-256
  dos bytes do PDF emitido, calculado na Fase 8 e persistido em
  `orcamento_versoes.pdf_hash`). RF-017.3 manda usar o hash para validar
  integridade no momento do aceite; o aceite grava esse mesmo hash em
  `hash_documento`. **Não** se usa `crypto.ts#hashDocumento` (esse normaliza
  pontuação de CPF/CNPJ, não serve para bytes de PDF — ver comentário em
  `pdf.service.ts`). Se a versão não tiver `pdf_hash` (nulo), é estado inválido
  para aceite → `AppError(409)`.

- **Mudança de status do orçamento → `aprovado`.** Hoje a única mutação de status
  vive na transação de `criarVersaoEnviar`. O aceite precisa marcar
  `orcamentos.status = 'aprovado'`. Decisão: adicionar
  `aprovarAceite({ tenantId, versaoId, metodo, usuarioId?, ip?, userAgent?, hashDocumento, justificativa? })`
  ao **`orcamento-aceite.repository`**, executando em UMA transação: (1) relê a
  versão + o orçamento (travando contra corrida), (2) rejeita se já houver aceite
  para a versão OU se o orçamento já estiver `aprovado` (duplicado → 409),
  (3) insere a linha em `orcamento_aceites`, (4) `UPDATE orcamentos SET status =
  'aprovado'` filtrando por `tenant_id`. Mantém SQL fora do serviço e garante
  atomicidade (sem aceite órfão nem status divergente). O `UNIQUE(versao_id)` é a
  rede final: um INSERT concorrente duplicado estoura e a transação reverte.

- **Comprovante PDF (RF-021).** Reutiliza a geração da Fase 8. Decisão de MVP:
  renderizar um HTML de comprovante com `htmlRenderer`? Não — o `html-renderer`
  é específico do layout de orçamento. Em vez disso o serviço monta um HTML de
  comprovante simples e determinístico (helper privado `montarHtmlComprovante`)
  contendo os campos exigidos por RF-021.2 (número do orçamento, versão,
  data/hora, IP, user agent, hash do documento, método de aceite) e delega ao
  `pdfService.gerarPdf({ html, numero, versao })`. Para o nome de arquivo não
  colidir com o PDF do orçamento (`{numero}-v{versao}.pdf`), o comprovante usa um
  sufixo no `numero`: `numero: `${numero}-aceite``, produzindo
  `{numero}-aceite-v{versao}.pdf`. Isso reaproveita o `pdfService` sem alterá-lo.
  O serviço recebe `pdfService` e `htmlRenderer` por injeção (htmlRenderer fica
  disponível para o wiring futuro, mas o comprovante usa HTML próprio).

- **Expiração (RF-019.7, "token inválido ou expirado").** Regra: se
  `versao.expiraEm !== null` e `expiraEm < agora`, lançar `AppError(410)`. O
  "agora" é injetado (`relogio: () => Date`, default `() => new Date()`) para
  testes determinísticos. No MVP `expira_em` costuma ser nulo (nunca expira).

- **Auditoria (RF-003, RF-020.3).** Após a persistência, chamar
  `auditoriaService.registrar` com `acao: 'aprovar'` (cliente) ou
  `acao: 'aceite_manual'` (operador), `entidade: 'orcamentos'`,
  `entidadeId: orcamentoId`, repassando `ip`/`userAgent`. O método distingue
  cliente de operador na auditoria.

- **Multi-tenancy.** Até a Fase 13, isolamento só pelo filtro aplicacional
  `WHERE tenant_id` nos repositórios. `aprovarAceite` filtra o UPDATE por
  `tenant_id`. Para `aprovarViaCliente` (fluxo público, sem sessão) o tenant é
  derivado da própria versão/orçamento localizado pelo token — não há tenant no
  contexto da requisição pública.

---

## Interfaces de input/output do serviço

Exportar de `aceite.service.ts` (shapes próprios, como manda a convenção):

```ts
export interface AprovarViaClienteInput {
  token: string
  ip?: string
  userAgent?: string
}

export interface AceiteManualInput {
  tenantId: string
  orcamentoId: string
  usuarioId: string // operador responsável (RF-020.2)
  justificativa: string // obrigatória (RF-020.1)
  ip?: string
  userAgent?: string
}

export interface AceiteRegistrado {
  id: string
  versaoId: string
  orcamentoId: string
  metodo: 'cliente' | 'operador'
  hashDocumento: string
  comprovantePdfPath: string
  comprovantePdfHash: string
  criadoEm: Date
}

export interface AceiteService {
  aprovarViaCliente(input: AprovarViaClienteInput): Promise<AceiteRegistrado>
  aceiteManual(input: AceiteManualInput): Promise<AceiteRegistrado>
}

interface AceiteServiceDeps {
  orcamentoVersaoRepo: OrcamentoVersaoRepository
  aceiteRepo: OrcamentoAceiteRepository
  orcamentoRepo: OrcamentoRepository
  auditoriaService: AuditoriaService
  pdfService: PdfService
  htmlRenderer: HtmlRendererService
  relogio?: () => Date
}

export function criarAceiteService(deps: AceiteServiceDeps): AceiteService
```

Repositório de aceite (`orcamento-aceite.repository.ts`):

```ts
export interface RegistrarAceiteInput {
  tenantId: string
  versaoId: string
  metodo: 'cliente' | 'operador'
  usuarioId?: string
  ip?: string
  userAgent?: string
  hashDocumento: string
  justificativa?: string
}
export interface AceitePublico {
  id: string
  versaoId: string
  metodo: 'cliente' | 'operador'
  usuarioId: string | null
  ip: string | null
  userAgent: string | null
  hashDocumento: string
  justificativa: string | null
  criadoEm: Date
}
export interface OrcamentoAceiteRepository {
  // Transação atômica: valida ausência de aceite prévio / status não-aprovado,
  // insere o aceite e marca orcamentos.status = 'aprovado'. Lança AppError(409)
  // em duplicado.
  aprovarAceite(input: RegistrarAceiteInput): Promise<AceitePublico>
  buscarPorVersao(versaoId: string): Promise<AceitePublico | null>
}
```

Adição ao `orcamento-versao.repository.ts`:

```ts
// Leitura por token público (coluna UNIQUE). Retorna a versão + o orcamentoId,
// tenantId (via join com orcamentos), numero, pdfHash, status e expiraEm — o que
// o serviço de aceite precisa para validar e aprovar.
export interface VersaoPorToken {
  versaoId: string
  orcamentoId: string
  tenantId: string
  numero: string
  versao: number
  pdfHash: string | null
  tokenPublico: string
  expiraEm: Date | null
  statusOrcamento: OrcamentoStatus
}
buscarPorToken(token: string): Promise<VersaoPorToken | null>
```

---

## Itens (ordenados por dependência, TDD)

- [ ] 1. (TDD — teste primeiro) Escrever os testes do repositório de aceite.
      Criar `src/repositories/__tests__/orcamento-aceite.repository.test.ts` com
      mocks do Kysely no mesmo estilo dos testes de repositório existentes
      (inspecionar `src/repositories/__tests__/*.test.ts` para o padrão de mock
      de `db.transaction().execute`). Cobrir: `aprovarAceite` insere linha com
      `metodo`/`hashDocumento`/evidências e atualiza status para `aprovado`;
      `aprovarAceite` lança `AppError(409)` quando já existe aceite para a versão;
      `buscarPorVersao` retorna `AceitePublico` mapeado ou `null`.
      Files: `src/repositories/__tests__/orcamento-aceite.repository.test.ts`
      Verify: `cd backend && npm test -- orcamento-aceite.repository` — os testes
      FALHAM (módulo ainda não existe). Falha esperada nesta etapa.

- [ ] 2. Implementar `orcamento-aceite.repository.ts` até os testes do item 1
      passarem. Factory `criarOrcamentoAceiteRepository({ db })`; `aprovarAceite`
      em `db.transaction()`: `pg_advisory_xact_lock(hashtext(versaoId))`, relê o
      orçamento ligado à versão (join `orcamento_versoes`→`orcamentos` filtrando
      `tenant_id`), rejeita se `status === 'aprovado'` ou se já houver aceite
      (409), insere em `orcamento_aceites` (`justificativa`/`usuario_id`/`ip`/
      `user_agent` → null quando ausentes) e `UPDATE orcamentos SET status =
      'aprovado', atualizado_em = NOW()` por `tenant_id`+`id`. `mapRowAceite`
      snake→camel. `COLUNAS_ACEITE` como `as const`.
      Files: `src/repositories/orcamento-aceite.repository.ts`
      Verify: `cd backend && npm test -- orcamento-aceite.repository` — todos os
      testes do item 1 passam.

- [ ] 3. (TDD — teste primeiro) Escrever o teste de `buscarPorToken` no
      repositório de versão. Adicionar casos em
      `src/repositories/__tests__/orcamento-versao.repository.test.ts` (ou criar
      se não existir, seguindo o padrão): `buscarPorToken` retorna
      `VersaoPorToken` (join com `orcamentos` para `tenant_id`/`numero`/`status`)
      e `null` quando o token não existe.
      Files: `src/repositories/__tests__/orcamento-versao.repository.test.ts`
      Verify: `cd backend && npm test -- orcamento-versao.repository` — o(s)
      novo(s) teste(s) FALHAM (método ainda não existe).

- [ ] 4. Implementar `buscarPorToken` + a interface `VersaoPorToken` em
      `src/repositories/orcamento-versao.repository.ts` até o item 3 passar.
      `SELECT` em `orcamento_versoes v JOIN orcamentos o ON o.id = v.orcamento_id`
      filtrando por `v.token_publico = token`, projetando os campos de
      `VersaoPorToken`; `mapRow*` dedicado. Importar `OrcamentoStatus` de
      `orcamento.repository.js`.
      Files: `src/repositories/orcamento-versao.repository.ts`
      Verify: `cd backend && npm test -- orcamento-versao.repository` — passa; e
      `cd backend && npm run build` compila sem erros.

- [ ] 5. (TDD — teste primeiro) Escrever TODOS os testes do serviço de aceite em
      `src/services/__tests__/aceite.service.test.ts`, com um `makeDeps()` que
      mocka cada dependência via `vi.fn()` (mesmo padrão de
      `versionamento.service.test.ts`: factory de deps + overrides). Casos
      obrigatórios listados na seção "Casos de teste" abaixo. Definir
      `SESSION_SECRET` no ambiente de teste (há `setup.ts`; `src/lib/token.ts`
      exige a env) para que `gerarTokenPublico`/`validarTokenPublico` funcionem
      com tokens reais nos testes de token válido/ inválido.
      Files: `src/services/__tests__/aceite.service.test.ts`
      Verify: `cd backend && npm test -- aceite.service` — os testes FALHAM
      (serviço ainda não existe).

- [ ] 6. Implementar `src/services/aceite.service.ts` até o item 5 passar.
      Factory `criarAceiteService(deps)` exportando interface + shapes.
      `aprovarViaCliente`: busca por token (`buscarPorToken`); token inexistente
      ou HMAC inválido (`validarTokenPublico(token, versaoId) === false`) →
      `AppError(410)` genérico; expirado (`expiraEm` passado, comparado com
      `relogio()`) → `AppError(410)`; `statusOrcamento === 'aprovado'` →
      `AppError(409)` (duplicado); `pdfHash` nulo → `AppError(409)`; persiste via
      `aceiteRepo.aprovarAceite({ metodo: 'cliente', hashDocumento: pdfHash, ... })`;
      gera comprovante (helper abaixo); registra auditoria `acao: 'aprovar'`.
      `aceiteManual`: `justificativa` vazia/ausente → `AppError(400)`; carrega
      orçamento (`orcamentoRepo.buscarPorId(tenantId, orcamentoId)`) → 404 se
      ausente; obtém a versão atual pelo `versaoAtual`/`buscarPorToken` não se
      aplica — usar a última versão: ver nota de implementação [A]; persiste via
      `aprovarAceite({ metodo: 'operador', usuarioId, justificativa, hashDocumento })`;
      gera comprovante; auditoria `acao: 'aceite_manual'`. Helper privado
      `montarHtmlComprovante(dados)` → HTML determinístico com os campos de
      RF-021.2; depois `pdfService.gerarPdf({ html, numero: `${numero}-aceite`,
      versao })`. Comentários em pt-BR.
      Files: `src/services/aceite.service.ts`
      Verify: `cd backend && npm test -- aceite.service` — todos passam.

      Nota de implementação [A] — localizar a versão no aceite manual: o aceite
      manual recebe `orcamentoId`, não token. Para obter `versaoId`/`numero`/
      `pdfHash` da versão vigente, adicionar ao `orcamento-versao.repository` um
      `buscarVersaoAtualPorOrcamento(tenantId, orcamentoId): Promise<VersaoPorToken | null>`
      (MAX(versao) do orçamento, mesmo shape). Escrever o teste desse método
      junto ao item 3 e implementá-lo junto ao item 4 (é o mesmo arquivo). Se a
      versão não existir (orçamento ainda em rascunho) → `AppError(409)` "orçamento
      sem versão enviada". Esta nota faz parte dos itens 3–4 e 5–6; está destacada
      aqui por ser a única sutileza de fluxo.

- [ ] 7. Verificação final da tarefa: lint, build e cobertura. Rodar o conjunto
      completo e conferir a cobertura 80%+ dos arquivos novos
      (`aceite.service.ts`, `orcamento-aceite.repository.ts` e os métodos novos
      do versão-repo).
      Files: (nenhum novo — ajustes de borda se o lint/cobertura apontar)
      Verify: `cd backend && npm run lint && npm run build && npm run test:coverage`
      — lint sem erros, build sem erros, todos os testes passam e a cobertura dos
      arquivos da tarefa fica ≥ 80%.

---

## Casos de teste a escrever primeiro (item 5 — serviço de aceite)

`aprovarViaCliente`:
1. Token válido: valida HMAC, registra aceite com `metodo='cliente'`, IP, UA e
   `hashDocumento = pdfHash` da versão; chama `aceiteRepo.aprovarAceite` com esses
   campos; retorna `AceiteRegistrado`.
2. Gera o comprovante PDF: chama `pdfService.gerarPdf` com HTML contendo número,
   versão, data/hora, IP, UA, hash e método; nome de arquivo com sufixo `-aceite`;
   `comprovantePdfPath`/`comprovantePdfHash` preenchidos no retorno.
3. Registra auditoria `acao='aprovar'`, `entidade='orcamentos'`,
   `entidadeId=orcamentoId`, com IP/UA.
4. Token inexistente (`buscarPorToken` → null) → `AppError(410)`; não persiste
   nem gera PDF.
5. Token com HMAC adulterado (`validarTokenPublico` → false) → `AppError(410)`.
6. Token/versão expirada (`expiraEm` no passado via `relogio` injetado) →
   `AppError(410)`.
7. Aceite duplicado — orçamento já `aprovado` (`statusOrcamento='aprovado'`) →
   `AppError(409)`; não gera PDF.
8. Duplicado detectado no repositório: `aprovarAceite` rejeita com `AppError(409)`
   (constraint `UNIQUE(versao_id)`) e o serviço propaga; auditoria não roda.
9. `pdfHash` nulo na versão → `AppError(409)` (documento sem hash de integridade).

`aceiteManual`:
10. Justificativa ausente/vazia (ex.: `'   '`) → `AppError(400)`; nada persiste.
11. Caminho feliz: registra aceite `metodo='operador'`, `usuarioId` = operador,
    `justificativa`, `hashDocumento = pdfHash`; muda status para `aprovado` (via
    repo); retorna `AceiteRegistrado`.
12. Gera comprovante PDF com os campos de RF-021.2 (método = `operador`).
13. Auditoria `acao='aceite_manual'` com `usuarioId` e `entidadeId=orcamentoId`
    (diferencia do aceite do cliente — RF-020.3).
14. Orçamento inexistente (`orcamentoRepo.buscarPorId` → null) → `AppError(404)`.
15. Orçamento sem versão enviada (`buscarVersaoAtualPorOrcamento` → null) →
    `AppError(409)`.
16. Orçamento já `aprovado` → `AppError(409)` (duplicado), via repo.

Observação de cobertura: incluir ao menos um caso que exercite o helper
`montarHtmlComprovante` com e sem IP/UA (campos opcionais) para cobrir os ramos.

---

## Pontos de integração (resumo)

- `token.ts` → `validarTokenPublico(token, versao.id)` em `aprovarViaCliente`
  (após localizar a versão por `token_publico`).
- `pdfService.gerarPdf({ html, numero: `${numero}-aceite`, versao })` → comprovante
  (reutiliza a Fase 8; imutável, sem regenerar).
- `auditoriaService.registrar(...)` → `acao` `'aprovar'` | `'aceite_manual'`.
- `hashDocumento` do aceite = `orcamento_versoes.pdf_hash` (SHA-256 dos bytes do
  PDF). NÃO usar `crypto.ts#hashDocumento` (normaliza pontuação; é para CPF/CNPJ).
- Status: `orcamentos.status → 'aprovado'` dentro da transação de `aprovarAceite`
  no repositório de aceite (SQL fora do serviço).

## Lacunas / suposições assumidas

- O design (9.3) e RF-022 citam e-mail ao operador no aceite; a lib de e-mail é a
  Fase 11 (tarefas 51–52) e está fora do escopo da tarefa 41. Suposição: NÃO
  integrar e-mail aqui (nenhum `emailService` injetado). Deixar explícito no PR.
- O base URL público absoluto não existe em env (como já observado no
  versionamento). O comprovante não depende de URL pública, então não há bloqueio.
- Formato exato do HTML do comprovante não é especificado além dos campos de
  RF-021.2; adotar um HTML mínimo e determinístico (sem CSS externo), suficiente
  para o `pdfService` e para os testes verificarem a presença dos campos.

# Serviço de versionamento: rascunho → versão imutável enviada (Tarefa 32)

A tarefa 32 introduz o fluxo de envio de um orçamento: um `rascunho` com itens
vira uma versão imutável `enviado`. A mudança adiciona dois módulos novos
(`services/versionamento.service.ts` e `repositories/orcamento-versao.repository.ts`),
com seus testes, e reaproveita o `snapshot.service` já existente (tarefa 31)
para montar o snapshot JSONB. O serviço valida o estado do orçamento, resolve os
dados vivos (cliente, empresa, responsáveis) e delega a persistência atômica ao
repositório, que calcula a próxima versão sequencial, resolve o template ativo,
invalida o aceite anterior, grava o token público único e marca o orçamento como
`enviado` — tudo numa única transação. A auditoria `acao: 'enviar'` é registrada
após a persistência. PDF fica para a tarefa 40 (`pdf_path`/`pdf_hash` nulos); a
rota `POST /:id/enviar` fica para a 33 (nenhum wiring em `app.ts`).

Watch for: nenhum item bloqueante. Observações menores — a ordem auditoria-após-
persistência deixa uma janela de inconsistência se a auditoria falhar (confirmed);
o parâmetro `expiraEm` é cabeado mas o serviço só passa `null` (confirmed, por
design, tarefa 42); a interação RLS × `db.transaction()` segue o padrão do projeto
e é deferida para testes de integração (confirmed, pré-existente).

**Verdict**: APPROVED

## High-level view

O serviço concentra as regras de negócio e a validação de estado; o repositório
é o único dono do SQL do envio e empacota tudo numa transação. Os status codes
replicam `orcamento.service.ts`, verificado diretamente: 404 inexistente, 409
estado não-rascunho, 400 rascunho sem itens, 409 cliente ausente.

O versionamento sequencial é protegido contra corrida por advisory lock
transacional por `orcamento_id` antes do `SELECT MAX(versao)` — mesmo padrão de
`gerarNumero`, com `UNIQUE (orcamento_id, versao)` como rede final. O token
público é único por versão, derivado de um `randomUUID` para o `id` da versão,
com `UNIQUE` no `token_publico`.

A invalidação do aceite anterior (`DELETE` dos aceites das versões do orçamento)
e a transição de status (`enviado`, `versao_atual = N`) rodam na mesma transação
do insert, então nenhum orçamento fica `enviado` sem versão correspondente.

A auditoria é registrada depois da persistência, fora da transação do
repositório. Se a auditoria falhar, a versão já foi commitada: o envio aconteceu
sem trilha. É o mesmo trade-off dos outros serviços do projeto.

O snapshot imutável é montado pelo `snapshot.service` reaproveitado. A cobertura
é 100% de statements no serviço e 95.6% no repositório, ambos acima de 80%.

<details>
<summary>Issues (3)</summary>

1. **Auditoria pós-commit sem compensação** — a versão é commitada antes do
   `auditoria.registrar`; se a auditoria falhar, o envio fica sem trilha. Mesmo
   trade-off dos demais serviços; aceitável, mas digno de nota. Não-bloqueante.
2. **`expiraEm` sempre null** — o parâmetro existe no contrato do repositório e
   é cabeado pelo serviço, mas só `null` é passado (expiração é tarefa 42).
   Cabeamento intencional antecipado; não-bloqueante.
3. **RLS × transação própria** — o repositório abre `db.transaction()` próprio;
   o `app.current_tenant` depende do middleware. Segue o padrão do projeto
   (`orcamento.repository`) e é deferido a testes de integração. Pré-existente,
   não-bloqueante.

</details>

<details>
<summary>Details</summary>

## Corte serviço × repositório e aderência às convenções

A separação respeita a fronteira de repositório do projeto: nenhuma query
Kysely vaza para o serviço, e o repositório traduz `snake_case` ↔ `camelCase`
via `mapRowVersao` explícito. Ambos os módulos exportam interface + factory
`criar*` com dependências por argumento (`criarVersionamentoService(deps)`,
`criarOrcamentoVersaoRepository({ db })`), em linha com o estilo de DI do resto
do backend. Imports ESM carregam a extensão `.js` sobre fontes `.ts`
(`../errors/app-error.js`, `../lib/token.js`), conforme Node16. Nomes e
comentários em português. TS estrito respeitado: `noUncheckedIndexedAccess`
aparece tratado tanto no `resultado.rows[0]?.max ?? null` quanto no
`responsaveisPorId` do serviço.

A única mudança em arquivo existente
(`routes/__tests__/orcamentos.routes.test.ts`) é uma reformatação do Prettier
(colapso de um import multi-linha), subproduto do `npm run format`. Não altera
comportamento e não é um unrelated change de risco.

## Versionamento sequencial e corrida

```
db.transaction:
  pg_advisory_xact_lock(hashtext(orcamento_id))   -- serializa concorrentes
  SELECT MAX(versao) WHERE orcamento_id = ?        -- lê o teto atual
  versao = (max ?? 0) + 1                           -- v1 ou v(N+1)
  ... template ativo, delete aceites, insert versão, update orçamento ...
```

O advisory lock é transacional (`pg_advisory_xact_lock`), então é liberado no
commit/rollback — não há risco de lock vazado. A ordem lock-antes-de-MAX é o que
garante a sequência sem corrida, e há um teste dedicado afirmando essa ordem a
partir dos SQLs crus executados (`sqlExecutado[0]` contém `pg_advisory_xact_lock`,
`sqlExecutado[1]` contém `MAX`). O `UNIQUE (orcamento_id, versao)` no schema
(migration 001) é a rede final caso o lock seja contornado.

## Token público único por versão

O `id` da versão é gerado no app (`randomUUID`) antes do insert, e o token é
derivado dele via `gerarTokenPublico(versaoId)` — que combina um segundo
`randomUUID` com um HMAC-SHA256 de `uuid:versaoId`. Fazer o `id` nascer no app
(em vez de depender do `DEFAULT uuid_generate_v4()` do banco) é o que permite um
único insert com token e id coerentes, em vez de insert + update. O teste
`gera um token público único e válido` fecha o ciclo validando o token contra o
`id` capturado no mock com `validarTokenPublico`. Unicidade no banco garantida
por `token_publico VARCHAR(128) NOT NULL UNIQUE`.

## Transição de status e invalidação do aceite anterior

O `UPDATE orcamentos SET status='enviado', versao_atual=N, atualizado_em=now`
roda na mesma transação do insert da versão, com `WHERE tenant_id AND id`.
Atomicidade garante que não existe orçamento `enviado` sem a versão
correspondente. A invalidação do aceite anterior é um `DELETE FROM
orcamento_aceites WHERE versao_id IN (SELECT id FROM orcamento_versoes WHERE
orcamento_id = ?)`. No primeiro envio é no-op (ainda não há versões), e há teste
cobrindo que o `deleteFrom('orcamento_aceites')` é chamado. Como `UNIQUE
(versao_id)` restringe um aceite por versão e as versões anteriores são
imutáveis, o `DELETE` remove efetivamente o aceite ativo antes de o cliente
poder reagir à nova versão.

## Status codes coerentes com orcamento.service.ts

Verifiquei diretamente em `orcamento.service.ts`: `criar` usa
`AppError(400, 'Orçamento deve ter ao menos um item')`, `atualizar`/`deletar`
usam `AppError(409, 'Só é possível editar/excluir orçamentos em rascunho')`, e
`buscarPorId` usa `AppError(404)`. O `enviar` replica exatamente: 404 orçamento
inexistente, 409 status ≠ rascunho, 400 rascunho sem itens. A mensagem de item
("Orçamento deve ter ao menos um item") é idêntica à do `criar`. O cliente
ausente usa 409 — defensável, pois é um conflito de estado (o orçamento referencia
um cliente que não existe mais), não um erro de input do chamador. O repositório
acrescenta 409 para tenant sem template ativo, coerente com a mesma semântica de
conflito de estado.

## Snapshot imutável via snapshot.service

O serviço não reescreve a montagem do snapshot — delega a `snapshotService.montar`.
A resolução de dados vivos tem três sutilezas, todas testadas: empresa só é
buscada quando `empresaClienteId !== null`; responsáveis são deduplicados via
`Set` antes das buscas (2 buscas para 2 ids distintos entre 4 itens, ignorando o
null); responsável ausente no banco não entra no Map (`size` 0). O
`snapshot.service` já trata `undefined` do `Map.get()` como `null`.

Como o `snapshot.service` faz cópia profunda por valor, mutações posteriores nas
fontes não afetam o que foi persistido — a imutabilidade é preservada da montagem
até a gravação em `snapshot JSONB`.

## pdf_path/pdf_hash nulos (PDF é tarefa 40)

O insert fixa `pdf_path: null, pdf_hash: null`, com teste dedicado. O contrato
`VersaoEnviada`/`OrcamentoVersaoPublica` expõe ambos como `string | null`,
pronto para a tarefa 40 preencher sem mudança de assinatura. `expira_em` também
é null (`expira_em: input.expiraEm ?? null`), com `expiraEm` deferido à tarefa 42.

## Cobertura

A evidência reporta 100% de statements no serviço (80/80) e 95.6% no repositório
(87/91), ambos acima do piso de 80% do DoD. Os 4 statements não cobertos no
repositório não são identificados na evidência, mas, dado 100% de funcs e os 9
testes cobrindo versão 1, versão N+1, token, template ativo, 409 sem template,
invalidação de aceite, pdf nulos, ordem do advisory lock e mapeamento camelCase,
o não-coberto é provavelmente ramo defensivo (`?? null`/coerção de linha). Não é
bloqueante.

Not tested (nível unitário, por design mock-based): a corrida real do advisory
lock sob concorrência, a aplicação efetiva da RLS dentro da transação do
repositório, e a cascata real do `DELETE` de aceites — todos deferidos a testes
de integração com Postgres, consistente com a convenção dos outros repositórios.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/services/versionamento.service.ts` (novo) — serviço `enviar`:
  valida estado, resolve dados vivos, monta snapshot, delega persistência,
  registra auditoria.
- `backend/src/services/__tests__/versionamento.service.test.ts` (novo) — 11
  testes do serviço.
- `backend/src/repositories/orcamento-versao.repository.ts` (novo) — repositório
  `criarVersaoEnviar`: transação atômica com versão sequencial, template ativo,
  invalidação de aceite, token único, update de status.
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` (novo)
  — 9 testes do repositório (mock-based).
- `backend/src/routes/__tests__/orcamentos.routes.test.ts` (modificado) — apenas
  reformatação do Prettier (import colapsado), sem mudança de comportamento.

Diff completo: `git diff main` + arquivos novos não rastreados (`git status`).

</details>

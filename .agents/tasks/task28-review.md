# Repositório de orçamentos: criação atômica, numeração sem race e substituição de itens

A Tarefa 28 (Fase 5) implementa `orcamento.repository.ts` e seu teste mock-based, cobrindo os cinco métodos da interface `OrcamentoRepository`: `criar`, `buscarPorId`, `atualizar`, `listarPorTenant` e `deletar`. A criação gera o número `ORC-{ANO}-{SEQ}` e insere orçamento + itens numa única transação; a numeração é serializada por `pg_advisory_xact_lock` dentro da transação, com `UNIQUE (tenant_id, numero)` como rede final. `atualizar` substitui todos os itens (delete + reinsert) em transação, `listarPorTenant` pagina e filtra por status com isolamento de tenant, e `deletar` só apaga rascunhos (409 caso contrário, 404 se ausente). A implementação espelha fielmente o padrão de `cliente.repository.ts` e usa apenas colunas reais do schema.

Watch for: a numeração sem race depende do advisory lock + leitura do MAX na mesma transação — correto no design, mas verificado nos testes só por ordem de SQL (sem Postgres), o que é a convenção do projeto (confirmed). Nenhum concern bloqueante encontrado.

**Verdict**: APPROVED

## High-level view

A geração do número é o ponto de maior risco e foi resolvida da forma mais segura possível sem tocar no schema: dentro da transação de `criar`, um `pg_advisory_xact_lock(hashtext(tenant:ano))` serializa a geração por tenant+ano antes do `SELECT MAX`, e o `UNIQUE (tenant_id, numero)` fecha a janela como última barreira. É a escolha certa dado que a Tarefa 28 não pode criar migrations.

A atomicidade de `criar` e `atualizar` vem de `db.transaction().execute(...)`, com todos os inserts/updates/deletes operando no `trx`. `atualizar` implementa "substituição total" apagando itens por `orcamento_id` e reinserindo com `ordem` 1-based — coerente com o enunciado.

A superfície de dados segue o padrão vizinho: factory `criarOrcamentoRepository({ db })` (divergência de assinatura documentada no código), interfaces de input/output exportadas, `mapRow*` convertendo snake_case→camelCase e NUMERIC (string do driver `pg`) → `number`. O isolamento de tenant usa filtro explícito `.where('tenant_id', ...)` como defesa em profundidade sobre a RLS, igual a `cliente.repository.ts`.

Os testes são 100% mock-based (sem Postgres), coerente com o restante do projeto. "Isolamento de tenant" e "sem race" são verificados por asserção de filtros e ordem de SQL, não ponta-a-ponta; a validação real de RLS/concorrência fica para integração, como já documentado no arquivo de teste.

<details>
<summary>Issues (3)</summary>

1. **Verificação de race é indireta** — a ausência de race na numeração é garantida pelo design (lock transacional + MAX na mesma transação) mas testada só por ordem de SQL em mock; a prova sob concorrência real depende de teste de integração ausente. Não bloqueante: é a convenção do projeto e há UNIQUE como rede.
2. **Colisão de `hashtext`** — `hashtext(tenant:ano)` retorna int32, então pares tenant+ano distintos podem colidir e serializar sem necessidade. É seguro em correção (só afeta concorrência entre chaves colididas) e protegido pelo UNIQUE; vale um comentário, não é bug.
3. **Ano no app vs. `CURRENT_DATE` no banco** — o prefixo usa `new Date().getFullYear()` enquanto `data_emissao` usa o default `CURRENT_DATE`; numa virada de ano com skew de timezone os dois poderiam divergir. Premissa já documentada no plano; não bloqueante.

</details>

<details>
<summary>Details</summary>

### Numeração ORC-{ANO}-{SEQ} dentro da transação

`gerarNumero` roda como primeira operação dentro da transação de `criar`: emite `SELECT pg_advisory_xact_lock(hashtext(${tenant:ano}))` e só então lê `SELECT MAX(CAST(SUBSTRING(numero FROM 'ORC-[0-9]{4}-([0-9]+)$') AS INTEGER))` filtrando por `tenant_id` e `numero LIKE 'ORC-{ANO}-%'`. O lock transacional serializa duas criações concorrentes do mesmo tenant+ano entre o "ler o último" e o "inserir o próximo", eliminando a corrida clássica de read-then-insert, e o `UNIQUE (tenant_id, numero)` (confirmado na migration 001) é a última barreira caso o lock seja contornado. Como a Tarefa 28 não pode criar sequence nem nova migration, é a abordagem de menor impacto no schema.

Duas ressalvas de baixo impacto (detalhadas nos Issues 2 e 3): `hashtext` reduz a chave a 32 bits, podendo serializar pares tenant+ano colididos sem afetar a correção; e o ano do prefixo vem do app (`new Date().getFullYear()`) enquanto `data_emissao` usa o default `CURRENT_DATE`, divergindo por um dia só numa virada de ano com skew de timezone. Ambos protegidos pelo UNIQUE e já documentados como premissas.

### Atomicidade de criar e substituição de itens em atualizar

`criar` calcula `subtotal`/`total` via `orcamento-calculo` antes de abrir a transação e, dentro de `db.transaction().execute`, gera o número, insere o orçamento com `status: 'rascunho'` explícito e insere os itens com `ordem` 1-based pela posição no array — tudo no `trx`, então uma falha em qualquer insert desfaz o conjunto.

`atualizar` monta o `set` apenas com os campos presentes em `AtualizarOrcamentoInput` (mais `atualizado_em` e os totais recalculados), aplica o update filtrado por `tenant_id`+`id` e retorna `null` quando nada foi atualizado — o que curto-circuita a substituição de itens, evitando apagar itens de um orçamento inexistente ou de outro tenant. A substituição apaga por `orcamento_id` e reinsere via o mesmo `inserirItens` de `criar`. Nota: `atualizar` não restringe a edição a `rascunho`; isso é intencional nesta camada, já que a regra "editar só rascunho" (RF-005.5) cabe ao service na Tarefa 29 — se o revisor esperava a trava aqui, é um desalinhamento de escopo a confirmar, não um bug.

### Conversão NUMERIC e nomes de coluna

Os inserts enviam NUMERIC como `String(valor)` e os `mapRow*` convertem de volta com `Number(...)` (`numeroOpcional` preserva `null` nos descontos), batendo com os tipos `string` em `types/database.ts`. Os nomes em `COLUNAS_ORCAMENTO`/`COLUNAS_ITEM` conferem um a um com a migration 001 — nenhuma coluna inventada, critério de aprovação atendido.

### Isolamento de tenant e paginação em listarPorTenant

A listagem monta duas queries (lista e count) ambas com `.where('tenant_id', '=', tenantId)`, adiciona `.where('status', ...)` só quando `filtro.status` está definido, ordena por `criado_em desc` e aplica `limit(tamanhoPagina)`/`offset((pagina-1)*tamanhoPagina)`. O retorno usa `mapRowResumo`, que omite o array `itens` — a lista enxuta esperada. O filtro explícito de tenant replica o padrão de `cliente.repository.ts` e funciona como defesa em profundidade sobre a RLS (política `orcamentos_tenant_isolation` confirmada na migration 002).

### Regra de deletar

`deletar` lê o `status` filtrando por `tenant_id`+`id`; ausência → `AppError(404)`, status diferente de `rascunho` → `AppError(409, 'Só é possível excluir orçamentos em rascunho')`, e só então apaga. O 409 é coerente com o design (§8.2: PUT em enviado → 409; DELETE remove rascunho) e com RF-005.5. Os itens caem por `ON DELETE CASCADE` (confirmado na migration 001).

### Cobertura de testes

Os 18 testes cobrem cada comportamento exigido: transação atômica em `criar` (asserção de `transaction()` e inserts nas duas tabelas no `trx`), numeração 0001 (MAX null) e 0043 (MAX 42), ordem do advisory lock antes do MAX, `status: 'rascunho'`, `ordem` 1-based, cálculo de subtotal/total, conversão NUMERIC→number no retorno; `buscarPorId` com null e com itens ordenados por `ordem asc` + filtro de tenant; `atualizar` com null, substituição de itens e recálculo; `listarPorTenant` com filtro de tenant, status condicional, limit/offset e resumo sem `itens`; `deletar` nos três caminhos. A evidência reporta 100% de statements/functions/lines e ~82,7% de branches no arquivo, acima do mínimo de 80%.

Not tested: a serialização real sob concorrência da numeração e o comportamento efetivo da RLS — ambos fora do mecanismo mock-based do projeto e deixados para testes de integração, conforme a convenção documentada no cabeçalho do arquivo de teste e no middleware `tenant.ts`. Isto é uma lacuna conhecida e aceita, não um defeito desta tarefa.

### Escopo

A mudança toca apenas os dois arquivos previstos (`orcamento.repository.ts` e seu teste). Não há service, rotas, migrations novas nem edição de código vizinho, e `tasks.md` não foi marcado como concluído — tudo coerente com o "fora de escopo" do enunciado.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/repositories/orcamento.repository.ts` — implementação do repositório: interfaces exportadas, factory `criarOrcamentoRepository({ db })`, `mapRow*`, `gerarNumero` com advisory lock, e os cinco métodos.
- `backend/src/repositories/__tests__/orcamento.repository.test.ts` — 18 testes mock-based (builders fluentes + mock de transação com executor falso que registra ordem de SQL cru).

Diff de referência: alterações locais sob `backend/src/repositories/` (primeira iteração; sem base remota para esta tarefa).

</details>

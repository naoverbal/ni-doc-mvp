# Repositório e serviço de templates versionados (Tarefa 34)

A tarefa 34 introduz a camada de templates da Fase 7: um repositório append-only que versiona o layout do template por tenant e um serviço que o envolve com auditoria e tratamento de erro. `criarPadrao` semeia a versão 1 com um layout padrão no bootstrap do tenant; `salvar` cria sempre uma nova versão (`MAX(versao)+1`), nunca sobrescreve, e reaponta `tenants_template_ativo` para a nova linha; `buscarAtivo` resolve a versão ativa via join com o ponteiro; `buscarPorId` recupera uma versão específica, filtrada por tenant. A geração de versão é serializada por tenant com advisory lock transacional, espelhando o padrão `gerarNumero`/`proximaVersaoSequencial` já estabelecido em orçamentos. Nenhuma alteração em `types/database.ts` foi necessária — `TemplateTable` e `TenantTemplateAtivoTable` já estavam declaradas e registradas.

Watch for: a imutabilidade é garantida por construção (nenhum `UPDATE`/`DELETE` em `templates`) e verificada apenas em testes mock-based, não contra Postgres real — o que é consistente com a convenção do projeto, mas significa que a RLS e a constraint `UNIQUE(tenant_id, versao)` não são exercitadas aqui (possible). O nome do método (`criarPadrao`) diverge do texto da spec (`criarTemplatePadrao`) sem impacto comportamental (confirmed, não bloqueante).

**Verdict**: APPROVED

## High-level view

O versionamento é append-only e sem race. `inserirVersao` abre uma transação, toma `pg_advisory_xact_lock(hashtext(tenantId))`, lê `MAX(versao)`, insere `max+1` e faz upsert do ponteiro ativo — tudo na mesma transação. Tanto `criarPadrao` quanto `salvar` compartilham esse caminho, então a v1 do bootstrap e as versões subsequentes seguem exatamente a mesma mecânica de serialização.

A fronteira de camadas está respeitada. Todo Kysely e todo `sql` cru vivem no repositório; `mapRowTemplate` traduz `snake_case → camelCase` e `layout_json` é serializado com `JSON.stringify` no insert (mesmo padrão de `auditoria.repository`). O serviço não toca em query alguma — delega ao repo, registra auditoria e converte `null` em `AppError(404)`.

A auditoria está só onde faz sentido. `salvar` registra `acao: 'atualizar'`, `entidade: 'templates'`, `entidadeId` = id da nova versão, com `estadoNovo: { versao }` — e o payload casa exatamente com `CriarEventoInput`. `criarPadrao` deliberadamente não audita, porque roda no bootstrap do tenant antes de existir um usuário no contexto.

O isolamento de tenant é aplicado em toda leitura. `buscarAtivo` filtra por `tenants_template_ativo.tenant_id`; `buscarPorId` filtra por `tenant_id` E `id` (defesa em profundidade sobre a RLS). O escopo de escrita vem do `tenantId` do input/contexto.

A cobertura de testes espelha os vizinhos da fase. O harness de transação (executor falso que registra o SQL compilado e resolve o advisory lock e o `SELECT MAX`) é o mesmo de `orcamento-versao.repository.test`, e os asserts de versionamento afirmam ausência de `updateTable`/`deleteFrom`. O DoD de imutabilidade tem teste explícito no repositório e no serviço.

<details>
<summary>Issues (2)</summary>

1. **Imutabilidade só verificada por mock** — o DoD (v1 permanece acessível após salvar v2) é afirmado via ausência de `updateTable`/`deleteFrom` e via `buscarPorId` retornando a v1 em testes mock-based; a persistência real, a RLS e a constraint `UNIQUE(tenant_id, versao)` não são exercitadas. Consistente com a convenção do projeto; se desejar garantia end-to-end, cobrir num teste de integração futuro. Não bloqueante.
2. **Nome diverge da spec** — a spec descreve `criarTemplatePadrao`; o código expõe `criarPadrao`. Comportamento idêntico; alinhar o texto da spec ou o nome por consistência. Não bloqueante.

</details>

<details>
<summary>Details</summary>

### Versionamento append-only sem race

`criarPadrao` e `salvar` convergem em `inserirVersao(tenantId, layoutJson)`, que roda inteiramente dentro de `db.transaction().execute`:

```
pg_advisory_xact_lock(hashtext(tenantId))   -- serializa por tenant
SELECT MAX(versao) ... WHERE tenant_id = ?  -- lê o teto atual
INSERT INTO templates (versao = max+1)      -- nunca UPDATE
INSERT INTO tenants_template_ativo ...
  ON CONFLICT (tenant_id) DO UPDATE          -- reaponta o ativo
```

O advisory lock vem antes do `SELECT MAX`, fechando a janela de corrida entre leitura e insert — o teste "emite o advisory lock ANTES do SELECT de MAX" trava essa ordem (`sqlExecutado[0]` contém `pg_advisory_xact_lock`, `[1]` contém `MAX`). O padrão é idêntico ao `proximaVersaoSequencial` de `orcamento-versao.repository`, inclusive na escolha de `hashtext` sobre o identificador do escopo. A rede de segurança final continua sendo a constraint `UNIQUE(tenant_id, versao)` no banco, fora do alcance deste teste.

Não há caminho de escrita que faça `UPDATE` ou `DELETE` em `templates`: o repo expõe apenas inserts. Isso é o que torna o versionamento imutável por construção, e os testes "nunca sobrescreve versão existente" e o teste de DoD afirmam explicitamente `trx.updateTable` e `trx.deleteFrom` nunca chamados.

### Ponteiro ativo e leitura

`buscarAtivo` filtra por `tenants_template_ativo.tenant_id` no join, então um tenant nunca enxerga o ponteiro de outro. `buscarPorId` filtra por `tenant_id` E `id` — mesmo com a RLS no banco, esse duplo filtro é defesa em profundidade: uma versão de outro tenant com id adivinhado não vaza. Ambas retornam `null` em miss, deixando a semântica HTTP para o serviço.

### Serviço: auditoria assimétrica e 404

`salvar` registra auditoria depois do insert bem-sucedido, com payload que bate campo a campo com `CriarEventoInput` (`tenantId`, `usuarioId`, `acao: 'atualizar'`, `entidade: 'templates'`, `entidadeId`, `estadoNovo`, `ip`, `userAgent`). `acao: 'atualizar'` é o mesmo verbo que cliente/empresa/orçamento usam para mutação, então o histórico fica consistente para filtros `git log`-equivalentes na auditoria.

`criarPadrao` não audita por decisão de design: roda no bootstrap do tenant, antes de haver `usuarioId`. O teste "não registra auditoria" trava essa decisão para que ninguém adicione auditoria sem contexto de usuário depois. A assimetria de assinatura (`criarPadrao(tenantId)` vs. `salvar(ctx, layout)`) segue da mesma razão — não há contexto de usuário no bootstrap.

### Cobertura de testes

Os testes de repositório são 100% mock-based, na mesma linha de cliente/orçamento: não sobem Postgres, então "isolamento de tenant" é verificado como asserção de que `.where('tenant_id', '=', tenantId)` é aplicado, e imutabilidade como ausência de `updateTable`/`deleteFrom`. O harness `makeTrx` reusa o executor falso que registra o SQL compilado e resolve a 1ª chamada (advisory lock) e a 2ª (`SELECT MAX`) — espelho fiel de `orcamento-versao.repository.test`.

O DoD de versionamento tem teste dedicado em ambas as camadas: no repo, `salvar` com `max=1` insere `versao=2` sem update/delete e a v1 segue recuperável por `buscarPorId`; no serviço, dois `salvar` consecutivos repassam v1 e v2, auditam duas vezes, e a v1 continua recuperável.

Não testado (possible): a persistência real contra Postgres, a aplicação de RLS, e a constraint `UNIQUE(tenant_id, versao)` sob concorrência real. Isso é consequência deliberada da convenção mock-based do projeto, não uma lacuna específica desta tarefa.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/repositories/template.repository.ts` — repositório append-only: `criarPadrao`, `salvar`, `buscarAtivo`, `buscarPorId`; `LAYOUT_PADRAO`, `mapRowTemplate`, advisory-lock + `MAX+1`.
- `backend/src/repositories/__tests__/template.repository.test.ts` — 13 testes mock-based incluindo DoD de imutabilidade.
- `backend/src/services/template.service.ts` — serviço: delega ao repo, audita `salvar`, `AppError(404)` nas buscas.
- `backend/src/services/__tests__/template.service.test.ts` — 10 testes incluindo auditoria e DoD de versionamento.

Sem alteração em `types/database.ts` (tabelas já declaradas). Verificação registrada em `.agents/tasks/task34-evidence.md` (build exit 0, lint limpo, prettier limpo, 23 testes novos, suíte completa 357 testes, 100% de cobertura nos arquivos novos) — não re-executada neste review.

</details>

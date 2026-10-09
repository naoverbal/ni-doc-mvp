# Serviço de aceite de orçamento (cliente e manual)

A Tarefa 41 adiciona o serviço de aceite (`aceite.service.ts`) com dois fluxos de aprovação de um orçamento enviado — `aprovarViaCliente` (link público, sem sessão) e `aceiteManual` (operador com justificativa) — mais o repositório `orcamento-aceite.repository.ts` que persiste a evidência imutável e muda o status do orçamento em uma única transação, e dois métodos de leitura novos no `orcamento-versao.repository.ts` (`buscarPorToken`, `buscarVersaoAtualPorOrcamento`). Ambos os fluxos registram IP, user agent, hash do documento e método, geram um comprovante PDF reusando o `pdfService` da Fase 8 e registram auditoria. A abordagem mantém a convenção de camadas: todo o SQL (incluindo a serialização por advisory lock e a mudança de status) vive nos repositórios, e o serviço apenas orquestra validação, persistência, comprovante e auditoria.

Watch for: a transação do repositório de aceite não propaga o tenant para o GUC de RLS (`app.current_tenant`), apoiando-se só no filtro aplicacional `WHERE tenant_id` (confirmado) — consistente com a convenção MVP (RLS efetiva só na Fase 13), mas vale registrar. A rede de segurança contra duplicidade `UNIQUE(versao_id)` só é exercida em integração, não nos testes mock (confirmado). Nenhum é bloqueante.

**Verdict**: APPROVED

## High-level view

O token público tem formato `uuid.hmac` onde o HMAC liga um UUID aleatório ao id da versão, então o serviço não consegue derivar o `versaoId` do token. A solução correta é buscar a versão pela coluna `token_publico` (UNIQUE) e só então validar o HMAC com `validarTokenPublico(token, versao.id)` — foi exatamente o que a implementação fez, com `buscarPorToken` fazendo o join versão↔orçamento para trazer tenant, número, hash e status num só read.

A mudança de status e a defesa contra aceite duplicado ficam na transação de `aprovarAceite` no repositório: advisory lock por `versao_id`, releitura do status do orçamento (filtrada por tenant), rejeição 409 se já aprovado ou versão inexistente, INSERT do aceite e UPDATE do status. O `UNIQUE(versao_id)` do schema é a rede final para uma corrida que escape do lock. SQL fica inteiramente fora do serviço, como manda a convenção.

A superfície de erro cobre os casos exigidos: 410 genérico para token inexistente / HMAC inválido / expirado (sem vazar se o token existe), 409 para orçamento já aprovado e para versão sem `pdf_hash`, 400 para justificativa vazia no aceite manual, 404 para orçamento inexistente, 409 para orçamento sem versão enviada. O hash gravado é o `pdf_hash` da versão (bytes do PDF), não o `crypto.ts#hashDocumento` de CPF/CNPJ — distinção correta e documentada.

O comprovante PDF reusa `pdfService.gerarPdf` com um HTML próprio determinístico contendo os campos de RF-021.2, usando o sufixo `-aceite` no número para não colidir com o PDF do orçamento. As evidências dinâmicas (IP, UA) passam por `escaparHtml` antes de entrar no HTML.

O escopo não vazou: nenhuma rota foi criada (tarefas 42/43 continuam `[~]`), e `htmlRenderer` é injetado mas deliberadamente não usado (wiring futuro), com `void _htmlRenderer` para satisfazer o lint.

<details>
<summary>Issues (3)</summary>

1. **RLS não setada na transação de aceite** — `aprovarAceite` usa `db.transaction()` sem `SET LOCAL app.current_tenant`; isolamento depende só do `WHERE tenant_id` aplicacional. Consistente com a convenção MVP (RLS efetiva na Fase 13), não bloqueante; revisitar na Fase 13 para garantir cobertura das policies.
2. **Duplicidade concorrente só coberta em integração** — o caminho em que dois aceites concorrentes passam pelo advisory lock e colidem no `UNIQUE(versao_id)` não é exercido pelos testes mock; o INSERT que estoura a constraint vira erro de banco, não `AppError(409)`. Garantir cobertura no teste de integração da Fase 13 e, se desejável, mapear o erro de unique para 409 no repositório.
3. **Comprovante PDF não persiste vínculo com o aceite** — `comprovantePdfPath`/`comprovantePdfHash` são retornados mas não gravados em `orcamento_aceites` (a tabela não tem colunas para isso). Fora do escopo da 41 e recuperável pelo nome determinístico do arquivo; registrar como lacuna caso RF-021 exija rastreabilidade persistida.

</details>

<details>
<summary>Details</summary>

### Localização da versão pelo token e validação do HMAC

`aprovarViaCliente` busca a versão por `buscarPorToken(token)` e trata token inexistente e HMAC inválido com a mesma mensagem 410 genérica (`!versao || !validarTokenPublico(input.token, versao.versaoId)`). Isso está correto frente ao formato `uuid.hmac` do `token.ts`: o HMAC é `HMAC(uuid, versaoId)`, então o serviço precisa primeiro do `versaoId` (vindo da linha) para validar — não há como derivar do token puro. A mensagem única evita um oráculo que distinguiria token inexistente de adulterado (confirmado em `token.ts` e no fluxo do serviço).

### Transação de aprovação e defesa contra duplicidade

```
aprovarAceite(trx):
  pg_advisory_xact_lock(hashtext(versaoId))   -- serializa a corrida
  SELECT o.status  (join versao→orcamento, WHERE tenant_id)   -- trava o estado
  status === null      -> AppError(409) versão não encontrada
  status === 'aprovado'-> AppError(409) duplicado
  INSERT orcamento_aceites (...)
  UPDATE orcamentos SET status='aprovado' WHERE tenant_id AND id = (subselect versao)
```

A serialização por advisory lock espelha `proximaVersaoSequencial` do versão-repo, um padrão já estabelecido no projeto. O lock evita que dois aceites concorrentes leiam ambos `status='enviado'` e insiram; o `UNIQUE(versao_id)` do schema (confirmado em `001_initial_schema.sql`) é a rede final caso a corrida escape. O serviço checa `statusOrcamento === 'aprovado'` antes mesmo de chamar o repo (fecha o caminho duplicado sem transação), e o repo repete a checagem sob lock — defesa em profundidade coerente.

Um aceite concorrente que passe os dois checks de status e colida no INSERT por `UNIQUE(versao_id)` levantará um erro de driver do Postgres, não um `AppError(409)` — o repositório não captura o erro de unique para remapeá-lo. Nos testes mock esse caminho não existe (não há banco), então é verificável só em integração. Não é bloqueante para a 41 (o lock cobre o caso normal e a constraint garante consistência), mas vale cobrir na Fase 13 e, se a UX precisar de 409 limpo nesse caso raro, mapear o erro.

### Superfície de erro e os códigos HTTP

Os códigos batem com o pedido da tarefa: 410 para token inválido/expirado, 409 para duplicado. O 409 extra para `pdfHash === null` ("documento sem hash de integridade") cobre o estado inconsistente de uma versão enviada sem o callback de PDF da Tarefa 40. `aceiteManual` valida `justificativa.trim().length === 0` cobrindo string vazia e só-espaços (RF-020.1), 404 para orçamento inexistente e 409 para orçamento sem versão enviada.

Em todos os caminhos de erro o serviço rejeita antes de persistir ou gerar PDF, e os testes afirmam que `aprovarAceite`, `gerarPdf` e/ou `registrar` não foram chamados — bom para garantir que uma falha de validação não deixe efeito colateral (comprovante órfão ou auditoria de um aceite que não aconteceu).

### Hash do documento e o comprovante PDF

O aceite grava `versao.pdfHash` (SHA-256 dos bytes do PDF emitido na Fase 8) como `hashDocumento`, não o `crypto.ts#hashDocumento` (que normaliza pontuação de CPF/CNPJ) — a distinção importa porque o segundo não serve para bytes binários. O comprovante usa o sufixo `-aceite` no número (`{numero}-aceite-v{versao}.pdf`) para não colidir com o PDF do orçamento, reusando o `pdfService` sem alterá-lo. As evidências dinâmicas (IP, UA) passam por `escaparHtml` antes de entrarem no HTML, evitando que um user agent com `<` quebre a estrutura do comprovante.

Uma lacuna de rastreabilidade: `comprovantePdfPath` e `comprovantePdfHash` são devolvidos no `AceiteRegistrado` mas não persistidos — `orcamento_aceites` não tem colunas para o PDF do comprovante. O arquivo é recuperável pelo nome determinístico (`{numero}-aceite-v{versao}.pdf`), então não há perda real, mas se RF-021 exigir o vínculo persistido entre aceite e comprovante, isso é uma extensão futura (nova coluna/migração), fora do escopo da 41.

### Auditoria distinguindo cliente de operador

`registrarAceite` chama `auditoriaService.registrar` com `acao: 'aprovar'` (cliente) ou `'aceite_manual'` (operador), `entidade: 'orcamentos'`, `entidadeId: versao.orcamentoId`, repassando IP/UA; no fluxo manual também passa `usuarioId`. Como `CriarEventoInput.acao` é `string` (confirmado em `auditoria.repository.ts`), os dois valores são aceitos sem mudança no contrato de auditoria. A auditoria roda depois da persistência, então um 409 do repo (duplicado) propaga sem registrar auditoria — comportamento verificado por teste (`registrar` não é chamado quando `aprovarAceite` rejeita).

### Isolamento por tenant sem o GUC de RLS

O repositório de aceite abre `db.transaction()` sem emitir `SET LOCAL app.current_tenant`. O isolamento vem do `WHERE tenant_id` no SELECT de status e no UPDATE do orçamento (confirmado). A migração `002_rls_policies.sql` já define a policy de `orcamento_aceites` via `EXISTS` no join com `orcamentos`, mas a nota da spec deixa claro que a RLS no banco só fica efetiva na Fase 13 (Tarefa 56); até lá o filtro aplicacional é a garantia. Portanto está alinhado à convenção vigente — registrado aqui para que a Fase 13 confirme que esta transação passa a setar o GUC e que as policies cobrem o fluxo de aceite.

### Aderência às convenções e escopo

Factories `criar*` com DI por argumento, interfaces de input/output exportadas (`AprovarViaClienteInput`, `AceiteManualInput`, `AceiteRegistrado`, `RegistrarAceiteInput`, `AceitePublico`, `VersaoPorToken`), `mapRow*` traduzindo snake↔camel, `COLUNAS_* as const`, imports ESM com `.js`, identificadores e comentários em pt-BR, erros via `AppError` — tudo presente. SQL só nos repositórios. O `htmlRenderer` injetado mas não usado é intencional (wiring futuro), com `void _htmlRenderer` para o lint — a evidência reporta a única linha descoberta (251–252) exatamente aí, sem lógica.

O escopo ficou dentro da 41: nenhuma rota pública (42) nem rota de aceite manual (43) foi criada; `tasks.md` mantém 42 e 43 em `[~]`. Os únicos arquivos tocados fora dos novos são as adições de leitura no versão-repo (necessárias para o serviço) e seus testes.

### Cobertura de testes

17 testes do serviço cobrem: caso feliz do cliente (campos no `aprovarAceite`, retorno), comprovante com os campos de RF-021.2 e sufixo `-aceite`, auditoria `aprovar`, comprovante sem IP/UA (ramo opcional), 410 token inexistente, 410 HMAC inválido, 410 expirado (relógio injetado), 409 duplicado (status já aprovado), 409 propagado do repo, 409 sem `pdfHash`; e no manual: 400 justificativa vazia, caso feliz operador, comprovante com método operador, auditoria `aceite_manual`, 404 orçamento inexistente, 409 sem versão, 409 propagado do repo. 8 testes do repositório cobrem insert com evidências + mudança de status, insert de operador com justificativa/usuário, ordem advisory-lock-antes-do-SELECT, 409 duplicado, 409 versão inexistente, mapeamento camelCase, e `buscarPorVersao` (hit/miss). Mais 4 testes para os métodos novos do versão-repo.

Not tested: a colisão real do `UNIQUE(versao_id)` sob concorrência (só integração); o comportamento das policies de RLS no banco (Fase 13). Ambos fora do alcance de testes mock e fora do escopo da 41.

### Evidências de verificação

A evidência (`task41-evidence.md`) reporta build e lint limpos (exit 0) e `test:coverage` com 40 arquivos / 450 testes passando, cobertura global 98.43% stmts / 91.95% branch acima do limite de 80%. Por arquivo: `aceite.service.ts` 98.62% stmts / 96.29% branch (única descoberta é o `void _htmlRenderer`), `orcamento-aceite.repository.ts` 100%, métodos novos do versão-repo cobertos. As suites novas aparecem nomeadas no relatório. Não re-executei as suites (conforme instrução); o diff lido é coerente com os números reportados.

</details>

<details>
<summary>Arquivos</summary>

- `backend/src/services/aceite.service.ts` — novo; serviço com `aprovarViaCliente` e `aceiteManual`, helper de comprovante, factory `criarAceiteService`.
- `backend/src/services/__tests__/aceite.service.test.ts` — novo; 17 testes mock-based do serviço.
- `backend/src/repositories/orcamento-aceite.repository.ts` — novo; `aprovarAceite` (transação com advisory lock + mudança de status) e `buscarPorVersao`.
- `backend/src/repositories/__tests__/orcamento-aceite.repository.test.ts` — novo; 8 testes mock-based do repositório.
- `backend/src/repositories/orcamento-versao.repository.ts` — alterado; `buscarPorToken`, `buscarVersaoAtualPorOrcamento`, interface `VersaoPorToken`, `mapRowVersaoPorToken`.
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` — alterado; +4 testes para os métodos novos.

Diff completo: `git diff` dos arquivos acote (arquivos ainda não commitados no branch `main`).

</details>

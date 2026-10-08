# Serviço puro de montagem do snapshot de orçamento (Tarefa 31)

Introduz `snapshot.service.ts`: uma factory `criarSnapshotService()` que monta o
snapshot JSONB imutável de um orçamento no momento da emissão (RF-008,
Correctness Properties nº 2 e nº 3). O serviço é puro — recebe `orcamento`,
`cliente`, `empresaCliente` opcional e um `Map` de responsáveis já resolvidos, e
devolve um objeto `OrcamentoSnapshot` em snake_case conforme a seção 5.2 do
design. Não há acesso a banco, persistência ou repositório; o mapeamento é feito
campo a campo com objetos/arrays literais novos, de modo que mutar as fontes após
a montagem não afeta o resultado. A suíte Vitest (9 casos) cobre a estrutura
completa, imutabilidade, não-compartilhamento de referência, os três ramos de
`null` (empresa, responsável, desconto global) e os totais.

Watch for: nada bloqueante. A "cópia profunda" é correta por valor neste caso
específico porque todos os campos mapeados são primitivos (confirmed) — vale
notar que a garantia depende dessa invariante, não de um clone estrutural; o
design e os testes já apoiam isso. A evidência de verificação (teste/build/lint)
está registrada no relatório do coder e foi lida como evidência (confirmed).

**Verdict**: APPROVED

## High-level view

O serviço cumpre o DoD de pureza: nenhum import de `db`, nenhuma dependência de
repositório — apenas `import type` das interfaces reais (`OrcamentoComItens`,
`OrcamentoItemPublico`, `ClientePublico`, `EmpresaPublica`, `ResponsavelPublico`,
`DescontoTipo`) com extensão `.js`, sem redefinir nem alterar nenhuma delas.

O mapeamento camelCase→snake_case bate exatamente com a seção 5.2 do design,
confirmado contra as interfaces dos repositórios: `tipoPessoa`→`tipo_pessoa`,
`razaoSocial`→`razao_social`, `valorUnitario`→`valor_unitario`,
`registroProfissional`→`registro_profissional`, etc. Os três ramos de
nulabilidade exigidos (`empresa_cliente`, `responsavel` do item,
`desconto_global`) estão implementados e testados.

A imutabilidade é provada por mutação real, não por igualdade: o teste altera
`cliente.nome`, `empresa.razaoSocial`, `item.nome` e `item.total` nas fontes
depois de montar e verifica que o snapshot permanece inalterado. A cópia é segura
porque, após o mapeamento, todo campo-folha é primitivo — a garantia depende dessa
invariante, não de um clone estrutural.

`data_emissao` é convertida de `Date` para string ISO `YYYY-MM-DD` via
`toISOString().slice(0, 10)` (UTC), tornando o valor determinístico e
JSON-serializável, alinhado ao `"2026-10-01"` do design.

O escopo foi respeitado: o commit toca apenas os quatro arquivos esperados
(serviço, teste, plano, evidências). Banco, migration, `versionamento.service.ts`,
rota de envio e `tasks.md` não foram alterados.

<details>
<summary>Issues (1)</summary>

1. **Garantia de cópia depende de campos primitivos** — não é um bug: a imutabilidade do snapshot está correta hoje porque todo campo-folha mapeado é primitivo. Se um campo objeto/array vindo da entrada for adicionado no futuro sem clone, a invariante quebra silenciosamente. Informativo; nenhuma ação exigida nesta tarefa.

</details>

<details>
<summary>Details</summary>

## Pureza e fronteira de dependências

O serviço não importa `db`, nenhum repositório concreto nem factory de
repositório — só tipos. As quatro interfaces de domínio chegam por `import type`
com extensão `.js` (Node16/ESM), exatamente como o DoD exige, e são usadas sem
redefinição. Os responsáveis chegam prontos num `Map<string, ResponsavelPublico>`
montado pelo chamador (Tarefa 32), o que mantém o serviço sem I/O: a resolução de
quem é cada responsável fica fora da fronteira pura.

## Mapeamento camelCase→snake_case vs. design 5.2

Conferido campo a campo contra as interfaces dos repositórios e contra o JSON da
seção 5.2:

```
ClientePublico.tipoPessoa          -> cliente.tipo_pessoa
EmpresaPublica.razaoSocial         -> empresa_cliente.razao_social
EmpresaPublica.nomeFantasia        -> empresa_cliente.nome_fantasia
OrcamentoItemPublico.valorUnitario -> itens[].valor_unitario
OrcamentoItemPublico.descontoTipo  -> itens[].desconto_tipo
ResponsavelPublico.registroProfissional -> responsavel.registro_profissional
OrcamentoComItens.condicoesPagamento    -> condicoes_pagamento
OrcamentoComItens.validadeDias          -> validade_dias
```

O conjunto de chaves do `OrcamentoSnapshot` e dos subtipos corresponde um a um ao
exemplo do design, incluindo a omissão deliberada de campos internos (`tenantId`,
`observacoes` do cliente, `ativo`, `criadoEm`) que não fazem parte do snapshot. O
objeto do item inclui o `responsavel` aninhado quando resolvido, como no design.

## Imutabilidade provada por mutação

O ponto do DoD que mais importa: o teste de imutabilidade não compara igualdade,
ele muta as fontes depois de montar e verifica que o snapshot não mudou.

```ts
cliente.nome = 'ALTERADO'
empresa.razaoSocial = 'ALTERADO'
item0.nome = 'ALTERADO'
item0.total = 99999
// snapshot.cliente.nome === 'Acme Ltda', snapshot.itens[0].total === 7200
```

Um segundo teste verifica que nem o array `itens` nem o objeto do item são a mesma
referência da entrada (`not.toBe`), fechando o caso de aliasing do array. A
corretude depende de uma invariante: após o mapeamento, todo campo-folha é
primitivo (`string`/`number`/`null`), então não há objeto da entrada
reaproveitado. É uma garantia estrutural implícita, não um clone profundo
genérico — se um dia um campo objeto/array da entrada for mapeado diretamente, a
imutabilidade quebraria sem o teste atual necessariamente pegar. Nota de
manutenção, não defeito desta entrega.

## Ramos de nulabilidade

Os três `null` exigidos estão cobertos e testados:

- `empresa_cliente` é `null` quando `empresaCliente` é ausente, `null` ou
  `undefined` — `montarEmpresa` trata os três casos e o teste exercita ausência e
  `null` explícito.
- `responsavel` do item é `null` quando `responsavelId` é `null` ou quando o id
  não está no `Map`. O código respeita `noUncheckedIndexedAccess` tratando o
  `undefined` do `.get()`, e o teste cobre tanto `responsavelId = null` quanto um
  id inexistente no Map.
- `desconto_global` é `null` a menos que tipo E valor estejam presentes. Isso
  espelha a função `descontoGlobal()` do repositório de orçamentos, onde os dois
  são obrigatórios juntos. O teste cobre os quatro casos: ambos presentes, ambos
  ausentes, só tipo, só valor.

## data_emissao determinística

`dataEmissao` é um `Date`; a coluna é `DATE` e o design mostra `"2026-10-01"`. A
conversão `toISOString().slice(0, 10)` produz `YYYY-MM-DD` em UTC, estável
independentemente do fuso do processo e serializável em JSON como string. O teste
confirma tanto o valor (`'2026-10-01'`) quanto o tipo (`typeof === 'string'`). A
escolha de UTC é documentada em comentário e evita a não-determinância de depender
do fuso local do processo.

## Totais copiados exatamente

`subtotal`, `total` e o `total` de cada item são copiados diretamente do
orçamento, sem recálculo — o que é correto para um snapshot (o snapshot preserva o
que foi calculado na emissão, não recomputa). O teste afirma os três valores
exatos (7200, 6840, 7200).

## Convenções e escopo

Estilo Prettier do projeto respeitado (aspas simples, sem ponto e vírgula, indent
2, trailing comma). Nomes e comentários em pt-BR. Teste em `__tests__/` ao lado do
código, com fixtures montados no próprio arquivo (sem mocks de repositório),
seguindo o padrão dos demais serviços. O commit `cf21529` toca somente os quatro
arquivos previstos; `git status` limpo. Banco, migration,
`versionamento.service.ts`, rota de envio e `tasks.md` intactos, conforme o DoD.

## Evidência de verificação

Conforme instruído, não reexecutei suíte, build nem lint. O relatório
`task31-snapshot-evidence.md` registra: 9 testes passando, `npm run build` com
exit 0 (TS estrito), `npm run lint` com exit 0 e 100% de cobertura
(stmts/branch/funcs/lines) no serviço. A evidência está presente e consistente
com o código lido, então não há motivo para spot-check adicional.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/services/snapshot.service.ts` — serviço puro de montagem do snapshot: interfaces exportadas, factory `criarSnapshotService`, mapeamento campo a campo.
- `backend/src/services/__tests__/snapshot.service.test.ts` — 9 testes Vitest (estrutura, imutabilidade por mutação, não-aliasing, ramos de null, totais, data_emissao).
- `.agents/tasks/task31-plan.md` — plano de implementação.
- `.agents/tasks/task31-snapshot-evidence.md` — relatório de evidências de verificação.

Diff completo: `git show cf21529`.

</details>

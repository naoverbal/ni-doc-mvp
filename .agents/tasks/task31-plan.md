# Implementation Plan — Tarefa 31: Serviço de snapshot

Serviço de montagem PURO que monta o snapshot JSONB imutável (cópia profunda, por
valor) dos dados de um orçamento no momento da emissão. Sem banco, sem persistência,
sem repositório. Persistência/versionamento são da Tarefa 32 — não tocar.

Requisito: RF-008. Correctness Properties nº 2 (imutabilidade) e nº 3 (integridade do
snapshot). Estrutura exata do JSONB: seção 5.2 do design (`.kiro/specs/ni-doc-mvp/design.md`).

## Decisões de design (registradas aqui, não é documento de design)

1. **`data_emissao` serializada como `YYYY-MM-DD` (string ISO de data).** O design 5.2
   mostra `"data_emissao": "2026-10-01"` e a coluna `orcamentos.data_emissao` é `DATE`.
   Como `OrcamentoComItens.dataEmissao` é um `Date` do JS, converter de forma
   determinística com `toISOString().slice(0, 10)` (UTC, sem hora/fuso). Determinístico e
   JSON-serializável. Documentar isso em comentário no serviço.

2. **`responsaveisPorId` como `Map<string, ResponsavelPublico>` recebido já resolvido.**
   Mantém o serviço puro (sem carregar dados vivos). O chamador (Tarefa 32) resolve os
   responsáveis. Para cada item com `responsavelId` ausente no Map, `responsavel` do item
   fica `null` (mesmo tratamento de "sem responsável"), pois o serviço não acessa banco.

3. **`empresaCliente` opcional (`EmpresaPublica | null | undefined`).** `empresa_cliente`
   no snapshot é `null` quando ausente. O `empresaClienteId` do orçamento não é consultado
   pelo serviço (serviço puro); quem monta o input decide passar a empresa ou não.

4. **`desconto_global`** é `null` quando `descontoGlobalTipo` OU `descontoGlobalValor` for
   `null`; preenchido com `{ tipo, valor }` quando ambos presentes. Espelha a lógica de
   `descontoGlobal()` do repositório de orçamentos (ambos obrigatórios).

5. **Cópia profunda por valor.** Todos os campos são primitivos (string/number/null) após o
   mapeamento camelCase→snake_case. Como o serviço constrói objetos/arrays literais NOVOS
   campo a campo (não faz spread dos objetos de entrada nem reusa o array `itens`), o
   resultado já é uma cópia profunda sem referências compartilhadas. Não há objetos aninhados
   vindos da entrada sendo reaproveitados. Isso é o que o teste de imutabilidade comprova.
   (Nenhum campo é objeto/array mutável vindo direto da entrada — `endereco`, por exemplo, é
   `string | null`.)

## Mapeamento campo-a-campo (camelCase entrada → snake_case snapshot)

cliente (de `ClientePublico`):
- `id` → `cliente.id`
- `nome` → `cliente.nome`
- `tipoPessoa` → `cliente.tipo_pessoa`
- `documento` → `cliente.documento`
- `email` (string|null) → `cliente.email`
- `telefone` (string|null) → `cliente.telefone`
- `endereco` (string|null) → `cliente.endereco`

empresa_cliente (de `EmpresaPublica`, ou `null`):
- `id` → `empresa_cliente.id`
- `razaoSocial` → `empresa_cliente.razao_social`
- `nomeFantasia` (string|null) → `empresa_cliente.nome_fantasia`
- `cnpj` (string|null) → `empresa_cliente.cnpj`
- `endereco` (string|null) → `empresa_cliente.endereco`

itens[] (de `OrcamentoItemPublico`):
- `ordem` → `ordem`
- `nome` → `nome`
- `descricao` (string|null) → `descricao`
- `quantidade` → `quantidade`
- `unidade` → `unidade`
- `valorUnitario` → `valor_unitario`
- `descontoTipo` (DescontoTipo|null) → `desconto_tipo`
- `descontoValor` (number|null) → `desconto_valor`
- `total` → `total`
- `responsavelId` → resolve em `responsavel` (objeto|null)

responsavel (de `ResponsavelPublico`, ou `null`):
- `id` → `responsavel.id`
- `nome` → `responsavel.nome`
- `registroProfissional` (string|null) → `responsavel.registro_profissional`

nível raiz (de `OrcamentoComItens`):
- `descontoGlobalTipo`/`descontoGlobalValor` → `desconto_global` (`{ tipo, valor }` | null)
- `subtotal` → `subtotal`
- `total` → `total`
- `condicoesPagamento` (string|null) → `condicoes_pagamento`
- `observacoes` (string|null) → `observacoes`
- `dataEmissao` (Date) → `data_emissao` (`YYYY-MM-DD`)
- `validadeDias` → `validade_dias`

## Comandos de verificação (rodar de `/Users/nilson/Dev/ni-doc/backend`)

- `npm run test -- --run src/services/__tests__/snapshot.service.test.ts`
- `npm run build`
- `npm run lint`

## Ciclo TDD — itens ordenados por dependência

- [ ] 1. Escrever o arquivo de teste completo (RED). Criar
      `src/services/__tests__/snapshot.service.test.ts` importando de `../snapshot.service.js`
      (ESM, extensão `.js`) e `import type` das interfaces reais dos repositórios
      (`OrcamentoComItens`, `OrcamentoItemPublico`, `ClientePublico`, `EmpresaPublica`,
      `ResponsavelPublico`, `DescontoTipo`) com extensão `.js`. Fixtures montados no próprio
      teste (sem banco, sem mocks de repositório), seguindo o padrão de `orcamentoMock()` em
      `orcamento.service.test.ts`. Casos obrigatórios: (1) monta snapshot completo copiando
      todos os campos de cliente, empresa, itens e totais, incluindo `responsavel` aninhado
      no item; (2) imutabilidade — após `montar`, mutar `cliente.nome='ALTERADO'`, mutar um
      item de origem e mutar a empresa de origem NÃO altera o snapshot já montado; (3)
      `empresa_cliente === null` quando `empresaCliente` ausente; (4) `responsavel === null`
      quando o item não tem `responsavelId` (e quando o id não está no Map); (5)
      `desconto_global === null` sem desconto global e `{ tipo, valor }` quando presente; (6)
      totais (`subtotal`, `total`, `total` de cada item) copiados exatamente; mais asserção de
      `data_emissao` no formato `YYYY-MM-DD`.
      Files: src/services/__tests__/snapshot.service.test.ts
      Verify: `npm run test -- --run src/services/__tests__/snapshot.service.test.ts` falha
      por módulo `../snapshot.service.js` inexistente (RED esperado).

- [ ] 2. Implementar o serviço (GREEN). Criar `src/services/snapshot.service.ts` seguindo o
      padrão factory `criar*` + interfaces exportadas (ver `orcamento.service.ts`). Exportar:
      `SnapshotCliente`, `SnapshotEmpresa`, `SnapshotResponsavel`, `SnapshotItem`,
      `SnapshotDescontoGlobal`, `OrcamentoSnapshot`, `MontarSnapshotInput`
      (`{ orcamento: OrcamentoComItens; cliente: ClientePublico; empresaCliente?: EmpresaPublica | null; responsaveisPorId: Map<string, ResponsavelPublico> }`),
      `SnapshotService` (`{ montar(input): OrcamentoSnapshot }`) e
      `criarSnapshotService(): SnapshotService`. `import type` das interfaces dos repositórios
      com extensão `.js`; NÃO redefinir nem alterar essas interfaces. Implementar o mapeamento
      campo-a-campo acima construindo objetos/arrays literais novos (cópia profunda por valor),
      resolver `responsavel` via `responsaveisPorId.get(item.responsavelId)` → objeto ou `null`,
      `desconto_global` conforme decisão 4, e `data_emissao` via
      `orcamento.dataEmissao.toISOString().slice(0, 10)` com comentário em pt-BR explicando o
      formato determinístico. Respeitar `noUncheckedIndexedAccess` (tratar `.get()` possivelmente
      `undefined`). Prettier: aspas simples, sem ponto e vírgula, indent 2, trailing comma all,
      print width 100. Comentários/nomes em pt-BR.
      Files: src/services/snapshot.service.ts
      Verify: `npm run test -- --run src/services/__tests__/snapshot.service.test.ts` — todos os
      testes passam (GREEN).

- [ ] 3. Verificação final (build + lint). Garantir tipos estritos e estilo. Se o lint/prettier
      apontar formatação, rodar `npm run format` e reexecutar.
      Files: (nenhum novo; ajustes de formatação se necessário)
      Verify: de `/Users/nilson/Dev/ni-doc/backend`, `npm run build` compila sem erros e
      `npm run lint` retorna sucesso; reexecutar o teste do item 2 e confirmar que continua passando.

## NÃO fazer
- Não persistir no banco, não criar migration.
- Não tocar em `versionamento.service.ts` (Tarefa 32) nem na rota de envio (Tarefa 33).
- Não marcar a tarefa concluída em `tasks.md`.
- Não alterar as interfaces existentes dos repositórios (apenas importá-las com `import type`).

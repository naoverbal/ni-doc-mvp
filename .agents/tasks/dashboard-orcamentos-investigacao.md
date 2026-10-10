# Investigação (read-only): dados de orçamento no backend para o Dashboard

Investigação somente-leitura do backend do ni-doc para fundamentar um Dashboard
de "panorama geral" de orçamentos no frontend. Nenhum arquivo foi alterado.

## Resumo executivo

- **Modelo de dados é rico o suficiente** para a maioria das métricas: a tabela
  `orcamentos` já tem `status`, `subtotal`, `total`, `data_emissao`, `criado_em`
  e `atualizado_em`; os status são `rascunho | enviado | aprovado | reprovado |
  expirado | cancelado` (CHECK na migration 001).
- **NÃO existe `aguardando aprovação` como status.** O estado "aguardando" é o
  `enviado` (orçamento versionado e enviado ao cliente, ainda sem decisão).
- **NÃO existe nenhum endpoint de agregação/estatística/dashboard** no backend.
  A única agregação presente é um `COUNT(*)` para o total da paginação em
  `GET /api/orcamentos`.
- **O endpoint de listagem (`GET /api/orcamentos`) já retorna, por orçamento, o
  `status` e o `total`** (além de `subtotal`, `dataEmissao`, `criadoEm`), com
  filtro por `status` e paginação. Isso viabiliza boa parte do dashboard **só no
  frontend**, desde que se busquem todas as páginas (hoje o default é 20/página).
- **O Dashboard atual é só um hub de atalhos** (`frontend/src/pages/Dashboard.tsx`)
  — não consome dado nenhum de orçamento.
- **`@fluentui/react-charts` NÃO está instalada** (confirmado: ausente de
  `frontend/package.json`; busca por `@fluentui/react-charts` em todos os
  `package.json` do repo retornou zero resultados).
- **Datas de aprovação/recusa não têm coluna própria** em `orcamentos`. O momento
  da decisão fica em `orcamento_aceites.criado_em` (e reflete em
  `orcamentos.atualizado_em`). Métricas de "valor aprovado por mês" dependem
  dessa origem — ver seção 5.

---

## 1. Modelo de dados do orçamento

### Tabela `orcamentos`
Fonte: `backend/src/db/migrations/001_initial_schema.sql` (seção ORÇAMENTOS) e
`backend/src/types/database.ts` (`OrcamentoTable`).

Colunas relevantes para métricas:

| Coluna | Tipo SQL | Observação |
|--------|----------|------------|
| `status` | `VARCHAR(20) NOT NULL DEFAULT 'rascunho'` | CHECK abaixo |
| `subtotal` | `NUMERIC(12,2) NOT NULL DEFAULT 0` | chega como **string** pelo driver `pg` |
| `total` | `NUMERIC(12,2) NOT NULL DEFAULT 0` | string pelo `pg` |
| `desconto_global_valor` | `NUMERIC(12,2)` (nullable) | string ou null |
| `data_emissao` | `DATE NOT NULL DEFAULT CURRENT_DATE` | data de emissão |
| `validade_dias` | `INTEGER NOT NULL DEFAULT 30` | base para expiração |
| `versao_atual` | `INTEGER NOT NULL DEFAULT 0` | 0 = ainda rascunho |
| `criado_em` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | criação |
| `atualizado_em` | `TIMESTAMPTZ NOT NULL DEFAULT NOW()` | última mudança (inclui decisão) |

**CHECK de status (verbatim da migration 001):**
```sql
status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
  CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'reprovado', 'expirado', 'cancelado')),
```
Espelhado em código em `backend/src/repositories/orcamento.repository.ts`:
```ts
export const STATUS_ORCAMENTO = [
  'rascunho', 'enviado', 'aprovado', 'reprovado', 'expirado', 'cancelado',
] as const
```

Índices úteis para agregação já existem:
```sql
CREATE INDEX idx_orcamentos_tenant  ON orcamentos(tenant_id);
CREATE INDEX idx_orcamentos_status  ON orcamentos(tenant_id, status);
CREATE INDEX idx_orcamentos_cliente ON orcamentos(cliente_id);
```

### Transições de status (quem muda o quê)
- `rascunho` → `enviado`: ao enviar/versionar
  (`backend/src/repositories/orcamento-versao.repository.ts`,
  `criarVersaoEnviar` faz `set({ status: 'enviado', versao_atual: versao, atualizado_em: new Date() })`).
- `enviado` → `aprovado` / `reprovado`: na decisão (cliente via link público ou
  operador via aceite manual), em
  `backend/src/repositories/orcamento-aceite.repository.ts` (`registrarDecisao`
  faz `set({ status: novoStatus, atualizado_em: new Date() })`).
- `expirado` / `cancelado`: previstos no CHECK, mas **não há código que os
  atribua** nas migrations 001–003 nem nos repositórios lidos (expiração estava
  marcada como "tarefa 42" nos comentários). Hoje, na prática, só circulam
  `rascunho`, `enviado`, `aprovado`, `reprovado`.

### Tabela `orcamento_itens`
`valor_unitario NUMERIC(12,2)`, `quantidade NUMERIC(12,4)`, `total NUMERIC(12,2)`,
`desconto_valor NUMERIC(12,2)`. Totais do orçamento já estão materializados em
`orcamentos.subtotal/total` — o dashboard **não precisa somar itens**.

### Tabela `orcamento_versoes` (imutável)
`enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()`, `versao`, `token_publico`,
`pdf_hash`, `expira_em`. É aqui que vive o **timestamp real do envio** de cada
versão (`enviado_em`), separado de `orcamentos.criado_em`.

### Tabela `orcamento_aceites`
`metodo ('cliente'|'operador')`, `criado_em TIMESTAMPTZ` (= **momento da decisão**),
`justificativa`, `hash_documento`, `UNIQUE (versao_id)`. **Não há coluna que
distinga aprovação de recusa aqui** — a distinção fica no `orcamentos.status`
resultante. Portanto "quando foi aprovado/recusado" = `orcamento_aceites.criado_em`
cruzado com o `status` final do orçamento.

> Importante: **não existe coluna `aprovado_em`/`reprovado_em`/`enviado_em` em
> `orcamentos`**. Datas de ciclo de vida ficam em tabelas vizinhas
> (`orcamento_versoes.enviado_em`, `orcamento_aceites.criado_em`) ou são
> aproximadas por `orcamentos.atualizado_em`.

---

## 2. Endpoints de orçamento existentes

Fonte: `backend/src/routes/orcamentos.routes.ts` (montado em `/api/orcamentos`
por `backend/src/app.ts`). Todas exigem autenticação (`router.use(autenticar)`).

| Método + path | O que faz | Retorno |
|---------------|-----------|---------|
| `POST /api/orcamentos` | cria rascunho | `201` + `OrcamentoComItens` |
| `GET /api/orcamentos` | lista do tenant | `200` + `ListaOrcamentos` |
| `GET /api/orcamentos/:id` | detalhe com itens | `200` + `OrcamentoComItens` |
| `PUT /api/orcamentos/:id` | atualiza (só rascunho) | `200` + `OrcamentoComItens` |
| `DELETE /api/orcamentos/:id` | exclui (só rascunho) | `204` |
| `POST /api/orcamentos/:id/enviar` | versiona + envia | `201` + versão |
| `POST /api/orcamentos/:id/aceite-manual` | aprova manual | `201` + aceite |

### `GET /api/orcamentos` — query params e shape
Query params aceitos (validados na própria rota):
- `status` — um dos valores de `STATUS_ORCAMENTO`; valor inválido → `400`.
- `pagina` — inteiro ≥ 1 (default 1).
- `tamanhoPagina` — inteiro ≥ 1 (default 20).
- **Não há filtro por período de data** (nem `de`/`ate`, nem por cliente).

**Não existe schema Zod de saída.** A rota responde `res.json(lista)` com o
objeto do repositório diretamente — o shape é definido pelas interfaces TS do
repositório (`backend/src/repositories/orcamento.repository.ts`):

```ts
export interface OrcamentoResumo {
  id: string
  numero: string
  titulo: string
  status: OrcamentoStatus
  clienteId: string
  subtotal: number   // já convertido de NUMERIC para number no mapRowResumo
  total: number
  versaoAtual: number
  dataEmissao: Date  // vira string ISO no JSON
  criadoEm: Date     // vira string ISO no JSON
}

export interface ListaOrcamentos {
  itens: OrcamentoResumo[]
  total: number        // COUNT(*) do tenant (com o mesmo filtro de status)
  pagina: number
  tamanhoPagina: number
}
```

Ou seja: **a listagem já traz `status` e `total` por orçamento**, mais
`subtotal`, `dataEmissao` e `criadoEm`. Ordenação fixa: `criado_em DESC`.
A conversão NUMERIC→number acontece em `mapRowResumo` (`Number(row.total)` etc.).

---

## 3. Existe endpoint de agregação/estatística?

**Não.** Busca por `dashboard | resumo | metrica | estatistica | agregad |
groupBy | group by | sum( | count(` em `backend/src/**/*.ts`:

- Nenhuma rota de dashboard/resumo/estatística/métrica.
- Nenhum método de repositório com `GROUP BY` ou `SUM`.
- A única agregação é o `COUNT(*)` da paginação em `listarPorTenant`
  (`backend/src/repositories/orcamento.repository.ts`):
  ```ts
  .select((eb) => eb.fn.countAll<string>().as('total'))
  ```
- `OrcamentoResumo` tem "resumo" no nome, mas é a linha enxuta da listagem, não
  uma agregação.

Routers registrados em `app.ts`: `auth`, `clientes`, `empresas`, `responsaveis`,
`orcamentos`, `templates`, `publico`. **Nenhum router de dashboard/estatística.**

---

## 4. O que o frontend já consome

### `frontend/src/pages/Dashboard.tsx`
Apenas um hub de atalhos (links para `/orcamentos` e, se admin, `/template`).
Lê só `usuario` do `useAuthStore`. **Não consome nenhum dado de orçamento, não
chama a API, não há cards nem gráficos.** É o esqueleto a ser substituído.

### `frontend/src/services/api.ts`
Wrapper fino de `fetch` com `credentials: 'include'`, base `/api`, helpers
`api.get/post/put/delete` e `ApiError`. Genérico — serve qualquer endpoint novo.

### `frontend/src/hooks/useOrcamentos.ts`
Hooks TanStack Query sobre os endpoints existentes:
- `useOrcamentos(filtro)` → `GET /orcamentos` com `status`/`pagina`/`tamanhoPagina`.
- `useOrcamento(id)`, `useCriarOrcamento`, `useAtualizarOrcamento`,
  `useExcluirOrcamento`, `useEnviarOrcamento`.
Chave de cache `['orcamentos', filtro]`. Nada de dashboard/agregação.

### `frontend/src/pages/OrcamentoLista.tsx`
Consome `useOrcamentos`, filtra por status, exibe tabela
(número, título, status, total). Tem o mapa de rótulos de status em pt-BR
(`ROTULO_STATUS`) — reaproveitável no dashboard. Usa emojis como ícones
(✎ 👁 🗑), coerente com a observação do usuário.

### Tipos TS do orçamento no front (`frontend/src/types/api.ts`)
`OrcamentoResumo` (status, subtotal, total, dataEmissao, criadoEm — datas como
`string` ISO), `ListaOrcamentos`, `ListarOrcamentosFiltro`, `OrcamentoStatus`
(mesmos 6 valores do backend), `OrcamentoComItens`. Prontos para o dashboard
sem backend novo, para o que der para calcular no cliente.

---

## 5. Viabilidade de cada métrica desejada

Legenda: **(A)** viável já, só frontend, a partir do `GET /orcamentos` existente ·
**(B)** exige endpoint novo de agregação no backend.

> Nota transversal sobre (A): hoje a listagem pagina de 20 em 20 e ordena por
> `criado_em DESC`. Para o dashboard calcular no cliente seria preciso buscar
> **todas as páginas** (ou pedir `tamanhoPagina` grande). Isso funciona para
> volumes pequenos/médios do MVP, mas não escala — e **não dá** para fazer
> "valor aprovado por mês" com fidelidade só com a listagem (ver abaixo). Por
> isso a recomendação acaba inclinando para um endpoint (B) de resumo.

### 5.1 Contagem por status (enviados / aguardando / aprovados / recusados)
**(A) Viável já.** "Aguardando aprovação" = `status === 'enviado'`. Duas opções:
- Barato: uma chamada por status usando `GET /orcamentos?status=X&tamanhoPagina=1`
  e ler `ListaOrcamentos.total` (o `COUNT(*)` já vem filtrado por status). 4–6
  chamadas pequenas, sem baixar linhas.
- Ou baixar tudo e contar no cliente.

### 5.2 Valor total aprovado por período (ex.: por mês)
**(B) Exige endpoint novo** para ter fidelidade. Motivo: a data da aprovação não
está em `orcamentos` (só o `status` atual e `atualizado_em`, que muda a cada
edição posterior). A data real da decisão está em `orcamento_aceites.criado_em`,
que a listagem não expõe. Dá para fazer uma aproximação só-front usando
`atualizado_em` dos aprovados, mas é impreciso. Esboço Kysely (não implementar):
```sql
SELECT date_trunc('month', a.criado_em) AS mes, SUM(o.total) AS total_aprovado
FROM orcamentos o
JOIN orcamento_versoes v ON v.orcamento_id = o.id
JOIN orcamento_aceites a ON a.versao_id = v.id
WHERE o.status = 'aprovado'
GROUP BY 1 ORDER BY 1;
```

### 5.3 Valor total enviado / em aberto
**(A) Viável já** (aproximado e suficiente para o MVP): somar `total` dos
orçamentos com `status === 'enviado'` (em aberto) e de `enviado + aprovado +
reprovado` (enviados no total), baixando as páginas. **(B)** vira preferível se
quiser SUM server-side por status (ver 6, endpoint de resumo).

### 5.4 Taxa de conversão (aprovados / enviados)
**(A) Viável já.** Deriva das contagens por status de 5.1:
`aprovados / (enviados + aprovados + reprovados + expirados)` — definir o
denominador conforme a regra de negócio desejada. Puro cálculo no cliente.

### 5.5 Evolução de orçamentos criados ao longo do tempo (série temporal)
**(A) Viável já** para "criados" (há `criadoEm` em cada linha): baixar e agrupar
por mês no cliente. **(B)** recomendado se o volume crescer ou se quiser a série
por `enviado_em`/`aprovado_em` (que a listagem não traz). Esboço (criados/mês):
```sql
SELECT date_trunc('month', criado_em) AS mes, COUNT(*) AS qtd
FROM orcamentos GROUP BY 1 ORDER BY 1;
```

### 5.6 Lista de recentes / aguardando há mais tempo
**(A) Viável já.** "Recentes" = `GET /orcamentos?tamanhoPagina=5` (já vem
`criado_em DESC`). "Aguardando há mais tempo" = `GET /orcamentos?status=enviado`
e ordenar ascendente no cliente (a API só ordena por `criado_em DESC`; para
grande volume, um `?ordenarPor=` seria um incremento futuro de (B)).

### Observação de arquitetura para os casos (B) — isolamento multi-tenant
Qualquer endpoint novo de agregação **não precisa** de `WHERE tenant_id` manual:
o middleware `tenant` (`backend/src/middlewares/tenant.ts`) executa
`SELECT set_config('app.current_tenant', <tenantId>, true)` e as policies de RLS
(migration 002) filtram automaticamente. **Ressalva:** `set_config(..., true)` é
*transaction-local*; para a agregação enxergar o setting, a query precisa rodar
**na mesma transação** em que o `set_config` foi aplicado. Os repositórios atuais
de leitura usam o `db` (fora de transação explícita) e dependem de a conexão
carregar o setting; um endpoint de agregação deve seguir o mesmo padrão de
leitura dos repositórios existentes (ou envolver `set_config` + query em
`db.transaction()` para garantia forte). Encaixe nas camadas, seguindo as
convenções do projeto:
- **route**: `backend/src/routes/dashboard.routes.ts` (novo), `GET /api/dashboard/...`,
  autenticado como as demais, registrado em `app.ts`.
- **service**: `criarDashboardService({ dashboardRepo })` (factory `criar*`).
- **repository**: `criarDashboardRepository({ db })` com os `GROUP BY/SUM` acima e
  `mapRow*` convertendo `NUMERIC` (string do `pg`) para `number`.
- **schema Zod de saída** opcional, coerente com o restante (hoje nenhuma rota
  valida saída, mas tipar a resposta seria uma melhoria).

---

## 6. Recomendação de faseamento

### Fase A — só frontend, reaproveitando `GET /api/orcamentos`
Entregável imediato, sem tocar no backend:
- Cards de **contagem por status** (incl. "aguardando" = `enviado`) via
  `GET /orcamentos?status=X&tamanhoPagina=1` lendo `total` (5.1).
- **Taxa de conversão** derivada dessas contagens (5.4).
- **Valor em aberto / enviado** somando `total` por status (5.3, aproximado).
- **Série de criados por mês** agrupando `criadoEm` no cliente (5.5).
- **Recentes** e **aguardando há mais tempo** via listagem + ordenação no
  cliente (5.6).
- Instalar `@fluentui/react-charts` em `frontend/package.json` (hoje ausente) e
  montar os gráficos; reusar `ROTULO_STATUS` de `OrcamentoLista.tsx` e manter
  rótulo textual + cor (status nunca só por cor — regra de acessibilidade).
- Limite conhecido: depende de baixar todas as páginas; aceitável no MVP.

### Fase B — endpoints novos de agregação no backend
Quando precisar de precisão temporal (data real de aprovação) ou escala:

| Método + path | Resposta (shape sugerido) |
|---------------|---------------------------|
| `GET /api/dashboard/resumo` | `{ porStatus: { rascunho, enviado, aprovado, reprovado, expirado, cancelado }, valorEmAberto, valorAprovado, taxaConversao }` — COUNT por status + SUM(total) por status, server-side |
| `GET /api/dashboard/aprovado-por-mes?de=&ate=` | `[{ mes: '2025-01', totalAprovado: number }]` — join `orcamentos`→`versoes`→`aceites`, `date_trunc('month', aceites.criado_em)`, SUM(`total`) (5.2) |
| `GET /api/dashboard/criados-por-mes?de=&ate=` | `[{ mes: '2025-01', qtd: number }]` — `date_trunc('month', criado_em)`, COUNT (5.5) |

Todos autenticados, isolados por RLS (via middleware `tenant`), seguindo
route → service → repository com factories `criar*` e `mapRow*`. Nenhum deles foi
implementado — são apenas o mínimo sugerido.

---

## Evidências (arquivos lidos)
- `backend/src/db/migrations/001_initial_schema.sql` — schema e CHECK de status.
- `backend/src/db/migrations/002_rls_policies.sql`, `003_seed_dev.sql` (sem colunas de data de decisão).
- `backend/src/types/database.ts` — tipos Kysely das tabelas.
- `backend/src/routes/orcamentos.routes.ts` — rotas e query params.
- `backend/src/services/orcamento.service.ts` — regras de negócio.
- `backend/src/repositories/orcamento.repository.ts` — `OrcamentoResumo`, `listarPorTenant`, único COUNT.
- `backend/src/repositories/orcamento-versao.repository.ts` — `enviado_em`, transição → `enviado`.
- `backend/src/repositories/orcamento-aceite.repository.ts` — decisão → `aprovado`/`reprovado`, `criado_em`.
- `backend/src/schemas/orcamento.schema.ts` — só schemas de entrada (sem schema de saída).
- `backend/src/app.ts` — routers registrados (nenhum de dashboard).
- `backend/src/middlewares/tenant.ts` — RLS via `set_config('app.current_tenant', ...)`.
- `frontend/package.json` — `@fluentui/react-charts` ausente.
- `frontend/src/pages/Dashboard.tsx`, `OrcamentoLista.tsx`, `hooks/useOrcamentos.ts`,
  `services/api.ts`, `types/api.ts`.

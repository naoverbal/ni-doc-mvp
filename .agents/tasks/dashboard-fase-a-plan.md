# Plano de Implementação — Dashboard de Panorama de Orçamentos (Fase A)

Tarefa **somente frontend** (React 19 + TypeScript strict + ESM). **Nenhuma**
mudança no backend, nenhum endpoint novo, nenhuma migração. **Não** implementar a
Fase B (agregação server-side, "valor aprovado por período"). Base factual:
`.agents/tasks/dashboard-orcamentos-investigacao.md`.

Todos os caminhos são absolutos sob `/Users/nilson/Dev/ni-doc/frontend`.

---

## Decisões de design (tomadas aqui, com justificativa breve)

Estas decisões foram verificadas no código/registro durante a exploração; não
reabrir.

1. **Biblioteca de gráficos: `@fluentui/react-charts@9.3.27`** (última estável).
   `npm view` confirma `peerDependencies.react: ">=16.14.0 <20.0.0"` — compatível
   com React 19.0.0. Suas deps são sub-pacotes v9 (`@fluentui/react-theme ^9.2.2`,
   `react-tabster`, `react-tooltip`, `react-utilities`), alinhadas a
   `@fluentui/react-components@9.74.9`. **Expectativa: instala sem conflito de
   peerDeps.** Se, ao instalar, aparecer `ERESOLVE`, **PARAR e relatar** — não usar
   `--legacy-peer-deps` sem aviso (regra do brief).

2. **Série temporal usa `VerticalBarChart`** (não `LineChart`). Motivo: a métrica é
   contagem de orçamentos criados por bucket (semana/mês/ano) — valores discretos
   por categoria. O `VerticalBarChart` aceita `data: VerticalBarChartDataPoint[]`
   com `x: string | number | Date` e `y: number`, o que mapeia direto para rótulos
   pt-BR já formatados (ex.: `"03/2025"`, `"2025-S03"`, `"2025"`), sem precisar
   montar a estrutura aninhada `ChartProps { lineChartData: LineChartPoints[] }` que
   o `LineChart` exige. Shapes confirmados no `index.d.ts` do pacote.

3. **Granularidade "semana" = semana ISO 8601** (segunda a domingo; semana 1 = a que
   contém a primeira quinta-feira do ano). Motivo: é o padrão internacional,
   determinístico e sem dependência de locale para o cálculo do número da semana.
   Documentar isso em comentário na função `agruparPorSemana`. Rótulo exibido:
   `"<ano>-S<ww>"` (ex.: `"2025-S03"`).

4. **Seletor de granularidade: `TabList` do Fluent** (não Dropdown). Motivo: são 3
   opções mutuamente exclusivas e sempre visíveis; `TabList` dá navegação por setas,
   `role="tablist"` nativo e rótulo via `aria-label`, atendendo acessibilidade sem
   ARIA manual. Estado controlado por `useState` na página.

5. **Estratégia de dados: baixar todas as páginas uma vez e derivar tudo no cliente.**
   O `GET /api/orcamentos` ordena fixo `criado_em DESC`, não tem filtro de período
   nem endpoint de agregação (investigação, seções 2–3). O hook faz um loop de
   páginas com `tamanhoPagina: 100` até cobrir `ListaOrcamentos.total`, concatena
   `itens` e entrega `OrcamentoResumo[]` à camada pura. **Limite conhecido**
   (documentar em comentário no hook): custo proporcional ao nº de orçamentos do
   tenant; aceitável no MVP; a Fase B troca só a fonte do hook sem reescrever a UI.

6. **Formatação monetária:** não há helper em `src/lib` (só `orcamento-calculo.ts`,
   sem formatação). `OrcamentoLista.tsx` tem um `formatarMoeda` local. Criar
   `src/lib/formato.ts` com `formatarMoeda`/`formatarPercentual` (puros, pt-BR via
   `Intl.NumberFormat`) e reusá-lo no Dashboard. **Não** refatorar `OrcamentoLista`
   agora (fora de escopo; evita quebrar seus testes) — deixar nota no novo arquivo
   de que o local pode migrar depois.

7. **`ROTULO_STATUS`:** extrair para `src/lib/orcamento-status.ts` e reusar em ambos
   os lugares, atualizando `OrcamentoLista.tsx` para importar de lá **sem** mudar seu
   comportamento (o objeto é idêntico). Isso evita duplicar o mapa de rótulos. Rodar
   os testes de `OrcamentoLista` para garantir que não quebrou.

---

## Arquivos a criar

| Caminho | Papel |
|---|---|
| `/Users/nilson/Dev/ni-doc/frontend/src/lib/orcamento-status.ts` | `ROTULO_STATUS` + `OPCOES_STATUS` (fonte única de rótulos pt-BR) |
| `/Users/nilson/Dev/ni-doc/frontend/src/lib/formato.ts` | `formatarMoeda`, `formatarPercentual` (puros, pt-BR) |
| `/Users/nilson/Dev/ni-doc/frontend/src/lib/dashboard-metricas.ts` | funções puras de agregação `OrcamentoResumo[] -> métricas` |
| `/Users/nilson/Dev/ni-doc/frontend/src/lib/__tests__/dashboard-metricas.test.ts` | testes unitários das funções puras |
| `/Users/nilson/Dev/ni-doc/frontend/src/hooks/useDashboardOrcamentos.ts` | hook TanStack Query que baixa todas as páginas |
| `/Users/nilson/Dev/ni-doc/frontend/src/components/dashboard/CardKpi.tsx` | card de KPI reutilizável (rótulo textual + número) |

## Arquivos a modificar

| Caminho | Mudança |
|---|---|
| `/Users/nilson/Dev/ni-doc/frontend/package.json` | adicionar `@fluentui/react-charts: 9.3.27` em `dependencies` |
| `/Users/nilson/Dev/ni-doc/frontend/src/pages/Dashboard.tsx` | **substituir** o hub por painel real |
| `/Users/nilson/Dev/ni-doc/frontend/src/pages/OrcamentoLista.tsx` | importar `ROTULO_STATUS`/`OPCOES_STATUS` de `@/lib/orcamento-status` (sem mudança de comportamento) |
| `/Users/nilson/Dev/ni-doc/frontend/src/pages/__tests__/Dashboard.test.tsx` | reescrever para o novo Dashboard |

> `App.tsx` **não** muda: a rota `/dashboard` já aponta para `Dashboard` e o
> `FluentProvider` já envolve a app.

---

## Assinaturas das funções puras (`src/lib/dashboard-metricas.ts`)

Entrada sempre `OrcamentoResumo[]` (de `@/types/api`). Datas chegam como string ISO.
Tudo puro, sem efeitos, testável isoladamente.

```ts
import type { OrcamentoResumo, OrcamentoStatus } from '@/types/api'

export type Granularidade = 'semana' | 'mes' | 'ano'

// Contagem por status: Record com TODOS os 6 status, zero quando ausente.
export function contarPorStatus(
  orcamentos: OrcamentoResumo[],
): Record<OrcamentoStatus, number>

// Soma de `total` dos orçamentos cujo status está em `statuses`.
export function somarTotalPorStatus(
  orcamentos: OrcamentoResumo[],
  statuses: OrcamentoStatus[],
): number

// Valor em aberto = soma de `total` dos 'enviado'.
export function valorEmAberto(orcamentos: OrcamentoResumo[]): number

// Valor enviado = soma de `total` dos que saíram de rascunho: enviado+aprovado+reprovado.
export function valorEnviado(orcamentos: OrcamentoResumo[]): number

// Taxa de conversão = aprovados / (enviado+aprovado+reprovado).
// Retorna null quando o denominador é 0 (a UI exibe '—'); senão fração 0..1.
export function taxaConversao(orcamentos: OrcamentoResumo[]): number | null

// Ponto da série temporal já pronto para o VerticalBarChart.
export interface PontoSerie {
  chave: string   // chave de ordenação canônica (ex.: '2025-03', '2025-W03', '2025')
  rotulo: string  // rótulo pt-BR para o eixo x (ex.: '03/2025', '2025-S03', '2025')
  quantidade: number
}

// Agrupa por `criadoEm` na granularidade pedida, ordenado asc pela chave canônica.
// Buckets sem orçamentos NÃO são preenchidos (série esparsa) — simples e suficiente p/ MVP.
export function agruparCriadosPorPeriodo(
  orcamentos: OrcamentoResumo[],
  granularidade: Granularidade,
): PontoSerie[]

// 5 mais recentes (entrada já vem criado_em DESC; só fatiar os 5 primeiros).
export function recentes(orcamentos: OrcamentoResumo[], limite?: number): OrcamentoResumo[]

// 'enviado' ordenados do mais antigo ao mais novo (asc por criadoEm); top 5.
export function aguardandoHaMaisTempo(
  orcamentos: OrcamentoResumo[],
  limite?: number,
): OrcamentoResumo[]

// Fatias do donut: uma por status COM contagem > 0, { legend: ROTULO_STATUS, data: contagem }.
export interface FatiaStatus {
  status: OrcamentoStatus
  legenda: string
  valor: number
}
export function distribuicaoPorStatus(orcamentos: OrcamentoResumo[]): FatiaStatus[]
```

Helpers internos (não exportados ou exportados só para teste, à escolha do implementador):
`numeroSemanaIso(d: Date): { ano: number; semana: number }` com comentário citando
ISO 8601; `chaveMes`/`rotuloMes` usando `Intl.DateTimeFormat('pt-BR', { month:'2-digit', year:'numeric' })`.

---

## Forma do hook (`src/hooks/useDashboardOrcamentos.ts`)

```ts
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type { ListaOrcamentos, OrcamentoResumo } from '@/types/api'

const TAMANHO_PAGINA = 100

// Baixa TODAS as páginas de /orcamentos (loop até cobrir ListaOrcamentos.total)
// e devolve a lista plana. Limite conhecido (MVP): custo ~ nº de orçamentos do
// tenant. Fase B substituirá este queryFn por um endpoint de agregação sem mexer
// na UI nem nas funções puras de dashboard-metricas.
async function buscarTodosOrcamentos(): Promise<OrcamentoResumo[]> { /* loop de páginas */ }

export function useDashboardOrcamentos() {
  return useQuery<OrcamentoResumo[], ApiError>({
    queryKey: ['dashboard', 'orcamentos', 'todos'],
    queryFn: buscarTodosOrcamentos,
  })
}
```

- `queryKey` distinta das chaves de `useOrcamentos` (`['orcamentos', filtro]`) para
  não colidir no cache.
- Expor `data`, `isLoading`, `isError` (mesma superfície que `OrcamentoLista` usa),
  para o Dashboard tratar os três estados.

---

## Estrutura da UI (`src/pages/Dashboard.tsx`)

Manter `<main id="conteudo">` (alvo do skip link — exigido pelos testes de layout) e
um `<h1>` descritivo. Textos pt-BR. Estilos via `makeStyles` + `tokens.*`
(nunca cor hard-coded). No máximo **um** `Button` `primary` na tela (o "Novo
orçamento" do EmptyState; nos demais estados, usar link/secondary).

Ordem de leitura e headings:

- `<h1>Painel de orçamentos</h1>` (ou "Panorama de orçamentos").
- **Estado carregando:** `Spinner` centralizado + skeletons dos cards
  (`Skeleton`/`SkeletonItem` do Fluent, 4–6 blocos). Região `role="status"
  aria-live="polite"` anunciando "Carregando panorama…".
- **Estado erro:** `<div role="alert">` com `MessageBar intent="error"` (padrão do
  Login) — "Não foi possível carregar o panorama. Tente novamente."
- **Estado vazio** (lista vem com 0 itens): bloco EmptyState inline — ícone Fluent
  (`DocumentAdd24Regular` ou similar) `aria-hidden`, título (`Text size={500}`),
  descrição (`Text size={300}`, `colorNeutralForeground2`) e **um** `Button
  appearance="primary"` "Novo orçamento" (link para `/orcamentos/novo`).
- **Estado com dados:**
  1. **Seção KPIs** (`<section aria-labelledby>` com `<h2>Indicadores</h2>`): grid de
     `CardKpi`. Cards de contagem: Aguardando (= `enviado`), Aprovados, Reprovados,
     Rascunhos (+ card opcional "Total de orçamentos"). Cards monetários:
     "Valor em aberto" (soma `total` de enviado) e "Valor total enviado" (enviado +
     aprovado + reprovado) — rótulo deixa claro o que cada valor representa. Card
     "Taxa de conversão" (percentual pt-BR; `—` quando denominador 0). Monetário via
     `formatarMoeda`; taxa via `formatarPercentual`.
  2. **Seção distribuição** (`<h2>Distribuição por status</h2>`): `DonutChart` com
     `data={{ chartTitle, chartData: fatias.map(f => ({ legend: f.legenda, data: f.valor })) }}`,
     `hideLegend={false}` (legenda com rótulo textual por fatia) e
     `chartTitleAccessibilityData={{ ariaLabel: 'Distribuição de orçamentos por status' }}`.
     Status nunca só por cor — a legenda textual é obrigatória.
  3. **Seção série temporal** (`<h2>Orçamentos criados</h2>`): `TabList` controlado
     (`aria-label="Granularidade"`) com `Tab` Semana/Mês/Ano + `VerticalBarChart`
     `data={pontos.map(p => ({ x: p.rotulo, y: p.quantidade }))}` com
     `chartTitle`/`chartTitleAccessibilityData` acessível. Trocar a tab só muda o
     estado de granularidade e reagrupa a MESMA base (sem refetch).
  4. **Seção listas acionáveis** (`<h2>` por lista): "Orçamentos recentes" (top 5) e
     "Aguardando há mais tempo" (`enviado` asc por `criadoEm`, top 5). Cada item:
     número, título, status (rótulo `ROTULO_STATUS` + cor via `data-status`, nunca só
     cor) e total (`formatarMoeda`), com `Link` para `/orcamentos/:id`. Reusar a
     semântica de tabela/lista acessível do `OrcamentoLista` (ou lista `ul`/`li` com
     link autoexplicativo — evitar "clique aqui").

`CardKpi.tsx` — props: `{ rotulo: string; valor: string; descricao?: string; icone?: ReactElement }`.
Usa `Card` do Fluent; `rotulo` em `Text size={200}`, `valor` em `Text size={700}
weight="bold"` (número grande); número de código/moeda pode usar
`fontFamilyMonospace`. Documentar o componente no inventário de `ui.md` (seção 3) por
ser reutilizável — ou mantê-lo em `components/dashboard/` como específico de tela.

---

## Estratégia de busca de dados e seu limite (resumo)

Buscar todas as páginas de `GET /orcamentos` com `tamanhoPagina=100`, somando até
cobrir `ListaOrcamentos.total`; derivar **todas** as métricas no cliente a partir do
array plano. **Limite:** não escala para tenants com muitos orçamentos (baixa tudo);
aceitável no MVP. Arquitetura preparada para Fase B: trocar apenas o `queryFn` do
hook por chamadas a endpoints de agregação, mantendo UI e funções puras intactas.
Documentar o limite em comentário no hook.

---

## Plano de testes

### Unitários — `src/lib/__tests__/dashboard-metricas.test.ts` (novo)
Seguir o estilo de `src/lib/__tests__/orcamento-calculo.test.ts` (Vitest, `describe/it`,
sem mocks — funções puras). Fixtures: arrays de `OrcamentoResumo` com status e datas
variados. Cobrir:
- `contarPorStatus`: conta certo e zera status ausentes (retorna os 6).
- `somarTotalPorStatus` / `valorEmAberto` / `valorEnviado`: somas corretas; ignora
  status fora do conjunto; lista vazia → 0.
- `taxaConversao`: caso normal; **divisão por zero → `null`** (denominador 0).
- `agruparCriadosPorPeriodo`: agrupamento por **semana ISO** (incluir caso de virada
  de ano/semana 1), por **mês** e por **ano**; ordenação asc por chave; rótulos pt-BR.
- `recentes` / `aguardandoHaMaisTempo`: fatiam top 5; "aguardando" só `enviado` e em
  ordem ascendente por `criadoEm`.
- `distribuicaoPorStatus`: só status com contagem > 0; legenda = `ROTULO_STATUS`.

### Componente — `src/pages/__tests__/Dashboard.test.tsx` (reescrever)
Seguir o padrão de `OrcamentoLista.test.tsx` (mock de `@/services/api` via
`vi.mock` + `vi.importActual`, `QueryClientProvider` com `retry:false`,
`MemoryRouter`). Como o hook baixa páginas, mockar `api.get` para resolver a
`ListaOrcamentos` (uma página cobre o `total`). Alternativa aceitável e mais isolada:
`vi.mock('@/hooks/useDashboardOrcamentos')` retornando `{ data, isLoading, isError }`
controlados — escolher uma e manter consistência. Também manter o
`useAuthStore.setState` do teste atual se o `<h1>`/saudação depender do usuário.
Casos:
- **Carregando:** `api.get`/hook pendente → região `role="status" aria-live="polite"`
  "Carregando…" visível.
- **Erro:** rejeição/`isError` → `role="alert"` com mensagem.
- **Vazio:** `itens: []`, `total: 0` → EmptyState com `Button`/link "Novo orçamento".
- **Com dados:** cards exibem números/moeda esperados (ex.: aguardando=2, aprovados=1,
  valor em aberto = soma esperada, taxa de conversão formatada); donut e série
  renderizam com título acessível.
- **Troca de granularidade:** clicar nas tabs Semana/Mês/Ano não dispara novo
  `api.get` (reagrupa no cliente) e atualiza a série/estado da tab selecionada.
- Preservar `<main id="conteudo">` e um `<h1>` (ajustar o teste de layout se ele
  checar o texto exato "início").

> **Atenção (confirmado):** `src/__tests__/rotas-layout.test.tsx` tem uma asserção
> que **vai quebrar** — o teste "em /dashboard (autenticado) o header e a nav
> 'Principal' do layout aparecem" verifica
> `screen.getByRole('heading', { level: 1, name: /início/i })`. Como o novo
> Dashboard renomeia o `<h1>` para "Painel de orçamentos", **atualizar essa
> asserção** para o novo nome (ou para um matcher que confirme só a presença de um
> `<h1>` dentro do `<main id="conteudo">`), **sem** enfraquecer as checagens de
> `banner`/`navigation`/landmark. Esse teste renderiza o `Dashboard` real sob o
> `LayoutApp`, então o hook `useDashboardOrcamentos` será chamado: envolver em
> `QueryClientProvider` (hoje o teste não tem um) **ou** mockar o hook/`api.get`
> para não disparar fetch real — alinhar com a abordagem escolhida no passo 9.
> Os polyfills de `ResizeObserver`/`matchMedia` já existem em
> `src/__tests__/setup.ts` — os gráficos Fluent dependem deles; se os charts
> exigirem outro polyfill (ex.: `getBoundingClientRect` com dimensões), acrescentar
> ao setup sem alterar produção.

### Regressão
Manter **todos** os demais testes passando — em especial `OrcamentoLista.test.tsx`
após o import de `ROTULO_STATUS` de `@/lib/orcamento-status`.

---

## Passos de implementação (ordenados por dependência)

- [ ] 1. Instalar `@fluentui/react-charts@9.3.27`.
      Rodar `npm install @fluentui/react-charts@9.3.27 -w @ni-doc/frontend` a partir
      da raiz do repo (workspaces). **Se o npm reportar `ERESOLVE`/conflito de
      peerDeps, PARAR e relatar — não usar `--legacy-peer-deps`.**
      Files: `/Users/nilson/Dev/ni-doc/frontend/package.json`,
      `/Users/nilson/Dev/ni-doc/package-lock.json`
      Verify: `npm ls @fluentui/react-charts -w @ni-doc/frontend` lista `9.3.27` sem
      erro; `cd frontend && npm run build` ainda compila.

- [ ] 2. Criar `src/lib/orcamento-status.ts` exportando `ROTULO_STATUS` e
      `OPCOES_STATUS` (conteúdo idêntico ao de `OrcamentoLista.tsx`) e trocar
      `OrcamentoLista.tsx` para importar de lá, removendo as const locais (sem mudar
      comportamento).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/lib/orcamento-status.ts`,
      `/Users/nilson/Dev/ni-doc/frontend/src/pages/OrcamentoLista.tsx`
      Verify: `cd frontend && npx vitest run src/pages/__tests__/OrcamentoLista.test.tsx`
      passa sem alterações no teste.

- [ ] 3. Criar `src/lib/formato.ts` com `formatarMoeda(valor: number): string`
      (`Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' })`) e
      `formatarPercentual(fracao: number | null): string` (pt-BR; `'—'` para `null`).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/lib/formato.ts`
      Verify: `cd frontend && npm run build` compila (funções puras tipadas).

- [ ] 4. Criar `src/lib/dashboard-metricas.ts` com as funções puras das assinaturas
      acima (contagens, somas, taxa com divisão por zero → `null`, série por
      semana ISO/mês/ano, recentes, aguardando, distribuição). Reusar
      `ROTULO_STATUS` de `@/lib/orcamento-status`. Comentar a escolha ISO week.
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/lib/dashboard-metricas.ts`
      Verify: `cd frontend && npm run build` compila.

- [ ] 5. Criar os testes unitários das funções puras.
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/lib/__tests__/dashboard-metricas.test.ts`
      Verify: `cd frontend && npx vitest run src/lib/__tests__/dashboard-metricas.test.ts`
      — todos os casos (incl. divisão por zero e virada de ano na semana ISO) passam.

- [ ] 6. Criar `src/hooks/useDashboardOrcamentos.ts` (loop de páginas,
      `tamanhoPagina=100`, `queryKey` própria, comentário do limite conhecido).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/hooks/useDashboardOrcamentos.ts`
      Verify: `cd frontend && npm run build` compila.

- [ ] 7. Criar `src/components/dashboard/CardKpi.tsx` (Card Fluent, rótulo textual +
      número grande, `tokens.*`, props tipadas).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/components/dashboard/CardKpi.tsx`
      Verify: `cd frontend && npm run build` compila.

- [ ] 8. Substituir `src/pages/Dashboard.tsx` pelo painel completo: estados
      loading/erro/vazio/dados; seções KPIs, DonutChart, VerticalBarChart com TabList
      de granularidade, e as duas listas acionáveis. `makeStyles`+`tokens`, pt-BR,
      no máximo um `primary`, status com rótulo+cor, `<main id="conteudo">` e `<h1>`.
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/pages/Dashboard.tsx`
      Verify: `cd frontend && npm run build` compila.

- [ ] 9. Reescrever `src/pages/__tests__/Dashboard.test.tsx` para o novo Dashboard
      (loading/erro/vazio/dados/troca de granularidade), mockando o hook/api como os
      demais testes. Ler e, se necessário, ajustar
      `src/__tests__/rotas-layout.test.tsx` (asserções sobre o Dashboard antigo) e
      `src/__tests__/setup.ts` (polyfills extras só se os charts exigirem).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/pages/__tests__/Dashboard.test.tsx`,
      (se preciso) `/Users/nilson/Dev/ni-doc/frontend/src/__tests__/rotas-layout.test.tsx`,
      `/Users/nilson/Dev/ni-doc/frontend/src/__tests__/setup.ts`
      Verify: `cd frontend && npx vitest run src/pages/__tests__/Dashboard.test.tsx`
      passa.

- [ ] 10. Verificação final completa do frontend.
      Verify, a partir de `/Users/nilson/Dev/ni-doc/frontend`:
      - `npm run lint` — zero erros (incl. `jsx-a11y`).
      - `npm run build` — `tsc && vite build` sem erros de tipo.
      - `npm test` — toda a suíte do frontend passa (sem regressão em
        `OrcamentoLista`, `rotas-layout`, demais).
      Verificação manual recomendada (fora do CI, documentar o que não foi testado
      por ferramenta): navegação por teclado nas tabs e links, foco visível, e
      que a conformidade WCAG AA plena ainda requer teste manual com leitor de tela.

---

## Resultado da verificação (iteração 1)

Executado em `/Users/nilson/Dev/ni-doc/frontend`:

1. **Dependência:** `@fluentui/react-charts@9.3.27` instalada (última estável).
   `peerDependencies.react` = `>=16.14.0 <20.0.0` → compatível com React 19.0.0;
   instalou **sem** `ERESOLVE` (nenhum `--legacy-peer-deps`). Fixada como
   `"9.3.27"` em `package.json` (sem `^`, seguindo a convenção do projeto);
   `package-lock.json` atualizado. `npm ls` confirma `@fluentui/react-charts@9.3.27`.
2. `npm run lint` → **zero erros** (inclui `eslint-plugin-jsx-a11y`).
3. `npm run build` (`tsc` strict + `vite build`) → **sem erros** de tipo.
   (Aviso informativo de chunk > 500 kB — pré-existente, não relacionado.)
4. `npm run test -- --run` → **127/127 passando** (16 arquivos). Sem regressão em
   `OrcamentoLista`, `rotas-layout` nem demais.

Notas:
- `src/__tests__/setup.ts` ganhou stubs de jsdom para SVG
  (`getComputedTextLength`/`getBBox`) e `HTMLCanvasElement.getContext`
  (`measureText`), exigidos pelo `@fluentui/react-charts` ao medir rótulos.
  Só afetam o ambiente de teste; produção inalterada.
- Granularidade "semana" implementada como **semana ISO 8601** (segunda a
  domingo; semana 1 contém a primeira quinta-feira do ano), documentada em
  comentário em `numeroSemanaIso`.
- Série temporal usa `VerticalBarChart` (contagem discreta por bucket).
- Verificação manual pendente (fora do CI): navegação por teclado nas tabs/links,
  foco visível e leitura por tecnologia assistiva — necessária para afirmar
  conformidade WCAG AA plena.

## Lembretes de conformidade (do brief e dos steerings)

- Prettier: aspas simples, **sem** ponto-e-vírgula, 2 espaços, trailing commas `all`,
  largura 100. Alias `@/` → `src/`. ESM.
- Tokens Fluent (`tokens.*`), **nunca** cor hard-coded; marca verde-sálvia (tom 60).
- **Status nunca só por cor** — sempre rótulo textual (`ROTULO_STATUS`).
- Ícones Fluent (`@fluentui/react-icons`), **não** emoji.
- No máximo **um** `Button appearance="primary"` por tela.
- Vocabulário de status real (6 valores); "aguardando" = `enviado`,
  "recusado" = `reprovado`. **Não** exibir "valor aprovado por período" (Fase B).
- `role="alert"` para erro; `aria-live="polite"` para status/carregamento;
  `aria-label`/`chartTitleAccessibilityData` nos gráficos; `lang="pt-BR"` já no root.

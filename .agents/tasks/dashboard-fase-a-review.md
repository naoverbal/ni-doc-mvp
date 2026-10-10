# Review — Dashboard de panorama de orçamentos (Fase A)

Painel de orçamentos que substitui o antigo hub de atalhos por um panorama real:
cards de KPI (contagens por status, valores em aberto/enviado, taxa de conversão),
DonutChart de distribuição por status, série temporal de orçamentos criados com
seletor de granularidade semana/mês/ano, e duas listas acionáveis (recentes e
aguardando há mais tempo). Toda a agregação é feita no cliente, a partir de um hook
que baixa todas as páginas de `GET /api/orcamentos`; a lógica de cálculo vive em
funções puras em `src/lib/dashboard-metricas.ts`, com testes unitários próprios. A
mudança é estritamente frontend e está isolada em um único commit
(`9e04089`), sem tocar backend, endpoints, migrações ou outras telas (exceto a
extração não-comportamental de `ROTULO_STATUS`/`OPCOES_STATUS` de `OrcamentoLista`).

Watch for: âncora de página inteira no estado vazio (`Button as="a" href`), em vez
de navegação client-side como no resto do painel (confirmado, não-bloqueante);
assimetria de acessibilidade entre os dois gráficos — o donut recebe
`chartTitleAccessibilityData` mas o `VerticalBarChart` só `chartTitle` (confirmado,
não-bloqueante). Nenhum achado bloqueante.

**Verdict**: APPROVED

## High-level view

A arquitetura separa com clareza as três camadas que a Fase B vai precisar trocar
sem reescrever a UI: o hook `useDashboardOrcamentos` é a única fonte de dados (um
loop de paginação com limite documentado em comentário), as funções puras de
`dashboard-metricas.ts` fazem toda a agregação, e `Dashboard.tsx` só compõe. A troca
de granularidade reagrupa a mesma base em memória (via `useMemo`), sem refetch —
confirmado tanto no código quanto no teste.

O vocabulário de status está correto e vem de uma fonte única (`orcamento-status.ts`):
"Aguardando" é rotulado explicitamente como "Enviados sem decisão" (= `enviado`), não
há "aguardando aprovação" inventado, e os seis status reais são preservados. A taxa de
conversão trata divisão por zero retornando `null`, que a UI exibe como "—". Moeda e
percentual usam `Intl.NumberFormat('pt-BR')`.

Acessibilidade: estados de carregamento (`role="status" aria-live="polite"`), erro
(`role="alert" aria-live="assertive"`) e vazio estão presentes; status sempre com
rótulo textual (nunca só cor); gráficos com título acessível; headings hierárquicos
e landmarks. Dois pontos menores de polimento (anchor no empty state, assimetria de
`chartTitleAccessibilityData` entre os gráficos) não bloqueiam.

Regras de UI respeitadas: nenhuma cor hard-coded (tudo via `tokens.*`), um único
`Button appearance="primary"` (no empty state), ícones Fluent em vez de emoji,
`@fluentui/react-charts@9.3.27` pinada exatamente e presente no lockfile.

Verificação: não re-executei as suítes. A evidência registrada pelo coder no plano
("Resultado da verificação — iteração 1") reporta lint zero erros, build `tsc`+`vite`
limpo e 127/127 testes passando. Spot-checks estreitos que fiz corroboram: o pacote
de charts está instalado em 9.3.27 e os símbolos usados (`DonutChart`,
`VerticalBarChart`, `chartData`, `chartTitleAccessibilityData`) existem nos tipos
instalados.

<details>
<summary>Issues (4)</summary>

1. **Anchor no empty state** — `Button as="a" href="/orcamentos/novo"` força reload
   de página inteira, diferente da navegação client-side (`RouterLink`) usada nas
   listas. Trocar por `as={RouterLink} to="/orcamentos/novo"` por consistência.
   Não-bloqueante.
2. **Assimetria de a11y entre gráficos** — o `VerticalBarChart` recebe só
   `chartTitle`, enquanto o donut recebe `chartTitleAccessibilityData`. Considerar
   adicionar `chartTitleAccessibilityData` ao bar chart para paridade. Não-bloqueante.
3. **Rota `/orcamentos/novo` não verificada** — o alvo do botão do empty state não foi
   confirmado na árvore de rotas; se não existir, o CTA leva a 404. Verificar.
   Não-bloqueante (fora do diff).
4. **Limite de paginação sem teto rígido** — o loop baixa todas as páginas; o limite
   está documentado em comentário (aceitável no MVP), mas não há guarda de teto máximo.
   Informativo, alinhado ao plano. Não-bloqueante.

</details>

<details>
<summary>Details</summary>

## Separação de camadas e prontidão para a Fase B

A agregação está inteiramente em `src/lib/dashboard-metricas.ts` como funções puras
sobre `OrcamentoResumo[]` — `contarPorStatus`, `somarTotalPorStatus`, `valorEmAberto`,
`valorEnviado`, `taxaConversao`, `agruparCriadosPorPeriodo`, `recentes`,
`aguardandoHaMaisTempo`, `distribuicaoPorStatus`. Nenhuma delas toca rede, estado ou
DOM, o que as torna testáveis isoladamente e deixa a UI como mera composição. O hook
`useDashboardOrcamentos` é a única fronteira de dados: um `queryFn` que itera as
páginas de `GET /orcamentos` com `tamanhoPagina=100` até cobrir `ListaOrcamentos.total`.
A separação atende diretamente o requisito de "trocar só a fonte do hook na Fase B": a
UI consome `data/isLoading/isError` e as funções puras consomem o array plano; nenhuma
das duas sabe de onde os dados vieram.

A estratégia de paginação e seu custo (proporcional ao número de orçamentos do tenant)
estão documentados em comentário no hook, como o plano exigia. Há uma guarda contra
`total` inconsistente (`lista.itens.length === 0` quebra o loop), evitando laço
infinito se o backend devolver uma página vazia. Não existe teto rígido de páginas,
mas isso é coerente com a decisão de design registrada no plano (limite conhecido,
aceitável no MVP).

## Métricas e vocabulário de status

As contagens cobrem os seis status reais do domínio; `contarPorStatus` inicializa
todos em zero e nunca inventa "aguardando aprovação" — "Aguardando" é o rótulo de
UI para `enviado`, deixado explícito pela descrição do card ("Enviados sem decisão").
`valorEmAberto` soma `total` dos `enviado`; `valorEnviado` soma `enviado + aprovado +
reprovado`; os rótulos dos cards ("Valor em aberto" / "Valor total enviado") mais as
descrições deixam claro o que cada número representa, atendendo o requisito de rótulos
inequívocos.

`taxaConversao` é o ponto sensível de divisão por zero e está correto:
`aprovado / (enviado + aprovado + reprovado)`, retornando `null` quando o denominador
é zero. A UI canaliza esse `null` por `formatarPercentual`, que exibe "—". O teste
`taxaConversao` cobre o caso normal, a exclusão de rascunho/expirado/cancelado do
denominador, e os dois caminhos de denominador zero (lista vazia e só rascunho).

Formatação pt-BR via `Intl.NumberFormat('pt-BR', ...)` para moeda (BRL) e percentual.
O percentual usa `minimumFractionDigits: 0 / maximumFractionDigits: 1`, de modo que
0.25 vira "25%" — exatamente o que o teste de componente afirma.

## Série temporal e critério de semana ISO

`agruparCriadosPorPeriodo` reagrupa `criadoEm` em semana/mês/ano usando uma chave
canônica ordenável (`2025-03`, `2025-W03`, `2025`) e um rótulo pt-BR separado para o
eixo (`03/2025`, `2025-S03`, `2025`). A separação chave/rótulo é a decisão certa:
ordena pela chave e exibe o rótulo, sem depender de locale para ordenar. A granularidade
"semana" é semana ISO 8601, com o critério documentado em comentário em
`numeroSemanaIso` (segunda a domingo; semana 1 contém a primeira quinta-feira) e o
cálculo feito em UTC para não deslocar por fuso. O teste cobre explicitamente a virada
de ano (01/01/2021 → semana 53 de 2020), que é o caso em que implementações ingênuas
erram.

A troca de granularidade é client-side: `granularidade` é `useState` na página, a série
é `useMemo([orcamentos, granularidade])`, e o teste "troca a granularidade sem refazer a
busca" confirma que clicar na tab "Ano" não dispara nova chamada com argumentos
diferentes. O `TabList` com `aria-label="Granularidade da série"` dá `role="tablist"`
nativo e navegação por setas sem ARIA manual.

Quando a série está vazia, em vez de renderizar um gráfico vazio o painel mostra um
texto `role="status" aria-live="polite"` ("Sem orçamentos no período para exibir").

## Acessibilidade

Os três estados exigidos estão presentes e com a semântica correta: carregando em
`role="status" aria-live="polite"` com `Spinner` + skeleton; erro em
`role="alert" aria-live="assertive"` com `MessageBar intent="error"`; vazio com ícone
Fluent `aria-hidden`, título, descrição e um CTA. Status nunca é comunicado só por cor
— `ItemOrcamento` sempre renderiza `ROTULO_STATUS[status]` como texto, com a cor via
`data-status` apenas como reforço. As legendas do donut também são os rótulos textuais
(`distribuicaoPorStatus` injeta `ROTULO_STATUS` em cada fatia e `hideLegend={false}`).

Estrutura de headings coerente (`h1` da página, `h2` por seção), landmarks (`main`,
`section` com `aria-labelledby`), listas semânticas (`ul`/`li`) e links de item
autoexplicativos (`número — título`, nunca "clique aqui"). O `<main id="conteudo">` —
alvo do skip link — é preservado em todos os estados, e o teste de rotas-layout foi
atualizado para o novo `<h1>` sem enfraquecer as checagens de banner/navigation.

Dois pontos de polimento, ambos não-bloqueantes. O CTA do empty state é
`Button as="a" href="/orcamentos/novo"`: funcionalmente é um link com nome acessível,
mas provoca navegação de página inteira em vez do client-side `RouterLink` usado nas
listas — inconsistência de UX, não de acessibilidade. E há assimetria entre os gráficos:
o donut passa `chartTitleAccessibilityData.ariaLabel`, enquanto o `VerticalBarChart`
só passa `chartTitle`; ambos ficam com nome acessível, mas valeria dar ao bar chart o
mesmo `chartTitleAccessibilityData` para paridade.

## Escopo e extração de ROTULO_STATUS

O diff do commit toca apenas 13 arquivos, todos de frontend/dashboard: nada de backend,
rota, migração, `global.css` ou outras telas. A única mudança fora do dashboard é a
extração de `ROTULO_STATUS` e `OPCOES_STATUS` para `src/lib/orcamento-status.ts`, com
`OrcamentoLista.tsx` passando a importar de lá. A comparação do diff mostra que o
conteúdo movido é idêntico (mesmos seis rótulos, mesma ordem), então o comportamento da
lista não muda — a evidência de 127/127 testes passando inclui `OrcamentoLista.test.tsx`
intacto. O `formatarMoeda` local de `OrcamentoLista` foi deixado como estava, com nota no
novo `formato.ts` de que pode migrar depois — fora de escopo, decisão correta para não
mexer nos testes da lista.

Não há "valor aprovado por mês" nem qualquer agregação temporal server-side (Fase B),
como exigido. A série temporal é só de orçamentos *criados*, derivada de `criadoEm`, que
a listagem já expõe.

## Dependência e verificação

`@fluentui/react-charts` entra como `"9.3.27"` em `dependencies` — versão exata, sem
`^`, seguindo a convenção de pinagem do projeto — e está presente no `package-lock.json`
na mesma versão. A evidência registrada no plano afirma que instalou sem `ERESOLVE`
(peerDeps compatíveis com React 19) e sem `--legacy-peer-deps`.

Não re-executei lint/build/test, conforme instruído. A evidência do coder (plano, seção
"Resultado da verificação — iteração 1") reporta lint zero erros (incl. `jsx-a11y`),
build `tsc` strict + `vite build` sem erros de tipo, e 127/127 testes em 16 arquivos sem
regressão. Fiz dois spot-checks estreitos que sustentam essa evidência: (1) o pacote está
instalado em 9.3.27 e pinado; (2) os símbolos consumidos pelo Dashboard — `DonutChart`,
`VerticalBarChart`, `chartData`, `chartTitleAccessibilityData` — existem nos tipos
instalados, o que é consistente com um build de tipos limpo. Os stubs de jsdom
(`getComputedTextLength`/`getBBox`/`getContext`) adicionados a `setup.ts` são restritos
ao ambiente de teste e não tocam produção.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `frontend/package.json` — adiciona `@fluentui/react-charts: 9.3.27` (pinado).
- `frontend/src/lib/orcamento-status.ts` — novo; fonte única de `ROTULO_STATUS` / `OPCOES_STATUS`.
- `frontend/src/lib/formato.ts` — novo; `formatarMoeda` / `formatarPercentual` puros pt-BR.
- `frontend/src/lib/dashboard-metricas.ts` — novo; funções puras de agregação (contagem, soma, taxa, série ISO, listas, distribuição).
- `frontend/src/lib/__tests__/dashboard-metricas.test.ts` — novo; testes das funções puras (incl. divisão por zero e virada de ano ISO).
- `frontend/src/hooks/useDashboardOrcamentos.ts` — novo; hook TanStack Query que baixa todas as páginas.
- `frontend/src/components/dashboard/CardKpi.tsx` — novo; card de KPI (tokens Fluent, rótulo + número grande).
- `frontend/src/pages/Dashboard.tsx` — substitui o hub por painel completo (estados, KPIs, donut, série, listas).
- `frontend/src/pages/OrcamentoLista.tsx` — passa a importar `ROTULO_STATUS`/`OPCOES_STATUS` do novo módulo (sem mudança de comportamento).
- `frontend/src/pages/__tests__/Dashboard.test.tsx` — reescrito para o novo Dashboard (loading/erro/vazio/dados/troca de granularidade).
- `frontend/src/__tests__/rotas-layout.test.tsx` — mocka o hook do dashboard e atualiza a asserção do `<h1>`.
- `frontend/src/__tests__/setup.ts` — stubs de jsdom para medição SVG/canvas exigidos pelos charts (só teste).
- `package-lock.json` — lockfile atualizado com a nova dependência.

Diff completo: `git show 9e04089`.

</details>

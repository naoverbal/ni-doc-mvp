# Plano de Implementação — Layout e Navegação da Área Logada

## Visão geral

Tarefas para a casca de navegação da área logada. Seguem o ciclo TDD (teste →
falha → implementação → verde → refatora), referenciam o requisito que
implementam e só são concluídas com testes passando e lint (incluindo
`eslint-plugin-jsx-a11y`) sem avisos. Execução de uma tarefa por sessão,
conforme a convenção do workspace.

## Tasks

- [x] 1. Base de estilo global (mobile-first)
  - Criar `frontend/src/styles/global.css` com reset leve, tipografia base,
    cores com contraste AA documentado no topo do arquivo, estilos de
    `.app-header`/`.app-nav`, estado de link atual (cor + reforço não-cromático)
    e `:focus-visible` preservado/reforçado
  - Responsividade mobile-first (RF-L06): estilos base ≥ 320 px e `min-width`
    media queries para tablet (~600 px) e desktop (~1024 px); unidades fluidas,
    sem larguras fixas que forcem rolagem horizontal; breakpoints documentados
    no topo do arquivo; alvos de toque ~44×44 px no mobile
  - Importar o CSS uma única vez em `frontend/src/main.tsx`
    (`import '@/styles/global.css'`)
  - Confirmar a meta viewport responsiva em `frontend/index.html` (não remover)
  - DoD: CSS carregado na aplicação; nenhum `outline: none` sem alternativa;
    sem rolagem horizontal a 320 px; build do frontend passa; paleta/contrastes
    e breakpoints anotados para revisão
  - _Requisitos: RF-L05, RF-L06_

- [x] 2. Componente de layout da área logada (`LayoutApp`)
  - Criar `frontend/src/components/LayoutApp.tsx` com, nesta ordem: skip link
    "Pular para o conteúdo" (`href="#conteudo"`) como primeiro elemento focável,
    `<header>` (marca + `<NavPrincipal>` + nome do usuário + botão "Sair") e
    `<Outlet />` (sem `<main>` próprio — o `<main>` fica nas páginas)
  - Tratar `usuario` nulo sem quebrar (identidade renderizada condicionalmente)
  - Criar `frontend/src/components/NavPrincipal.tsx` com `<nav aria-label="Principal">`,
    `NavLink`s para Dashboard e Orçamentos, e Template apenas quando
    `usuario?.papel === 'admin'`; aplicar `aria-current="page"` no link ativo
  - Logout resiliente: botão `type="button"` que chama
    `useLogout().mutateAsync()` e, em `finally`, limpa o estado local e navega
    para `/login` (replace) mesmo em erro de rede; `disabled`/rótulo "Saindo…"
    enquanto pendente
  - Testes (`frontend/src/components/__tests__/LayoutApp.test.tsx`): renderiza
    skip link como primeiro focável; header/nav/links; mostra nome do usuário e
    não quebra com usuário nulo; exibe Template para admin e oculta para
    operador; marca link ativo com `aria-current`; "Sair" em sucesso E em erro
    limpa estado e navega para `/login` (mock de `useLogout`)
  - DoD: testes passam; `eslint-plugin-jsx-a11y` sem avisos; exatamente um
    `<header>`/`<nav aria-label="Principal">` no layout
  - _Requisitos: RF-L01, RF-L02, RF-L04_

- [x] 3. Dashboard navegável
  - Reescrever `frontend/src/pages/Dashboard.tsx`: `<main id="conteudo">` com
    `<h1>` descritivo, saudação com o nome do usuário e
    `<nav aria-label="Atalhos">` com `<Link>` para Orçamentos e (admin) Template
  - Remover o placeholder `<h1>Dashboard</h1>`
  - Garantir `id="conteudo"` no `<main>` das demais páginas da área logada
    (`OrcamentoLista`, `OrcamentoEditor`, `TemplateEditor`), alvo do skip link
  - Testes (`frontend/src/pages/__tests__/Dashboard.test.tsx`): renderiza `<h1>`
    e atalhos; Template condicionado ao papel; atalhos são links navegáveis
  - DoD: testes passam; `eslint-plugin-jsx-a11y` sem avisos
  - _Requisitos: RF-L03, RF-L04_

- [x] 4. Reorganizar rotas com layout aninhado
  - Alterar `frontend/src/App.tsx`: criar um grupo de rota
    `<Route element={<PrivateRoute><LayoutApp /></PrivateRoute>}>` com as rotas
    privadas (`/dashboard`, `/orcamentos`, `/orcamentos/novo`, `/orcamentos/:id`,
    `/template`) aninhadas; manter `/login`, `/publico/orcamento/:token` e `*`
    fora do layout
  - Garantir que `PrivateRoute` permanece inalterado internamente e continua
    protegendo o grupo
  - Testes de integração (opcional, `frontend/src/__tests__/`): em `/dashboard`
    o header/nav do layout aparece; em `/login` e numa rota inexistente
    (`NaoEncontrado`) não aparece
  - Adaptar a tabela de `frontend/src/pages/OrcamentoLista.tsx` para telas
    estreitas: envolver a `<table>` em um contêiner com `overflow-x: auto`
    (rolagem só na tabela), sem introduzir rolagem horizontal na página a 320 px
  - DoD: navegação funciona de ponta a ponta sem digitar URL; não há `<main>`
    duplicado em nenhuma tela; a tabela não quebra o layout no mobile;
    testes/lint/build passam
  - _Requisitos: RF-L01, RF-L05, RF-L06_

- [x] 5. Verificação de acessibilidade e navegação por teclado
  - Rodar `npm run lint` no frontend e resolver quaisquer avisos de
    `eslint-plugin-jsx-a11y`
  - Verificar o fluxo por teclado (Tab/Shift+Tab/Enter): foco visível, ordem
    lógica, link atual perceptível sem depender de cor, logout acionável por
    teclado
  - Verificar responsividade (RF-L06): nas três faixas (mobile ≥ 320 px, tablet
    ~768 px, desktop ≥ 1024 px) via DevTools, e o Reflow a 320 px / zoom 400% —
    sem rolagem horizontal, sem perda de conteúdo, navegação e tabela utilizáveis
  - Conferir contraste da paleta introduzida na tarefa 1 (ferramenta/manual) e
    registrar o que foi verificado em código vs. o que requer teste manual com
    tecnologia assistiva
  - DoD: lint limpo; checklist de teclado e de responsividade cumpridos; nota de
    verificação registrada
  - _Requisitos: RF-L05, RF-L06_

- [ ] 6. Testes da navegação no app shell Fluent (NavLink e subrotas)
  - Contexto: o shell atual é `components/layout/AppShell` + `Sidebar` +
    `NavPrincipal`, com itens em `components/layout/itens-navegacao.ts`
    (`fim` controla o `end` do `NavLink`). Cobrir com testes o que o design
    define e hoje só está documentado em comentário
  - Criar `frontend/src/components/__tests__/NavPrincipal.test.tsx` (MemoryRouter
    \+ `FluentProvider`, store de auth preenchido):
    - `aria-current="page"` apenas no item da rota atual;
    - "Orçamentos" permanece ativo em `/orcamentos`, `/orcamentos/novo` e
      `/orcamentos/:id` (sem `fim`); "Dashboard" e "Template" só ativam na rota
      exata (`fim`);
    - "Template" aparece para `admin` e não existe para `operador`;
    - itens sem rota (Clientes, Empresas etc.) não são links nem focáveis e
      têm nome acessível "…, em breve" (`aria-disabled`);
    - modo colapsado mantém nome acessível (`aria-label`) nos links
  - Garantir exatamente um `<nav aria-label="Principal">` por tela e que o
    skip link continua sendo o primeiro focável no `AppShell`
  - DoD: testes passam; `eslint-plugin-jsx-a11y` sem avisos
  - _Requisitos: RF-L01.2, RF-L01.3, RF-L01.4, RF-L01.6, RF-L04.1, RF-L04.2_

- [ ] 7. Alvos de toque no shell Fluent (mobile)
  - `NavPrincipal.tsx` define `minHeight: '40px'` nos itens, abaixo da mira de
    ~44×44 px do RF-L06.5; elevar para ≥ 44 px (token/`clamp`, sem valor solto
    fora do padrão do projeto), ao menos no Drawer mobile (< 640 px) e para os
    controles do `Header` (toggle/hambúrguer, tema, "Sair")
  - Conferir que `global.css` (`button { min-height: var(--alvo-toque) }`) não
    é a única garantia: os botões Fluent do shell não herdam essa regra
  - Teste de componente que verifique a altura mínima aplicada nos itens e
    controles (via estilo computado/classe) no modo mobile
  - DoD: itens de navegação e botões do header com área ≥ 44×44 px no mobile;
    nenhum item perde conteúdo a 320 px; testes/lint/build passam
  - _Requisitos: RF-L06.4, RF-L06.5_

- [ ] 8. Atalhos do Dashboard (RF-L03) no painel atual
  - O `Dashboard.tsx` virou painel de métricas (KPIs, distribuição, recentes);
    ele tem links para detalhes e "Novo orçamento" no estado vazio, mas não
    expõe `<nav aria-label="Atalhos">` com acesso a Orçamentos e, para admin,
    Template
  - Adicionar `<nav aria-label="Atalhos">` com `<Link>` para Orçamentos e
    (apenas `admin`) Template, visível em todos os estados da página
    (carregando, erro, vazio e com dados), mantendo `<main id="conteudo">` e um
    único `<h1>`
  - Testes em `frontend/src/pages/__tests__/Dashboard.test.tsx`: atalhos
    presentes nos quatro estados; Template só para admin; links com nome
    acessível e navegáveis por teclado
  - DoD: testes passam; `eslint-plugin-jsx-a11y` sem avisos; sem `<main>`
    duplicado
  - _Requisitos: RF-L03.1, RF-L03.3, RF-L04.2_

- [ ]* 9. Teste de integração das rotas com layout
  - Item opcional da tarefa 4 que ficou sem cobertura: criar
    `frontend/src/__tests__/rotas-layout.test.tsx` renderizando `App` com
    `MemoryRouter`: em `/dashboard` (autenticado) aparecem skip link, header e
    `<nav aria-label="Principal">`; em `/login`, `/publico/orcamento/:token` e
    numa rota inexistente (`NaoEncontrado`) o layout NÃO aparece
  - Verificar que há exatamente um `<main>` por rota privada
  - DoD: testes passam; lint limpo
  - _Requisitos: RF-L01.1, RF-L01.5, RF-L01.7_

- [ ] 10. Reconciliar WCAG 2.2 AA no shell e no CSS global
  - Contexto: `Acessibilidade.md` e `ui.md` fixam WCAG 2.2 AA; requirements e
    design citam 2.1 AA. Esta tarefa cobre os critérios novos da 2.2 que
    afetam o shell, no código
  - 2.4.11 Focus Not Obscured (Minimum): o `Header` é `position: sticky` (56 px)
    e o editor tem barra de ações sticky (`OrcamentoEditor.css`); definir
    `scroll-padding-top`/`scroll-margin-top` suficiente em `global.css` (e nos
    alvos de âncora, incl. `#conteudo`) para que o elemento focado e o destino
    do skip link não fiquem sob essas barras
  - 2.5.8 Target Size (Minimum): auditar alvos interativos do shell
    (≥ 24×24 px, com mira de projeto de ~44 px da tarefa 7)
  - Revisar `body { overflow-x: hidden }` em `global.css`: confirmar que não
    corta indicador de foco nem mascara estouro de Reflow (1.4.10); preferir
    corrigir a causa e manter apenas a rolagem própria da tabela
  - Remover resíduos do CSS legado que a Fase 16 substituiu pelo Fluent (regras
    sem uso para `.app-shell/.app-header/.app-nav`), mantendo `.skip-link`,
    `.tabela-rolavel` e os breakpoints documentados
  - Testes: unitário que verifica o skip link (visível ao focar e destino
    `#conteudo` existente) e regressão do `:focus-visible`
  - DoD: lint, testes e build passam; critérios 2.4.11 e 2.5.8 anotados como
    verificados em código; pendências de teste manual registradas
  - _Requisitos: RF-L01.6, RF-L05.3, RF-L06.3, RF-L06.5, RNF.3_

- [ ] 11. Nova verificação e atualização de `verificacao.md`
  - Rodar `npm run lint`, `npm run test` e `npm run build` no frontend
  - Atualizar `.kiro/specs/layout-navegacao/verificacao.md`: contagem de testes,
    shell Fluent (substitui menções a `.app-header`/`.app-nav` e à paleta
    própria do CSS), critérios WCAG 2.2 verificados em código e a lista
    pendente de teste manual (leitor de tela, Reflow/zoom 400%, toque real)
  - DoD: checagens limpas; nota atualizada e coerente com o código
  - _Requisitos: RF-L05, RF-L06, RNF.3, RNF.4, RNF.5_

## Notas

- Sem alterações no backend. Sem biblioteca de UI nova.
- O `<main>` é responsabilidade de cada página; o layout fornece
  `<header>`/`<nav>` e o `<Outlet>`.
- A autorização efetiva de Template permanece no backend; a ocultação na UI é
  conveniência, não controle de acesso.
- Conformidade total com WCAG exige teste manual com tecnologia assistiva; as
  tarefas cobrem o verificável em código.
- Estado das tarefas: 1-5 permanecem `[x]` (escopo original entregue). As
  tarefas 6-11 são novas e cobrem lacunas entre spec e código atual.
- Divergência de alvo WCAG: `Acessibilidade.md` e `ui.md` definem WCAG 2.2 AA;
  `requirements.md` e `design.md` citam 2.1 AA. A tarefa 10 cobre os critérios
  novos da 2.2 no código (2.4.11, 2.5.8). Ajustar o texto de requirements e
  design para 2.2 é edição de documento, fora destas tarefas.
- Divergência de implementação: a spec previa CSS simples sem biblioteca de UI
  (RNF.2) e `LayoutApp` com `<header>` próprio. O código evoluiu para um app
  shell em Fluent 2 (`AppShell`, `Sidebar`, `Header`), em linha com `ui.md`, e o
  Dashboard virou painel de métricas. Requirements e design devem ser
  atualizados para refletir isso; as tarefas 6-8 e 10 já miram o código real.
- Tarefa 4 teve seu teste de integração opcional adiado para a tarefa 9
  (opcional).
- Breakpoints do shell Fluent (sidebar colapsa < 1024 px, Drawer < 640 px)
  diferem dos oficiais do RF-L06 (600/1024 px) usados no CSS global; manter
  ambos documentados até a spec ser reconciliada.

## Grafo de dependências

```json
{
  "waves": [
    { "wave": 0, "name": "Estilo base", "tasks": ["1"], "dependsOn": [] },
    { "wave": 1, "name": "Layout e Dashboard", "tasks": ["2", "3"], "dependsOn": [0] },
    { "wave": 2, "name": "Rotas", "tasks": ["4"], "dependsOn": [1] },
    { "wave": 3, "name": "Verificação", "tasks": ["5"], "dependsOn": [2] },
    { "wave": 4, "name": "Alinhamento ao shell Fluent", "tasks": ["6", "7", "8", "9"], "dependsOn": [3] },
    { "wave": 5, "name": "Reconciliação WCAG 2.2", "tasks": ["10"], "dependsOn": [4] },
    { "wave": 6, "name": "Reverificação", "tasks": ["11"], "dependsOn": [5] }
  ]
}
```

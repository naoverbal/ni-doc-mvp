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

- [~] 3. Dashboard navegável
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

- [~] 4. Reorganizar rotas com layout aninhado
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

- [~] 5. Verificação de acessibilidade e navegação por teclado
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

## Notas

- Sem alterações no backend. Sem biblioteca de UI nova.
- O `<main>` é responsabilidade de cada página; o layout fornece
  `<header>`/`<nav>` e o `<Outlet>`.
- A autorização efetiva de Template permanece no backend; a ocultação na UI é
  conveniência, não controle de acesso.
- Conformidade total com WCAG exige teste manual com tecnologia assistiva; as
  tarefas cobrem o verificável em código.

## Grafo de dependências

```json
{
  "waves": [
    { "wave": 0, "name": "Estilo base", "tasks": ["1"], "dependsOn": [] },
    { "wave": 1, "name": "Layout e Dashboard", "tasks": ["2", "3"], "dependsOn": [0] },
    { "wave": 2, "name": "Rotas", "tasks": ["4"], "dependsOn": [1] },
    { "wave": 3, "name": "Verificação", "tasks": ["5"], "dependsOn": [2] }
  ]
}
```

# Requisitos — Layout e Navegação da Área Logada

## Introdução

Hoje, após o login, o usuário cai em `/dashboard`, que é um placeholder
(`<h1>Dashboard</h1>`) sem qualquer navegação. As demais telas da área logada
(`/orcamentos`, `/orcamentos/novo`, `/template`) existem e têm rota, mas só são
alcançáveis digitando a URL manualmente — não há menu, cabeçalho, botão de
logout nem camada de estilo (o projeto não possui nenhum CSS). O resultado é
uma aplicação impossível de navegar.

Esta feature introduz a **casca da área logada**: um layout persistente
(cabeçalho + navegação), um Dashboard de verdade que serve de ponto de partida,
e uma base mínima de estilo que torne a aplicação navegável e legível. O alvo é
WCAG 2.1 AA no que é verificável em código, conforme a diretriz de
acessibilidade do projeto.

### Objetivos

- Permitir navegar entre todas as telas da área logada sem digitar URLs.
- Exibir identidade da sessão (nome do usuário) e permitir sair (logout).
- Respeitar o papel do usuário na navegação (operador não vê o acesso de admin).
- Estabelecer uma base de estilo consistente e acessível para toda a área
  logada, sem introduzir uma biblioteca de UI pesada.

### Fora de escopo

- Redesign visual completo ou design system elaborado.
- Novas telas de domínio além do Dashboard (o editor, template e lista já são
  cobertos por suas próprias tarefas).
- Tema escuro, i18n (o produto é pt-BR), preferências de usuário.

## Requisitos

### RF-L01 — Layout persistente da área logada

**História:** Como usuário autenticado, quero um cabeçalho e uma navegação
sempre visíveis, para me mover entre as telas sem recorrer à URL.

**Critérios de aceitação:**

1. QUANDO uma rota privada é renderizada, ENTÃO o sistema DEVE envolvê-la em um
   layout comum com cabeçalho (identidade do produto + usuário) e navegação.
2. O layout DEVE usar landmarks semânticos: `<header>`, `<nav>` e `<main>`, com
   o conteúdo da página dentro de `<main>`.
3. A navegação DEVE conter links para Dashboard, Orçamentos e (apenas para
   admin) Template, usando `<a>`/`<Link>` reais navegáveis por teclado.
4. O link correspondente à rota atual DEVE ser marcado como atual
   (`aria-current="page"`).
5. O layout NÃO DEVE aparecer nas rotas públicas (`/login`,
   `/publico/orcamento/:token`).

### RF-L02 — Identidade da sessão e logout

**História:** Como usuário autenticado, quero ver quem está logado e conseguir
sair, para encerrar a sessão com segurança.

**Critérios de aceitação:**

1. O cabeçalho DEVE exibir o nome do usuário autenticado (do store de auth).
2. O cabeçalho DEVE conter um botão "Sair" com nome acessível.
3. QUANDO o usuário aciona "Sair", ENTÃO o sistema DEVE chamar o logout
   (`useLogout`, `POST /auth/logout`), limpar o estado de sessão e redirecionar
   para `/login`.
4. O botão de logout DEVE indicar estado de carregamento enquanto a requisição
   está pendente e não permitir cliques duplicados.

### RF-L03 — Dashboard navegável

**História:** Como usuário autenticado, quero uma tela inicial com acesso às
áreas do sistema, para começar a trabalhar sem adivinhar URLs.

**Critérios de aceitação:**

1. A rota `/dashboard` DEVE renderizar uma página com um `<h1>` descritivo e
   atalhos (links) para Orçamentos e, para admin, Template.
2. O Dashboard DEVE deixar de ser um placeholder; o texto solto `Dashboard`
   atual DEVE ser substituído por conteúdo navegável.
3. Os atalhos DEVEM ser navegáveis por teclado, com nome acessível e foco
   visível.

### RF-L04 — Navegação sensível ao papel

**História:** Como admin, quero acessar a edição de template; como operador,
não quero ver opções que não posso usar.

**Critérios de aceitação:**

1. O acesso de navegação para Template DEVE aparecer apenas quando
   `usuario.papel === 'admin'`.
2. Para operador, o item Template NÃO DEVE ser exibido na navegação nem no
   Dashboard.
3. Esta é uma regra de UI; a autorização efetiva continua no backend
   (`PUT /api/templates/atual` já exige admin). A UI não substitui essa
   verificação.

### RF-L05 — Base de estilo acessível

**História:** Como usuário, quero uma interface legível e consistente, para
usar o sistema com conforto em qualquer dispositivo.

**Critérios de aceitação:**

1. O sistema DEVE introduzir uma folha de estilo global (reset leve +
   tipografia + layout do cabeçalho/nav) importada uma única vez.
2. O texto e os controles DEVEM atender contraste WCAG AA (≥ 4.5:1 para texto
   normal; ≥ 3:1 para texto grande e componentes).
3. O indicador de foco NÃO DEVE ser removido; todo elemento interativo DEVE ter
   foco visível.
4. O layout DEVE ser utilizável em telas pequenas (navegação não deve ficar
   inacessível em largura reduzida).
5. A informação NÃO DEVE depender apenas de cor (ex.: link atual precisa de
   indicação além da cor).

### RF-L06 — Layout responsivo (mobile, tablet e desktop)

**História:** Como usuário, quero usar o sistema confortavelmente no celular,
no tablet e no desktop, para trabalhar a partir de qualquer dispositivo.

> Nota sobre WCAG: responsividade por classe de dispositivo não é uma regra
> explícita do WCAG. O critério relacionado é o 1.4.10 (Reflow), que exige
> conteúdo utilizável a 320 CSS px de largura sem rolagem em dois eixos. Este
> requisito é uma decisão de produto que vai além do mínimo do WCAG e, de
> quebra, satisfaz o 1.4.10.

**Critérios de aceitação:**

1. O layout DEVE ser utilizável e legível em três faixas de largura:
   - mobile: a partir de 320 px;
   - tablet: faixa intermediária (aproximadamente 600–1024 px);
   - desktop: 1024 px ou mais.
2. A abordagem DEVE ser mobile-first (estilos base para a menor largura;
   `min-width` media queries para faixas maiores) e usar unidades fluidas.
3. Em qualquer faixa, o conteúdo NÃO DEVE exigir rolagem horizontal a 320 CSS px
   de largura (WCAG 1.4.10 Reflow); nenhum conteúdo ou funcionalidade pode ser
   perdido ao estreitar a tela.
4. A navegação principal DEVE permanecer acessível e operável por teclado em
   todas as faixas. No MVP não há menu hambúrguer com JS: em larguras pequenas o
   cabeçalho/navegação empilham (wrap/stack) sem esconder itens.
5. Alvos de toque interativos DEVEM ter área mínima adequada ao toque (mira em
   ~44×44 px) em larguras de mobile.
6. O `index.html` DEVE conter a meta viewport responsiva
   (`width=device-width, initial-scale=1`) — já presente; a tarefa deve
   confirmar e não removê-la.
7. A tabela de orçamentos (tela existente) NÃO DEVE quebrar o layout em telas
   estreitas; prever contêiner com rolagem própria ou outra adaptação, sem
   introduzir rolagem horizontal na página inteira.

### RNF — Restrições

1. Manter as convenções do frontend: TypeScript strict, React 19, React Router
   7, Zustand para estado de cliente, identificadores em pt-BR.
2. Não introduzir biblioteca de componentes de UI (ex.: MUI, Chakra). CSS
   simples (global + módulos CSS, se necessário) é suficiente para o MVP.
3. `eslint-plugin-jsx-a11y` DEVE passar sem avisos nos arquivos novos/alterados.
4. Testes com Vitest + Testing Library para o layout e o Dashboard; verificação
   do fluxo por teclado antes de concluir.
5. A conformidade total com WCAG exige teste manual com tecnologia assistiva;
   as tarefas cobrem o que é verificável em código.

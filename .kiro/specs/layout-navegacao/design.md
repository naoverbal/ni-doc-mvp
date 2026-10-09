# Design — Layout e Navegação da Área Logada

## Visão geral

A feature adiciona uma casca de UI à área logada sem tocar na lógica de auth já
existente. O ponto de entrada é um componente `LayoutApp` que renderiza
cabeçalho + navegação ao redor do conteúdo de cada rota privada, usando o
`<Outlet>` do React Router. O `Dashboard` deixa de ser placeholder e vira um hub
de atalhos. Uma folha de estilo global introduz a primeira camada de CSS do
projeto.

Nenhuma mudança no backend. Nenhuma biblioteca de UI nova.

## Estado atual relevante (código existente)

- `src/App.tsx` — define as rotas; hoje cada rota privada é embrulhada
  individualmente em `<PrivateRoute>`. A raiz `/` redireciona para `/dashboard`.
- `src/routes/PrivateRoute.tsx` — hidrata a sessão via `useSessao` e redireciona
  para `/login` quando não autenticado. **Permanece inalterado**; será
  reaproveitado como wrapper do layout.
- `src/stores/auth.store.ts` — expõe `usuario` (`{ id, nome, papel }`) e
  `autenticado`.
- `src/hooks/useAuth.ts` — expõe `useLogout()` (POST `/auth/logout`, limpa
  store e cache).
- `src/pages/Dashboard.tsx` — placeholder `<h1>Dashboard</h1>` a ser
  substituído.
- `src/pages/OrcamentoLista.tsx` / `Login.tsx` — já usam `<main>`, `<h1>` e
  padrões de acessibilidade; o layout deve ser coerente com eles. **Importante:**
  como as páginas já renderizam seu próprio `<main>`, o `LayoutApp` NÃO deve
  renderizar outro `<main>` — ver "Decisão: onde fica o `<main>`".
- Não existe CSS no projeto (nenhum import de `.css` em runtime).

## Arquitetura da navegação

### Rotas aninhadas com layout

Trocar o padrão "cada rota embrulhada em `PrivateRoute`" por uma **rota de
layout** aninhada, mantendo a proteção:

```tsx
<Route element={<PrivateRoute><LayoutApp /></PrivateRoute>}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/orcamentos" element={<OrcamentoLista />} />
  <Route path="/orcamentos/novo" element={<OrcamentoEditor />} />
  <Route path="/orcamentos/:id" element={<OrcamentoEditor />} />
  <Route path="/template" element={<TemplateEditor />} />
</Route>
```

- `PrivateRoute` continua decidindo autenticação (sem alteração interna).
- `LayoutApp` renderiza cabeçalho + nav e um `<Outlet />` para a página.
- Rotas públicas (`/login`, `/publico/orcamento/:token`) e `*` (NaoEncontrado)
  ficam **fora** desse grupo, logo sem layout.

### Componente `LayoutApp`

Arquivo: `src/components/LayoutApp.tsx`.

Estrutura semântica:

```tsx
<div className="app-shell">
  <header className="app-header">
    <span className="app-marca">ni-doc</span>
    <NavPrincipal />
    <div className="app-usuario">
      <span>{usuario?.nome}</span>
      <BotaoLogout />
    </div>
  </header>
  <Outlet />
</div>
```

### Decisão: onde fica o `<main>`

As páginas (`OrcamentoLista`, `Login`, etc.) **já renderizam seu próprio
`<main>`**. Para não haver dois landmarks `main` (violação WCAG/jsx-a11y), o
`LayoutApp` renderiza `<Outlet />` diretamente, SEM envolver em `<main>`. O
`<main>` continua sendo responsabilidade de cada página.

- O `Dashboard` reescrito deve, portanto, renderizar seu próprio `<main>`,
  coerente com as demais páginas.
- `<header>` e `<nav>` vivem no layout; `<main>` vive na página. Há exatamente
  um de cada por tela renderizada.

### Skip link e o alvo `#conteudo` (RF-L01.6/7, WCAG 2.4.1)

O `LayoutApp` renderiza, como primeiro elemento focável (antes do `<header>`),
um link "Pular para o conteúdo":

```tsx
<a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
```

Como o `<main>` vive nas páginas, o alvo precisa ser estável: as páginas da área
logada expõem `<main id="conteudo">`. No MVP a área logada envolve `Dashboard`,
`OrcamentoLista`, `OrcamentoEditor` e `TemplateEditor` — todas devem receber
`id="conteudo"` no seu `<main>`. O `.skip-link` fica fora da tela por padrão e
visível ao receber foco (`:focus`/`:focus-visible`), nunca com `display:none`
(que o removeria da ordem de foco).

### Logout resiliente a erro (RF-L02.5)

O `useLogout` atual limpa o estado apenas no `onSuccess`. Para que uma falha de
rede não prenda o usuário na sessão, o `BotaoLogout` trata o erro no componente:

```tsx
async function sair() {
  try {
    await logout.mutateAsync()
  } finally {
    // limpa o estado local e sai, independentemente do resultado da rede
    limpar()                 // useAuthStore().limpar
    navigate('/login', { replace: true })
  }
}
```

Alternativa equivalente: mover a limpeza para `onSettled` no `useLogout`. A
decisão de design é garantir, no caminho de UI, que o redirecionamento e a
limpeza aconteçam mesmo em erro. Testar os dois caminhos (sucesso e erro).

### Componente `NavPrincipal`

Arquivo: `src/components/NavPrincipal.tsx` (ou interno ao `LayoutApp`).

- Usa `<nav aria-label="Principal">` com uma lista `<ul>` de `NavLink`s.
- `NavLink` do React Router aplica estado "ativo"; mapear para
  `aria-current="page"` quando ativo (via a função de `className`/render-prop do
  `NavLink`, que expõe `isActive`).
- Itens: Dashboard (`/dashboard`), Orçamentos (`/orcamentos`). Template
  (`/template`) **apenas** se `usuario?.papel === 'admin'`.
- Indicação de item atual não pode ser só cor: além da cor, aplicar um reforço
  (ex.: peso de fonte/`underline`/borda) e o `aria-current`.

### Componente `BotaoLogout`

Pode ser interno ao `LayoutApp`.

- `const logout = useLogout()`.
- `onClick`: `await logout.mutateAsync()` e então `navigate('/login', { replace: true })`.
- `disabled={logout.isPending}`; rótulo muda para "Saindo…" enquanto pendente.
- É um `<button type="button">` com texto visível "Sair" (nome acessível ok).

## Dashboard reescrito

Arquivo: `src/pages/Dashboard.tsx`.

```tsx
export function Dashboard(): ReactElement {
  const usuario = useAuthStore((e) => e.usuario)
  const ehAdmin = usuario?.papel === 'admin'
  return (
    <main>
      <h1>Início</h1>
      <p>Bem-vindo{usuario ? `, ${usuario.nome}` : ''}.</p>
      <nav aria-label="Atalhos">
        <ul>
          <li><Link to="/orcamentos">Orçamentos</Link></li>
          {ehAdmin && <li><Link to="/template">Template</Link></li>}
        </ul>
      </nav>
    </main>
  )
}
```

- Atalhos são `<Link>` reais (teclado + foco visível por padrão).
- `Template` só aparece para admin (RF-L04).

## Camada de estilo

Introduzir o primeiro CSS do projeto:

- `src/styles/global.css` — importado uma única vez em `src/main.tsx`
  (`import '@/styles/global.css'`). Contém:
  - reset leve (box-sizing, margens padrão, `:focus-visible` preservado e
    reforçado — nunca `outline: none` sem alternativa);
  - tipografia base (família, tamanho, `line-height`), cores com contraste AA
    verificado (texto escuro sobre fundo claro ≥ 4.5:1);
  - layout do `.app-header` (flex, espaçamento), `.app-nav` e estado do link
    atual (cor + reforço não-cromático);
  - responsividade mobile-first (RF-L06): estilos base para a menor largura
    (≥ 320 px) e `min-width` media queries para tablet (~600 px) e desktop
    (~1024 px); unidades fluidas (`rem`/`%`/`clamp`), sem larguras fixas em px
    que forcem rolagem horizontal. Em largura pequena, o header empilha e a
    navegação permanece acessível (sem menu hambúrguer com JS no MVP — basta
    wrap/stack). Alvos de toque mirando ~44×44 px no mobile.
  - A tabela de `OrcamentoLista` recebe um contêiner com `overflow-x: auto`
    próprio (rolagem só na tabela), para não introduzir rolagem horizontal na
    página a 320 px (WCAG 1.4.10 Reflow).
  - A meta viewport (`width=device-width, initial-scale=1`) já existe no
    `index.html`; confirmar e preservar.

Breakpoints oficiais (RF-L06.1 — documentar no topo do CSS; usados no CSS e nos
testes sem divergência):

| Faixa   | Largura         | Media query          | Estratégia                                  |
| ------- | --------------- | -------------------- | ------------------------------------------- |
| mobile  | 320–599 px      | base (sem query)     | mobile-first; header/nav empilhados         |
| tablet  | 600–1023 px     | `min-width: 600px`   | header em linha; mais espaçamento           |
| desktop | ≥ 1024 px       | `min-width: 1024px`  | largura de conteúdo máxima + margens        |
- Classes utilitárias mínimas conforme necessário; sem framework de CSS.
- Paleta e contrastes documentados no topo do arquivo para revisão
  (a verificação final de contraste é manual/ferramenta, mas as escolhas ficam
  registradas).

## Acessibilidade (WCAG 2.1 AA — verificável em código)

- Landmarks: um `<header>`, um `<nav aria-label="Principal">` no layout; cada
  página mantém seu `<main>`; o Dashboard usa `<nav aria-label="Atalhos">`
  distinto (labels diferentes evitam ambiguidade entre navegações).
- `aria-current="page"` no link da rota atual.
- Foco visível preservado e reforçado via `:focus-visible`.
- Operação por teclado: todos os itens são `<a>`/`<button>` nativos.
- Sem informação só por cor (link atual tem reforço textual/estrutural).
- Reflow (1.4.10): conteúdo utilizável a 320 CSS px sem rolagem horizontal —
  atendido pela abordagem mobile-first fluida e pela tabela com rolagem própria.
- `eslint-plugin-jsx-a11y` sem avisos.

## Testes

Vitest + Testing Library (`@testing-library/react`, `user-event`), seguindo o
padrão `__tests__/` já usado no frontend.

- `LayoutApp`:
  - renderiza header, nav e os links esperados;
  - mostra o nome do usuário do store;
  - exibe Template para admin e **oculta** para operador;
  - marca o link ativo com `aria-current="page"`;
  - acionar "Sair" chama o logout e navega para `/login` (mock de `useLogout`).
- `Dashboard`:
  - renderiza `<h1>` e atalhos; Template condicionado ao papel.
- Teste de integração de rotas (opcional): logado em `/dashboard`, o layout
  aparece; em `/login` o layout não aparece.
- Verificação manual por teclado (Tab/Shift+Tab/Enter) antes de concluir.

## Impacto e riscos

- Mudança concentrada em `App.tsx` (reorganização das rotas), um componente
  novo de layout, o Dashboard, e o CSS global. Baixo risco de regressão sobre a
  lógica de auth (não alterada).
- Risco: duplicar `<main>` se o layout e as páginas renderizarem ambos —
  mitigado pela decisão de deixar o `<main>` nas páginas.
- Risco: `NavLink` `isActive` em rotas com parâmetro (`/orcamentos/:id`) — para
  o item "Orçamentos", decidir se deve ficar ativo também nas subrotas; usar
  `end` apropriadamente no `NavLink` (ativo em `/orcamentos` e subrotas é o
  comportamento desejado).

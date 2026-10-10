# Diagnóstico de UI/UX — frontend ni-doc

Investigação somente-leitura do frontend (`/Users/nilson/Dev/ni-doc/frontend`),
para fundamentar um plano de refinamento visual inspirado no Microsoft Fluent 2.
Nenhum arquivo foi alterado.

---

## Resumo executivo (a resposta primeiro)

A boa notícia: **o projeto já escolheu o Fluent 2 como design system e já tem a
infraestrutura montada**. `@fluentui/react-components@9.74.9` está instalado, há
um tema de marca (`src/theme/ni-doc-theme.ts`, verde-sálvia `#4d5d53`) com
light/dark, o `<FluentProvider>` envolve a app em `App.tsx`, e existe uma
steering `.kiro/steering/ui.md` que documenta em detalhe tokens, inventário de
componentes, layout (app shell com sidebar), feedback (Toast/Skeleton/Spinner),
modais (Dialog/Drawer) e padrões de interação — tudo em Fluent 2.

O problema: **a implementação real seguiu esse padrão em apenas uma tela
(Login) e abandonou o restante.** A maioria das páginas e componentes usa HTML
cru (`<table>`, `<input>`, `<select>`, `<button>`, `<div role="dialog">`)
estilizado por um único CSS global (`src/styles/global.css`) com uma paleta
**azul** (`--cor-primaria: #0b5cab`) que nem sequer é a cor de marca do tema
Fluent (verde-sálvia). Em prática há **dois sistemas visuais concorrentes e
desalinhados**: o Fluent (tema + Login + AuthLayout) e o "CSS global azul"
(LayoutApp, NavPrincipal, Dashboard, OrcamentoLista, OrcamentoEditor,
TemplateEditor, ModalConfirmacao, Autocomplete).

Por isso a interface parece "feia e básica": as telas centrais do produto não
estão renderizando componentes Fluent — são tabelas e formulários HTML sem
estilo de componente, sem cards, sem densidade, sem a sidebar/app shell descrita
na própria steering. **O caminho de refino não é adotar uma biblioteca nova; é
honrar o padrão que o projeto já definiu** — migrar as telas restantes para
Fluent 2, unificar a cor de marca e eliminar o CSS global azul.

A base de acessibilidade, por outro lado, está muito forte (foco visível,
`aria-live`, rótulos associados, `lang="pt-BR"`, `eslint-plugin-jsx-a11y`
ativo) e deve ser preservada na migração.

---

## 1. Estrutura

Ponto de entrada: `src/main.tsx` → monta `#root`, envolve `<App />` em
`QueryClientProvider`, importa `@fontsource/inter` e `@/styles/global.css`.

`src/App.tsx` monta as rotas com React Router 7 (`BrowserRouter` + `Routes`).
Padrão: rota pública de aceite (`/publico/orcamento/:token`) via `PublicRoute`;
rotas privadas aninhadas sob `<PrivateRoute><LayoutApp/></PrivateRoute>` que
renderiza `<Outlet/>`:

```tsx
// src/App.tsx
<Route element={<PrivateRoute><LayoutApp /></PrivateRoute>}>
  <Route path="/dashboard" element={<Dashboard />} />
  <Route path="/orcamentos" element={<OrcamentoLista />} />
  <Route path="/orcamentos/novo" element={<OrcamentoEditor />} />
  <Route path="/orcamentos/:id" element={<OrcamentoEditor />} />
  <Route path="/template" element={<TemplateEditor />} />
</Route>
```

Organização de `src/`:

- `pages/` — Login, Dashboard, OrcamentoLista, OrcamentoEditor, TemplateEditor, PublicoOrcamento, NaoEncontrado
- `components/` — Autocomplete, CanvasA4, ItemOrcamentoRow, LayoutApp, ModalConfirmacao, NavPrincipal; subpasta `common/` só com `AuthLayout.tsx`
- `routes/` — PrivateRoute, PublicRoute (guardas)
- `hooks/` — useAuth, useOrcamentos, usePublicoOrcamento, useReferencias, useTemplate
- `stores/` — auth.store, theme.store (Zustand)
- `services/` — api, queryClient (TanStack Query)
- `theme/` — ni-doc-theme.ts (lightTheme/darkTheme Fluent)
- `styles/` — global.css (único CSS do projeto)
- `lib/`, `types/` — cálculo de orçamento e tipos de API

Observação: a estrutura documentada em `ui.md` §7 prevê
`components/layout/`, `components/common/` e `components/domain/`. Hoje só
`components/common/AuthLayout.tsx` existe; os demais estão soltos na raiz de
`components/`. Não há `theme/tokens.css` (citado na steering) nem
`EmptyState`/`LoadingSkeleton`/`ConfirmDialog`/`CurrencyInput`/`StatusBadge`
/`Sidebar`/`Header`/`AppShell`/`PublicLayout`.

---

## 2. Estilização atual — dois sistemas concorrentes

### Sistema A — Fluent 2 (o padrão oficial, parcialmente aplicado)

- `src/theme/ni-doc-theme.ts`: `BrandVariants` verde-sálvia (base `60 #4d5d53`),
  `createLightTheme`/`createDarkTheme`, `fontFamilyBase: 'Inter, …'`,
  `fontFamilyMonospace: 'JetBrains Mono, …'`.
- `src/App.tsx`: `<FluentProvider theme={theme}>` com alternância light/dark via
  `theme.store.ts`.
- Usado em: `pages/Login.tsx` e `components/common/AuthLayout.tsx` (via
  `Button`, `Field`, `Input`, `MessageBar`, `Spinner`, `Card`, `Title2`,
  `makeStyles`, `tokens`).

### Sistema B — CSS global azul (o que domina as telas centrais)

`src/styles/global.css` define variáveis CSS próprias com paleta **azul**:

```css
:root {
  --cor-primaria: #0b5cab;        /* azul — NÃO é a marca verde #4d5d53 */
  --cor-primaria-escura: #084584;
  --cor-perigo: #a21b1b;
  --cor-texto: #1a1d21;
  --espaco-md: 1rem; --raio: 0.375rem; /* escala própria, fora dos tokens Fluent */
}
```

Esse CSS estiliza `.app-shell`, `.app-header`, `.app-nav`, `table`, `button`,
`.botao-sair` etc. — ou seja, toda a casca logada e as tabelas/botões das
páginas. **Conflito central:** a cor primária do CSS global é azul, enquanto o
tema Fluent é verde-sálvia. As telas em Fluent e as telas em CSS global não
parecem o mesmo produto.

Não há CSS Modules, styled-components/emotion, nem Tailwind (sem
`tailwind.config`, sem `@tailwind`). Há estilos inline pontuais, p.ex. em
`TemplateEditor.tsx`:

```tsx
<div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
```

Tokens/tema: existe um sistema de tokens **duplo e divergente** — os tokens
Fluent (via `tokens.*`) e as CSS vars do `global.css`. A steering §2 define a
tabela canônica de tokens (cores semânticas, tipografia Inter com escala
`base100…Hero900`, espaçamento grid 4px, raios, sombras, durações), mas essa
tabela só é respeitada nas telas Fluent.

---

## 3. Componentes

Biblioteca instalada (via `package.json`): **`@fluentui/react-components`
(Fluent 2)**. Não há Radix, MUI, shadcn, Ant nem Chakra.

Inventário real e sua origem:

| Componente | Arquivo | Base | Observação |
|---|---|---|---|
| AuthLayout | `components/common/AuthLayout.tsx` | **Fluent** (`Card`, `Title2`, `makeStyles`, `tokens`) | Único totalmente no padrão |
| LayoutApp (app shell) | `components/LayoutApp.tsx` | HTML + classes CSS global | `<header className="app-header">`, botão `.botao-sair` cru |
| NavPrincipal | `components/NavPrincipal.tsx` | `NavLink` + CSS global | Nav horizontal; não é a sidebar prevista em `ui.md` §4 |
| ModalConfirmacao | `components/ModalConfirmacao.tsx` | **HTML cru** `<div role="dialog">` + focus trap manual | A steering pede o `Dialog` do Fluent; aqui é reimplementação manual |
| Autocomplete | `components/Autocomplete.tsx` | **HTML cru** combobox ARIA artesanal | A steering pede `Combobox` do Fluent (`freeform`) |
| ItemOrcamentoRow | `components/ItemOrcamentoRow.tsx` | `<fieldset>`/`<input>`/`<select>` crus | Sem componentes Fluent |
| CanvasA4 | `components/CanvasA4.tsx` | `<div>`/botões focáveis | Canvas custom (ok ser custom), mas sem tokens Fluent |

Botões: há `<button>` HTML cru em quase toda tela (LayoutApp, OrcamentoLista,
OrcamentoEditor, TemplateEditor, ModalConfirmacao). Só o Login usa
`<Button appearance="primary">`. A regra "no máximo um `primary` por tela"
(`ui.md` §3) não tem como ser avaliada porque os botões não são Fluent.

Tabelas: `<table>` HTML cru em `OrcamentoLista.tsx` e `PublicoOrcamento.tsx`;
a steering (`ui.md` §3) prevê `DataGrid` Fluent `size="small"` com ordenação,
seleção e paginação.

---

## 4. Telas/fluxos — completude

| Tela | Arquivo | Estado | Visual |
|---|---|---|---|
| Login | `pages/Login.tsx` | **Funcional** (RHF+Zod, erro, spinner) | **Fluent completo** — referência de qualidade |
| Dashboard | `pages/Dashboard.tsx` | **Esqueleto** | `<h1>` + lista de links. Sem os cards de métricas/orçamentos recentes previstos em `ui.md` §7 |
| Lista de orçamentos | `pages/OrcamentoLista.tsx` | **Funcional** (filtro, excluir, estados loading/erro/vazio) | `<table>` HTML cru; exclusão via `window.confirm` (ver abaixo); ações com emoji `✎ 👁 🗑` |
| Editor de orçamento | `pages/OrcamentoEditor.tsx` | **Funcional e completo** (itens, desconto, totais em tempo real, envio/versão, link público) | Formulário HTML cru + `ModalConfirmacao` custom |
| Editor de template | `pages/TemplateEditor.tsx` | **Funcional** (canvas, uploads, placeholders, salvar) | HTML cru + estilos inline |
| Página pública de aceite | `pages/PublicoOrcamento.tsx` | **Funcional** (snapshot, integridade, PDF iframe, aprovar/reprovar) | HTML cru; sem o layout público/header de logo previsto em `ui.md` §4 |
| Não encontrado | `pages/NaoEncontrado.tsx` | **Esqueleto mínimo** | Só `<h1>Página não encontrada</h1>` — sem `<main>`, sem link de volta |

Ponto de atrito de UX concreto — a lista usa diálogo nativo do browser em vez do
`Dialog` Fluent (ou do `ModalConfirmacao` que já existe):

```tsx
// src/pages/OrcamentoLista.tsx
const confirmado = window.confirm(
  `Excluir o orçamento ${numero}? Esta ação não pode ser desfeita.`,
)
```

Resumo: a **lógica de produto está madura** (orçamento, versionamento, aceite,
template funcionam). O que falta é a **camada de apresentação Fluent** em tudo
que não é o Login.

---

## 5. Acessibilidade — ponto forte do código

- `eslint-plugin-jsx-a11y@6.10.2` instalado e **ativo** em
  `eslint.config.mjs` (`jsxA11y.flatConfigs.recommended`).
- `index.html` tem `<html lang="pt-BR">` e viewport responsivo.
- Foco visível garantido no CSS (`:focus-visible { outline: 3px solid … }`) com
  comentário explícito de não remover (WCAG 2.4.7).
- Rótulos sempre associados (`<label htmlFor>`), `aria-invalid` +
  `aria-describedby` nos erros (Login, OrcamentoEditor, ItemOrcamentoRow).
- `aria-live`/`role="status"`/`role="alert"` para carregamento, erros, totais e
  confirmações (OrcamentoLista, OrcamentoEditor, PublicoOrcamento, TemplateEditor).
- Status nunca só por cor — rótulo textual via `ROTULO_STATUS` em
  `OrcamentoLista.tsx`; selo de integridade textual em `PublicoOrcamento.tsx`.
- Skip link (`.skip-link`) e `<main id="conteudo">` por página.
- Componentes custom (Autocomplete, ModalConfirmacao, CanvasA4) implementam
  padrões WAI-ARIA (combobox, dialog focus trap, operação por teclado).

Lacunas visíveis:
- `PublicoOrcamento.tsx` e `NaoEncontrado.tsx` usam `<main>` sem
  `id="conteudo"`; `NaoEncontrado` não tem `<main>` nem link de retorno.
- Ações da lista usam emoji como ícone (`<span aria-hidden="true">✎</span>`) —
  funciona com `aria-label`, mas visualmente frágil; a steering pede ícone
  Fluent + tooltip.
- `window.confirm` em `OrcamentoLista` escapa do controle de foco/ARIA da app.

---

## 6. Formulários

Dois padrões coexistem:

1. **React Hook Form + Zod resolver + `Field` do Fluent** — só no `Login.tsx`:

```tsx
const { register, handleSubmit, formState:{ errors, isSubmitting } } =
  useForm<LoginFormulario>({ resolver: zodResolver(loginSchema), mode: 'onSubmit' })
// …
<Field label="E-mail" validationState={errors.email ? 'error' : 'none'}
       validationMessage={errors.email?.message}>
  <Input type="email" autoComplete="email" {...register('email')} />
</Field>
```

2. **Estado manual (`useState`) + validação Zod imperativa + inputs HTML crus**
— em `OrcamentoEditor.tsx` (e `ItemOrcamentoRow`, `TemplateEditor`): dezenas de
`useState`, `orcamentoSchema.safeParse(...)` chamado à mão em `validar()`,
mapeando erros para `<span role="alert">`. Não usa RHF nem `Field`.

Não há um componente de campo/erro reutilizável comum (tipo `CampoTexto` ou o
`CurrencyInput` citado em `ui.md` §3). O `@hookform/resolvers` está instalado
mas só é usado no Login. Resultado: inconsistência de marcação de erro e de
aparência entre o Login (Fluent `Field`) e o resto (spans manuais).

---

## 7. Build/lint

`frontend/package.json` scripts:

- `dev`: `vite`
- `build`: `tsc && vite build`
- `preview`: `vite preview`
- `test`: `vitest run`
- `lint`: `eslint .`
- `format`: `prettier --write .`

Config específica do frontend:
- ESLint: `frontend/eslint.config.mjs` (flat config) — `@eslint/js` recomendado,
  `typescript-eslint` recomendado, **`eslint-plugin-jsx-a11y` recomendado**,
  `eslint-plugin-react-hooks`; `no-explicit-any` como warning.
- Prettier: não há `.prettierrc` no frontend; o projeto usa a convenção da raiz
  (`tech.md`: aspas simples, sem ponto-e-vírgula, 2 espaços, trailing commas
  `all`, largura 100) — confirmado pelo estilo dos arquivos.
- Vite: `frontend/vite.config.ts` com alias `@ → ./src`, proxy `/api` → backend,
  porta 5173.
- Vitest: `vitest.config.ts` + `src/__tests__/setup.ts`; há testes para páginas
  e componentes (cobertura de UI existente a preservar na migração).

Dependências de UI relevantes (de `package.json`): `@fluentui/react-components`
9.74.9, `@fontsource/inter` 5.3.0, `react` 19, `react-router-dom` 7.0.2,
`@tanstack/react-query` 5.62.7, `react-hook-form` 7.54.2,
`@hookform/resolvers` 3.9.1 (dev), `zod` 3.23.8, `zustand` 5.0.2.

**Gap de dependência confirmado:** o tema declara
`fontFamilyMonospace: 'JetBrains Mono, …'`, mas **`@fontsource/jetbrains-mono`
NÃO está instalado** (não está em `package.json` nem em
`node_modules/@fontsource/`). Hoje a JetBrains Mono só resolveria se estivesse
instalada no SO do usuário; caso contrário cai no fallback `Menlo/monospace`.

---

## 8. Oportunidades de refino (ordenadas por impacto)

O tema aqui não é "qual biblioteca" — é **consolidar o Fluent 2 que já existe**.
Ordenado por impacto visual/esforço.

1. **Unificar a cor de marca (maior impacto, baixo esforço).** O CSS global usa
   azul `--cor-primaria: #0b5cab` enquanto o tema Fluent é verde-sálvia
   `#4d5d53`. Enquanto as duas paletas coexistirem, nenhum refino parecerá
   coeso. Motiva: `src/styles/global.css` (`:root`) vs. `src/theme/ni-doc-theme.ts`.

2. **Migrar o app shell para o layout da steering (sidebar + header sticky).**
   Hoje `LayoutApp.tsx` + `NavPrincipal.tsx` são um header horizontal em CSS
   global; `ui.md` §4 especifica sidebar 240/64px, header 56px com usuário/tenant
   /avatar/logout, drawer no mobile. É a mudança estrutural que mais "levanta" a
   percepção de produto. Motiva: `src/components/LayoutApp.tsx`,
   `src/components/NavPrincipal.tsx`.

3. **Converter as tabelas em `DataGrid` Fluent.** `OrcamentoLista.tsx` usa
   `<table>` HTML cru com emojis de ação; `ui.md` §3 prevê `DataGrid`
   `size="small"` com ordenação, paginação e ações com ícone+tooltip. Idem a
   tabela de itens em `PublicoOrcamento.tsx`. Motiva: `src/pages/OrcamentoLista.tsx`.

4. **Padronizar formulários em RHF + `Field`/`Input` Fluent.** Substituir o
   estado manual + spans de erro de `OrcamentoEditor.tsx`/`ItemOrcamentoRow.tsx`
   /`TemplateEditor.tsx` pelo padrão já comprovado no `Login.tsx`, extraindo um
   campo reutilizável. Ganho de consistência visual e de marcação de erro.
   Motiva: `src/pages/OrcamentoEditor.tsx`, `src/components/ItemOrcamentoRow.tsx`.

5. **Trocar os componentes custom pelos equivalentes Fluent.**
   `ModalConfirmacao` → `Dialog` (danger quando destrutivo); `Autocomplete` →
   `Combobox freeform`. Reduz código ARIA artesanal e alinha aparência/sombra
   /raio aos tokens. Motiva: `src/components/ModalConfirmacao.tsx`,
   `src/components/Autocomplete.tsx`.

6. **Transformar o Dashboard de lista de links em dashboard real.** `ui.md` §7
   prevê cards de métricas + orçamentos recentes; hoje é `<h1>` + `<ul>` de
   links. Alto impacto na primeira impressão (é a tela inicial pós-login).
   Motiva: `src/pages/Dashboard.tsx`.

7. **Padronizar feedback: Toast, Skeleton, estados vazios.** Hoje o
   carregamento é texto puro (`<p>Carregando…</p>`), o vazio é texto, e a
   exclusão usa `window.confirm`. `ui.md` §3 define Toast (sucesso/erro),
   Skeleton em listas e EmptyState com ilustração+ação. Motiva:
   `src/pages/OrcamentoLista.tsx` (loading/vazio/`window.confirm`).

8. **Dar layout próprio à página pública de aceite.** `PublicoOrcamento.tsx`
   não tem o header com logo do tenant nem o enquadramento previsto em
   `ui.md` §4 (layout público, densidade comfortable, foco no PDF e aceite).
   É a tela que o cliente final vê — vale polimento. Motiva:
   `src/pages/PublicoOrcamento.tsx`.

9. **Instalar `@fontsource/jetbrains-mono` (ou corrigir o tema).** O tema promete
   JetBrains Mono para números/códigos mas a fonte não é empacotada; valores
   monetários hoje caem no fallback. Decisão: instalar a fonte ou remover a
   promessa do tema. Motiva: `src/theme/ni-doc-theme.ts` vs. `package.json`.

10. **Aplicar escala tipográfica e espaçamento Fluent de forma consistente.**
    Eliminar estilos inline (`TemplateEditor.tsx`) e a escala própria do
    `global.css`, usando `tokens.spacing*` e os ramps `base300/base500/Hero700`
    da steering §2. Tratar também `NaoEncontrado.tsx` (sem `<main>`/link de volta)
    como tela a ser estilizada. Motiva: `src/styles/global.css`,
    `src/pages/TemplateEditor.tsx`, `src/pages/NaoEncontrado.tsx`.

---

## Conclusões e recomendações

- **Não é preciso introduzir biblioteca nova.** O Fluent 2 já é a decisão do
  projeto, está instalado e documentado em `.kiro/steering/ui.md`. O trabalho é
  de **convergência**: migrar as telas que ficaram em HTML+CSS global para o
  padrão Fluent já exemplificado no `Login.tsx`/`AuthLayout.tsx`.
- **Primeiro passo de maior retorno:** matar o `global.css` azul e unificar a
  marca no verde-sálvia do tema; em seguida o app shell (sidebar/header). Esses
  dois itens, sozinhos, mudam a percepção de "feio e básico".
- **Preservar o que está bom:** acessibilidade (foco, aria-live, labels,
  jsx-a11y) e a lógica de produto já madura. A migração deve manter os testes de
  UI existentes em `__tests__/` passando.
- **Sequência sugerida:** (1) tokens/marca → (2) app shell → (3) DataGrid na
  lista → (4) formulários RHF+Field → (5) Dialog/Combobox → (6) Dashboard →
  (7) feedback/Toast/Skeleton → (8) layout público → (9) fonte mono → (10)
  limpeza de inline/escala e telas residuais.

Nenhuma alteração de código foi feita nesta investigação.

> Nota de conformidade: afirmações sobre WCAG aqui se baseiam no que é
> verificável em código. A conformidade AA plena ainda exige teste manual com
> leitor de tela e verificação de contraste em ferramenta (WebAIM), conforme a
> própria steering de acessibilidade.

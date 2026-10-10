# Implementation Plan — Reimplementar Login com Fluent 2 (base Fluent + Login)

Reimplementa `frontend/src/pages/Login.tsx` sobre Microsoft Fluent 2
(`@fluentui/react-components` v9), criando primeiro a base Fluent do projeto
(tema de marca, store de tema, `FluentProvider` na raiz, fonte Inter) e então
reescrevendo o Login, preservando integralmente a lógica de autenticação,
validação (Zod + React Hook Form), navegação e acessibilidade existentes.

## Contexto verificado durante a exploração

- Baseline verde: `npm run build` e `npm test` (101 testes, 13 arquivos) passam
  em `frontend/` antes de qualquer mudança.
- Versões a instalar (confirmadas no npm, fixar EXATAS, sem `^`/`~`):
  - `@fluentui/react-components@9.74.9` — peerDependency `react >=16.14.0 <20.0.0`,
    compatível com React 19.0.0.
  - `@fontsource/inter@5.3.0`.
- Prettier do projeto: aspas simples, SEM ponto-e-vírgula, indent 2, trailing
  commas `all`, print width 100. Imports com alias `@/*`.
- `frontend/vitest.config.ts` já define `environment: 'jsdom'`,
  `setupFiles: ['src/__tests__/setup.ts']`, `globals: true`. O setup só faz
  `@testing-library/jest-dom/vitest` + `cleanup()`. Nenhuma config nova de teste
  é necessária.
- `index.html` já tem `<html lang="pt-BR">` — nenhum ajuste necessário (apenas
  confirmar na implementação).
- `main.tsx` monta `StrictMode > QueryClientProvider > App` e importa
  `@/styles/global.css`. `App.tsx` monta `BrowserRouter > Routes` direto; a rota
  `/login` renderiza `<Login />`. O `FluentProvider` deve envolver as rotas
  dentro de `App.tsx` (acima de `BrowserRouter` ou logo abaixo — ver item 4).
- `useLogin` (de `@/hooks/useAuth`) expõe `mutateAsync`, `isPending`, `isError`.
  Não alterar o hook nem o fluxo.
- `useAuthStore` (Zustand) é o padrão de store do projeto; `theme.store.ts`
  deve seguir o mesmo estilo (`create<Estado>((set) => ...)`, nomes pt-BR).

## Decisões de design (sem design aprovado; registradas aqui)

1. **Erro de credenciais usa `MessageBar` do Fluent DENTRO de um container com
   `role="alert"`.** O `MessageBar` v9 fixa internamente `role="status"`
   (aria-live polite) e não expõe controle de assertividade
   ([microsoft/fluentui #16453](https://github.com/microsoft/fluentui/issues/16453),
   [#33227](https://github.com/microsoft/fluentui/issues/33227)). O requisito da
   tarefa e o teste existente exigem `role="alert"` / `aria-live="assertive"`.
   Solução: renderizar `<div role="alert" aria-live="assertive">` envolvendo
   `<MessageBar intent="error"><MessageBarBody>…</MessageBarBody></MessageBar>`.
   `role="alert"` já implica `aria-live="assertive"` + `aria-atomic="true"`
   ([MDN alert role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/alert_role)),
   mas mantemos `aria-live="assertive"` explícito porque o teste o verifica.
   Isso satisfaz a apresentação Fluent e o critério de acessibilidade.
   _Conteúdo rephrased para conformidade de licença._
2. **Campos usam `Field` do Fluent** (`label`, `validationState`,
   `validationMessage`) envolvendo `Input`. O `Field` associa label, define
   `aria-invalid` no input e vincula a mensagem via `aria-describedby`
   ([microsoft/fluentui #26032](https://github.com/microsoft/fluentui/issues/26032)).
   NÃO duplicar ARIA manualmente. O `useId` manual atual é removido (o Field gera
   os ids). `getByLabelText('E-mail'|'Senha')` continua funcionando porque o
   Field associa o label ao controle.
3. **Estilos via `makeStyles`/griffel com `tokens.*`** — nunca valores
   hard-coded. Único ajuste permitido fora de token: `minHeight: '100vh'` e
   `maxWidth` do card (dimensão de layout, não cor/espaçamento semântico).
4. **Layout de auth extraído como componente reutilizável** em
   `components/common/AuthLayout.tsx` (card Fluent centralizado vertical/
   horizontal). Justificativa: a tarefa prevê telas públicas/auth adicionais e o
   steering pede que helpers reutilizáveis vivam em `components/common/` e sejam
   inventariados. Documentar 1 linha em `ui.md`. (Se na implementação ficar claro
   que não há reuso, inline no Login e NÃO editar o steering.)
5. **`FluentProvider` fica em `App.tsx`**, acima de `<BrowserRouter>`, para que
   todas as rotas (incluindo futuras públicas) herdem o tema. A fonte Inter é
   importada em `main.tsx` (ponto único de efeitos colaterais de import, junto do
   `global.css`).

---

- [ ] 1. Instalar as dependências Fluent e Inter no workspace frontend, com versões exatas.
      Rodar da raiz: `npm install -w @ni-doc/frontend @fluentui/react-components@9.74.9 @fontsource/inter@5.3.0 --save-exact`.
      Confirmar em `frontend/package.json` que ambas aparecem SEM `^`/`~`.
      Files: frontend/package.json, package-lock.json
      Verify: `cat frontend/package.json | grep -E 'fluentui|fontsource'` mostra `"@fluentui/react-components": "9.74.9"` e `"@fontsource/inter": "5.3.0"`; `cd frontend && npm run build` continua passando (nenhum uso ainda, só valida instalação).

- [ ] 2. Criar o tema de marca em `frontend/src/theme/ni-doc-theme.ts`.
      Exportar `lightTheme` e `darkTheme`. Definir a `BrandVariants` com a rampa EXATA
      (10 `#171d19` · 20 `#222924` · 30 `#2d352f` · 40 `#38423a` · 50 `#414d44` ·
      60 `#4d5d53` · 70 `#5a6b60` · 80 `#6b7c72` · 90 `#7c8d83` · 100 `#8fa096` ·
      110 `#a4b4aa` · 120 `#b9c8be` · 130 `#cddad2` · 140 `#dfe8e3` · 150 `#ecf1ee` ·
      160 `#f7faf8`). Gerar com `createLightTheme(brand)` / `createDarkTheme(brand)`
      e, APÓS gerar, sobrescrever os tokens de fonte:
      `fontFamilyBase: 'Inter, system-ui, -apple-system, sans-serif'` e
      `fontFamilyMonospace: 'JetBrains Mono, Menlo, monospace'`
      (ex.: `const lightTheme: Theme = { ...createLightTheme(brand), fontFamilyBase, fontFamilyMonospace }`).
      Importar `BrandVariants`, `Theme`, `createLightTheme`, `createDarkTheme` de
      `@fluentui/react-components`.
      Files: frontend/src/theme/ni-doc-theme.ts
      Verify: `cd frontend && npm run build` — tsc compila sem erro de tipo (valida assinatura de `createLightTheme`/`Theme` e override de fontes).

- [ ] 3. Criar o store de tema em `frontend/src/stores/theme.store.ts` (Zustand), seguindo o padrão de `auth.store.ts`.
      Estado: `modo: 'claro' | 'escuro'`, ação `alternar: () => void` (e opcional `definirModo`).
      Padrão inicial via `prefers-color-scheme`: numa função
      `modoInicial()` que retorna `'escuro'` quando
      `typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches`,
      senão `'claro'` (guard para SSR/jsdom). Nomes de identificadores em português.
      Files: frontend/src/stores/theme.store.ts
      Verify: `cd frontend && npm run build` compila; (teste unitário coberto no item 8).

- [ ] 4. Envolver a app com `FluentProvider` em `frontend/src/App.tsx`, selecionando tema pelo store.
      Importar `FluentProvider` de `@fluentui/react-components`, `lightTheme`/`darkTheme`
      de `@/theme/ni-doc-theme`, e `useThemeStore` (ou nome escolhido no item 3).
      Selecionar `const theme = modo === 'escuro' ? darkTheme : lightTheme`. Envolver
      `<BrowserRouter>…</BrowserRouter>` com
      `<FluentProvider theme={theme} style={{ minHeight: '100vh' }}>`.
      Garantir que `App` continue sendo um componente (hook `useThemeStore` no topo).
      NÃO alterar as rotas nem a lógica existente.
      Files: frontend/src/App.tsx
      Verify: `cd frontend && npm run build` compila; `npm test -- src/__tests__/rotas-layout.test.tsx` continua passando (as rotas ainda montam). Se esse teste renderizar `<App>` e quebrar por falta de provider de tema, ajustar (ver item 8).

- [ ] 5. Importar a fonte Inter em `frontend/src/main.tsx`.
      Acrescentar `import '@fontsource/inter'` junto ao import de `@/styles/global.css`
      (efeito colateral de import; não altera a árvore React). Confirmar que
      `index.html` mantém `<html lang="pt-BR">` (já está correto — apenas conferir).
      Files: frontend/src/main.tsx
      Verify: `cd frontend && npm run build` — build gera assets de fonte sem erro; `grep -n fontsource src/main.tsx` confirma o import.

- [ ] 6. Criar `frontend/src/components/common/AuthLayout.tsx` (card centralizado reutilizável).
      Componente que recebe `titulo: string` e `children: ReactNode`, renderiza um
      `<main>` ocupando a viewport, centralizando um `Card` do Fluent com
      `shadow`/raio por token, o título com tipografia Fluent
      (`Title2`/`tokens.fontSizeHero700` conforme steering: título de página = Hero700)
      e os children. Estilos via `makeStyles` usando `tokens.spacing*`,
      `tokens.colorNeutralBackground*`, `tokens.borderRadiusLarge`, `tokens.shadow16`.
      Centralização: flex `justifyContent/alignItems: center`, `minHeight: '100vh'`.
      O título deve ser um heading real (`<h1>` via `as`/semântica) para
      `getByRole('heading')`.
      Files: frontend/src/components/common/AuthLayout.tsx
      Verify: `cd frontend && npm run build` compila; uso real validado pelo Login (item 7) e testes (item 8).

- [ ] 7. Reimplementar `frontend/src/pages/Login.tsx` com componentes Fluent, preservando toda a lógica.
      Manter EXATAMENTE: `loginSchema` (email válido + senha min 8, mensagens pt-BR),
      `zodResolver`, `useForm` com `mode: 'onSubmit'`, `useLogin`, cálculo de `destino`
      (`location.state.from.pathname ?? '/dashboard'`), `aoEnviar` com
      `mutateAsync` + `navigate(destino, { replace: true })`, e a constante
      `MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos'`.
      Trocar apenas a apresentação:
      - Envolver com `<AuthLayout titulo="Entrar">`.
      - `<form onSubmit={aoEnviar} noValidate>`.
      - Erro de credenciais (`login.isError`): `<div role="alert" aria-live="assertive">`
        envolvendo `<MessageBar intent="error"><MessageBarBody>{MENSAGEM_CREDENCIAIS_INVALIDAS}</MessageBarBody></MessageBar>`
        (ver decisão 1).
      - E-mail: `<Field label="E-mail" validationState={errors.email ? 'error' : 'none'} validationMessage={errors.email?.message}>`
        com `<Input type="email" autoComplete="email" {...register('email')} />`.
      - Senha: `<Field label="Senha" validationState={errors.senha ? 'error' : 'none'} validationMessage={errors.senha?.message}>`
        com `<Input type="password" autoComplete="current-password" {...register('senha')} />`.
        NÃO adicionar `aria-invalid`/`aria-describedby`/`useId` manuais (o Field cuida).
      - Submit: `<Button appearance="primary" type="submit" disabled={isSubmitting || login.isPending}>`
        exibindo, durante envio, `<Spinner size="tiny" />` + `'Entrando…'`; normal `'Entrar'`.
        Garantir que o nome acessível do botão permaneça 'Entrar' / 'Entrando…'
        (texto visível). Usar `makeStyles` + `tokens.*` para gap entre campos
        (`tokens.spacingVerticalL`) e largura do form.
      Remover imports agora não usados (`useId`). Manter imports de RHF/Zod/router.
      Files: frontend/src/pages/Login.tsx
      Verify: `cd frontend && npm run build` compila sem erro de tipo; testes no item 8.

- [ ] 8. Adaptar os testes de Login e cobrir o `theme.store`.
      Em `frontend/src/pages/__tests__/Login.test.tsx` (adaptar por papel/rótulo
      acessível, não por marcação):
      - Envolver o render em `<FluentProvider theme={lightTheme}>` (importar de
        `@/theme/ni-doc-theme`) pois componentes Fluent exigem o provider; manter
        `QueryClientProvider` + `MemoryRouter` + `Routes`.
      - Os asserts por papel/rótulo DEVEM continuar: `getByLabelText('E-mail')`,
        `getByLabelText('Senha')`, `getByRole('button', { name: 'Entrar' })`,
        `getByRole('heading', { name: 'Painel' })` (rota destino), o erro de
        validação via `aria-invalid`/`aria-describedby` do Field (texto
        'Informe o e-mail'), e o erro de credenciais via `getByRole('alert')` com
        `aria-live="assertive"` e texto 'E-mail ou senha inválidos'.
      - Durante submit assíncrono, o botão fica desabilitado e mostra 'Entrando…';
        se algum assert depender do nome 'Entrar' após o clique, usar
        `findByRole('button')` tolerante ao nome transitório.
      Criar `frontend/src/stores/__tests__/theme.store.test.ts` cobrindo: modo
      inicial e `alternar` troca claro↔escuro (mockar `window.matchMedia` no teste,
      pois jsdom não o implementa por padrão).
      Se `src/__tests__/rotas-layout.test.tsx` renderiza `<App>` diretamente e passou
      no item 4, nenhuma mudança; se quebrar por tema, envolver com o provider.
      Files: frontend/src/pages/__tests__/Login.test.tsx, frontend/src/stores/__tests__/theme.store.test.ts
      Verify: `cd frontend && npm test` — todos os testes passam (os 101 anteriores + os novos do store).

- [ ] 9. Lint, formatação e documentação do inventário de UI.
      Rodar `cd frontend && npm run format` e `npm run lint` e resolver avisos,
      especialmente de `eslint-plugin-jsx-a11y` (zero violações). Se o `AuthLayout`
      foi mantido como componente reutilizável (item 6), acrescentar UMA linha ao
      inventário em `.kiro/steering/ui.md` seção 3 (ou 7, pasta `common/`)
      descrevendo `AuthLayout` (card de autenticação centralizado). Se o layout
      acabou inline no Login (sem reuso), NÃO editar o steering.
      Files: (formatação em arquivos tocados), opcional `.kiro/steering/ui.md`
      Verify: `cd frontend && npm run lint` sem erros/avisos; `npm run build` e
      `npm test` verdes.

- [ ] 10. Verificação final e conferência de acessibilidade verificável em código.
      Rodar da raiz `npm run build` e `npm test` (ambos workspaces) para garantir
      que o monorepo continua verde. Conferir manualmente no código que: há no
      máximo um `Button appearance="primary"`; nenhum valor de cor/espaçamento
      hard-coded no Login/AuthLayout (apenas `tokens.*`); o indicador de foco não
      foi removido; textos pt-BR; cada controle com nome acessível.
      Files: (nenhum; verificação)
      Verify: `cd /Users/nilson/Dev/ni-doc && npm run build && npm test` — tudo
      passa. Registrar que teste manual com leitor de tela e checagem de contraste
      (WebAIM/axe-core em navegador) ainda são necessários para afirmar
      conformidade WCAG 2.2 AA — 'verificar durante implementação / validação
      manual'.

## Itens a verificar durante a implementação

- Nome exato dos subcomponentes de MessageBar em 9.74.9 (`MessageBar` +
  `MessageBarBody`; `MessageBarTitle` é opcional) — confirmar o import default do
  pacote `@fluentui/react-components`.
- Se o `Field` em 9.74.9 aceita `validationState="none"` ou exige omitir a prop
  quando não há erro — ajustar para `errors.email ? 'error' : undefined` se o
  tipo não aceitar `'none'`.
- Comportamento do `getByLabelText` com `Field` (a associação label→input do
  Field) nos testes; se o label não for associado como esperado, usar
  `getByRole('textbox', { name: 'E-mail' })`.
- Necessidade de mock de `window.matchMedia` no setup global vs. por teste —
  preferir mock local no teste do store para não afetar os demais.
- Que `rotas-layout.test.tsx` não quebre ao introduzir o `FluentProvider` em
  `App.tsx` (ver itens 4 e 8).

---

## Evidência da implementação (iteração 1)

Executado em `frontend/` (Node 22) e na raiz do monorepo.

### Dependências instaladas (versões exatas)

`npm install -w @ni-doc/frontend @fluentui/react-components@9.74.9 @fontsource/inter@5.3.0 --save-exact`
→ `frontend/package.json` passou a listar, sem `^`/`~`:
`"@fluentui/react-components": "9.74.9"` e `"@fontsource/inter": "5.3.0"`.

### Arquivos criados/alterados

- Criados: `src/theme/ni-doc-theme.ts` (lightTheme/darkTheme a partir da
  BrandVariants exata, override de fontFamilyBase/Monospace),
  `src/stores/theme.store.ts` (Zustand, modo claro/escuro via
  prefers-color-scheme + `alternar`/`definirModo`),
  `src/components/common/AuthLayout.tsx` (card Fluent centralizado, só tokens),
  `src/stores/__tests__/theme.store.test.ts` (4 testes).
- Alterados: `src/App.tsx` (FluentProvider na raiz, tema pelo store),
  `src/main.tsx` (import `@fontsource/inter`),
  `src/pages/Login.tsx` (reescrito com Field/Input/Button/Spinner/MessageBar),
  `src/pages/__tests__/Login.test.tsx` e `src/__tests__/rotas-layout.test.tsx`
  (envoltos em `FluentProvider theme={lightTheme}`),
  `src/__tests__/setup.ts` (polyfills de `ResizeObserver` e `matchMedia` para
  jsdom, exigidos pelo MessageBar/Fluent), `.kiro/steering/ui.md` (1 linha:
  AuthLayout no inventário `common/`).

### Decisões confirmadas na implementação

- `Field` aceita `validationState="none"` em 9.74.9 — usado `errors.x ? 'error'
  : 'none'`. `getByLabelText('E-mail'|'Senha')` segue funcionando (Field associa
  o label ao Input).
- MessageBar precisa de `ResizeObserver` no jsdom; adicionado polyfill no setup
  global (não altera produção). `matchMedia` também polifillado no setup para o
  modo inicial do tema; o teste do store mocka localmente antes de importar.
- Botão primário único; nome acessível permanece 'Entrar'/'Entrando…' (texto
  visível); Spinner entra como `icon` decorativo.

### Comandos e resultados

- `cd frontend && npm run build` → OK (tsc + vite build, sem erros de tipo;
  assets da fonte Inter emitidos). Aviso de chunk > 500 kB é informativo
  (Fluent), não erro.
- `cd frontend && npm run lint` → OK, zero erros/avisos (inclui jsx-a11y).
- `cd frontend && npm run format` → aplicado (reflow de indentação em App.tsx e
  rotas-layout.test.tsx).
- `cd frontend && npm test` → 14 arquivos, 105 testes, todos passando
  (101 anteriores + 4 do theme.store). Stderr "Keyborg instance ... disposed"
  é ruído do Fluent sob jsdom, não falha.
- Raiz `npm run build` → OK. `npm test -w @ni-doc/backend` → 43 arquivos,
  540 testes passando (backend intocado).

### Pendente de validação manual (não verificável só em código)

Teste com leitor de tela e checagem de contraste (WebAIM / axe-core em
navegador) ainda são necessários para afirmar conformidade WCAG 2.2 AA.

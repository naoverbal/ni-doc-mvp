# Reimplementação da tela de Login em Fluent 2 (base Fluent + Login)

A mudança introduz a camada de apresentação Fluent 2 do ni-doc e migra o Login para ela. Cria o tema de marca (`ni-doc-theme.ts`), um store de tema Zustand (`theme.store.ts`), envolve a app com `<FluentProvider>` na raiz (`App.tsx`), importa Inter via `@fontsource/inter` (`main.tsx`), e reescreve `Login.tsx` usando `Field`/`Input`/`Button`/`Spinner`/`MessageBar`, extraindo o card centralizado para `components/common/AuthLayout.tsx`. A lógica de autenticação, validação Zod, navegação e acessibilidade foi preservada; só a apresentação mudou. Testes foram adaptados por papel/rótulo acessível e o `theme.store` ganhou cobertura.

Watch for: nada bloqueante. Dois pontos menores de divergência com o steering, ambos não bloqueantes: o `AuthLayout` usa `Title2` (base500/20px) para o título de página onde o steering sugere Hero700 (28px) para título de página (possible); e o store de tema expõe `alternar`/`definirModo` mas ainda não há `<FluentProvider>` reagindo a troca em runtime além do modo inicial — esperado para o escopo do Login (confirmed, por design).

**Verdict**: APPROVED

## High-level view

A base de tema está correta e literal: a `BrandVariants` reproduz exatamente a rampa 10 `#171d19` … 160 `#f7faf8` do steering, gera `lightTheme`/`darkTheme` via `createLightTheme`/`createDarkTheme` e sobrescreve `fontFamilyBase` (Inter) e `fontFamilyMonospace` (JetBrains Mono) após o spread. As dependências Fluent v9 e Inter estão fixadas em versões exatas (`9.74.9`, `5.3.0`, sem `^`/`~`), e a 9.74.9 declara peer `react >=16.14.0 <20.0.0`, compatível com React 19.0.0 — confirmado no node_modules hoisted do workspace.

O store Zustand segue o padrão do projeto (`create`, identificadores pt-BR), deriva o modo inicial de `prefers-color-scheme` com guard para jsdom/SSR, e o `<FluentProvider>` na raiz do `App.tsx` seleciona o tema pelo modo. A troca em runtime (`alternar`) existe no store mas ainda não tem gatilho de UI — coerente, pois o Login não precisa dele e nenhuma outra tela foi tocada.

O Login preserva integralmente a lógica: mesmo `loginSchema` (email válido + senha min 8, mensagens pt-BR), `zodResolver`, `useForm` com `mode: 'onSubmit'`, `useLogin`, cálculo de `destino` e `aoEnviar`. A apresentação migrou para `Field`+`Input` (que cuidam de `aria-invalid`/`aria-describedby`, eliminando o ARIA e `useId` manuais), um único `Button appearance="primary"` com `Spinner` + "Entrando…" no envio, e o erro de credenciais num `MessageBar intent="error"` envolto por `role="alert"`/`aria-live="assertive"` — contornando a limitação do MessageBar v9 que fixa `role="status"`.

A acessibilidade verificável em código foi mantida ou melhorada: rótulos associados, nome acessível no botão, mensagem genérica que não revela existência de e-mail, `lang="pt-BR"` no `index.html`. Conformidade WCAG 2.2 AA plena ainda exige teste manual com leitor de tela e checagem de contraste, o que a evidência declara pendente corretamente.

<details>
<summary>Issues (2)</summary>

1. **Tipografia do título vs. steering** (não bloqueante) — `AuthLayout` usa `Title2` (~20px/base500) para o título "Entrar"; o steering (seção 2) atribui Hero700 (28px) a "título de página". Como o Login é uma tela de card compacto e não uma página com shell, `Title2` é defensável, mas vale alinhar com o time de design se o padrão de telas de auth deve usar Hero700.
2. **Troca de tema em runtime sem gatilho de UI** (informativo, por design) — `theme.store` expõe `alternar`, mas nenhuma affordance de UI a aciona ainda. Correto para o escopo do Login; registrar como follow-up quando houver toggle no header/layout.

</details>

<details>
<summary>Details</summary>

## Tema de marca: rampa literal e override de fontes

`ni-doc-theme.ts` reproduz a rampa de marca exatamente como o steering especifica, tom a tom, de `10: '#171d19'` a `160: '#f7faf8'`, incluindo o tom base `60: '#4d5d53'`. Os temas são montados como `{ ...createLightTheme(marca), fontFamilyBase, fontFamilyMonospace }`, ou seja, o override de fontes vem depois do spread do tema gerado, garantindo que `fontFamilyBase: 'Inter, system-ui, -apple-system, sans-serif'` e `fontFamilyMonospace: 'JetBrains Mono, Menlo, monospace'` prevaleçam sobre os defaults do Fluent — exatamente o que o critério pede. Os tipos (`BrandVariants`, `Theme`) são importados de `@fluentui/react-components`, e os temas são anotados como `Theme`, o que faz o tsc validar a forma do override.

## Dependências: versões exatas e compatibilidade com React 19

`frontend/package.json` adiciona `@fluentui/react-components: "9.74.9"` e `@fontsource/inter: "5.3.0"` em `dependencies`, ambas sem `^`/`~`. Confirmei no workspace que a 9.74.9 está instalada e que sua `peerDependencies.react` é `>=16.14.0 <20.0.0`, que inclui o `react: "19.0.0"` do projeto — não há risco de peer conflitante. As demais entradas que aparecem no diff contra `main` (`@testing-library/*`, `vitest`, `jsdom`, `eslint-plugin-jsx-a11y`, script `test`) pertencem a trabalho de layout já commitado na branch, não a esta mudança de working tree; estão fora do escopo do Login e não introduzem regressão.

## Store de tema e FluentProvider na raiz

`theme.store.ts` segue o padrão de `auth.store.ts`: `create<ThemeState>`, identificadores em português (`modo`, `alternar`, `definirModo`), tipo `ModoTema = 'claro' | 'escuro'`. `modoInicial()` lê `prefers-color-scheme: dark` com guard duplo (`typeof window !== 'undefined' && typeof window.matchMedia === 'function'`), evitando quebra em jsdom/SSR e caindo em `'claro'` como default seguro.

Em `App.tsx`, o `<FluentProvider theme={theme} style={{ minHeight: '100vh' }}>` envolve o `<BrowserRouter>`, de modo que todas as rotas — incluindo as públicas e futuras — herdam o tema. O `useThemeStore` seleciona o modo no topo do componente e deriva `darkTheme`/`lightTheme`. A árvore de rotas em si não foi alterada (o diff é só reindentação pela inserção do provider), preservando o comportamento de navegação existente. O `minHeight: '100vh'` inline é dimensão de layout, não cor/espaçamento semântico, consistente com a decisão registrada no plano.

A ação `alternar` ainda não é acionada por nenhum controle de UI. Isso é coerente com o escopo (o Login não expõe toggle de tema e nenhum outro componente foi refatorado); fica como follow-up natural quando o header/layout ganhar a affordance.

## Login: lógica preservada, apresentação migrada

Comparando com a versão anterior (`git show HEAD:…/Login.tsx`), toda a lógica permanece idêntica: o `loginSchema` com as mesmas mensagens pt-BR, `zodResolver`, `useForm({ mode: 'onSubmit' })`, `useLogin`, o cálculo `destino = (location.state as EstadoRota | null)?.from?.pathname ?? '/dashboard'`, o `aoEnviar` com `mutateAsync` + `navigate(destino, { replace: true })` e a constante `MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos'`.

A apresentação é o que mudou. Os cinco `useId` manuais e os `aria-invalid`/`aria-describedby` artesanais foram removidos e substituídos por `Field` do Fluent, que associa o `label` ao controle, define `aria-invalid` quando `validationState="error"` e vincula a `validationMessage` via `aria-describedby`. Isso elimina a chance de dessincronia entre id de erro e campo, e segue a regra de ouro do steering de preferir semântica nativa a ARIA manual. Os `autoComplete` corretos foram mantidos (`email` / `current-password`). O botão de submit é o único `appearance="primary"` da tela e, durante o envio (`isSubmitting || login.isPending`), exibe `<Spinner size="tiny" />` como `icon` e o texto "Entrando…", ficando `disabled` — atendendo ao padrão assíncrono do steering e preservando o nome acessível visível.

O erro de credenciais merece destaque: o `MessageBar` v9 fixa internamente `role="status"` (aria-live polite) e não expõe assertividade. O requisito e o teste exigem anúncio assertivo, então a mudança envolve o `MessageBar intent="error"` num `<div role="alert" aria-live="assertive">`. `role="alert"` já implica `aria-live="assertive"`, mas o atributo explícito é mantido porque o teste o verifica diretamente. A mensagem continua genérica, sem revelar se o e-mail existe — boa prática de segurança preservada.

## AuthLayout: card por tokens, com um desvio tipográfico menor

`AuthLayout.tsx` centraliza um `Card` do Fluent via `makeStyles`, usando apenas tokens para cor, espaçamento e sombra (`tokens.spacingVerticalXXXL`, `tokens.colorNeutralBackground2`, `tokens.spacingVerticalXL`, `tokens.spacingVerticalL`, `tokens.shadow16`). As únicas dimensões literais são `minHeight: '100vh'` e `maxWidth: '360px'` — layout, não cor/espaçamento semântico, portanto dentro da exceção aceitável. O título é um heading real (`<Title2 as="h1">`), o que mantém `getByRole('heading')` funcionando e a hierarquia semântica.

O único desvio é tipográfico: o steering (seção 2) associa Hero700 (28px/700) a "título de página", e `Title2` renderiza ~20px (base500, "subtítulo"). Para uma tela de autenticação em card compacto — que não é uma página com app shell — `Title2` é uma escolha defensável e não compromete acessibilidade nem contraste. Classifico como ajuste de design a confirmar, não como bloqueio.

## Cobertura de testes

Os testes de Login foram adaptados por papel/rótulo acessível, não por marcação: `getByLabelText('E-mail'|'Senha')`, `getByRole('button', { name: 'Entrar' })`, verificação de `aria-invalid`/`aria-describedby` do campo com o texto "Informe o e-mail", o fluxo de sucesso navegando para o heading "Painel", e o erro de credenciais via `getByRole('alert')` com `aria-live="assertive"` e a mensagem genérica. O render foi envolto em `<FluentProvider theme={lightTheme}>`, necessário para montar componentes Fluent. O novo `theme.store.test.ts` cobre modo inicial (claro/escuro), `alternar` e `definirModo`, mockando `matchMedia` localmente antes de importar o módulo (o modo inicial é calculado na criação). O `setup.ts` ganhou polyfills de `ResizeObserver` e `matchMedia` exigidos pelo Fluent sob jsdom, isolados a ambiente de teste.

A evidência do coder registra `npm test` com 14 arquivos / 105 testes passando (101 anteriores + 4 do store), `npm run build`, `npm run lint` (incluindo jsx-a11y, zero avisos) e `npm run format` limpos, mais backend intocado (540 testes). Conforme instruções da tarefa, não re-executei as suítes; a evidência está presente e é consistente com o código lido. Não testado automaticamente (declarado como pendente de validação manual): conformidade WCAG 2.2 AA completa (contraste real no navegador via WebAIM/axe-core e navegação com leitor de tela), o que é correto não afirmar só por código.

## Escopo

A mudança de working tree toca apenas os arquivos da tarefa: tema, store, provider na raiz, import de fonte, Login, AuthLayout, e os testes correspondentes. Nenhum outro componente de página foi refatorado para Fluent, coerente com o escopo "só o Login". O `index.html` já traz `lang="pt-BR"`. A reindentação em `App.tsx` e `rotas-layout.test.tsx` é consequência mecânica de inserir o provider, sem mudança de comportamento.

</details>

<details>
<summary>File map</summary>

- `frontend/src/theme/ni-doc-theme.ts` (novo) — `lightTheme`/`darkTheme` da `BrandVariants` exata, override de fontes Inter/JetBrains Mono.
- `frontend/src/stores/theme.store.ts` (novo) — store Zustand de tema (claro/escuro) com modo inicial por `prefers-color-scheme`.
- `frontend/src/stores/__tests__/theme.store.test.ts` (novo) — cobre modo inicial, `alternar`, `definirModo`.
- `frontend/src/components/common/AuthLayout.tsx` (novo) — card de autenticação centralizado, só tokens.
- `frontend/src/pages/Login.tsx` — reescrito com `Field`/`Input`/`Button`/`Spinner`/`MessageBar`; lógica preservada.
- `frontend/src/pages/__tests__/Login.test.tsx` — render envolto em `FluentProvider`; asserts por papel/rótulo.
- `frontend/src/App.tsx` — `<FluentProvider>` na raiz, tema pelo store.
- `frontend/src/main.tsx` — import `@fontsource/inter`.
- `frontend/src/__tests__/setup.ts` — polyfills `ResizeObserver`/`matchMedia` para Fluent em jsdom.
- `frontend/src/__tests__/rotas-layout.test.tsx` — render envolto em `FluentProvider`.
- `frontend/package.json` — fixa `@fluentui/react-components@9.74.9` e `@fontsource/inter@5.3.0` (exatas).

Diff completo: `git diff` no working tree de `frontend/` (mudança não commitada).

</details>

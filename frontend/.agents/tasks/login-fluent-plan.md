# Plano de Implementação — Redesign da tela de Login (Fluent 2)

Redesenhar `frontend/src/pages/Login.tsx` para espelhar o mock do Figma,
preservando 100% do design system Fluent 2 já adotado, a lógica de autenticação,
o schema Zod, o tratamento de erro e o estado de submit. Tarefa de uma tela só —
trabalho direto no workspace do usuário, sem worktree. Textos em pt-BR.

## Contexto apurado na investigação (ler antes de executar)

- **Stack confirmada** (`frontend/package.json`): React 19, Vite 6, React Router
  7.0.2, TanStack Query 5.62.7, React Hook Form 7.54.2, `@hookform/resolvers`
  3.9.1 (devDependency), Zod 3.23.8, Zustand 5.0.2, `@fluentui/react-components`
  9.74.9, `@fontsource/inter` 5.3.0. TypeScript 5.7 strict, ESM, alias `@/` →
  `src/`.
- **`@fluentui/react-icons` NÃO está instalado** — precisa ser adicionado. A
  linha 2.x é a que pareia com `@fluentui/react-components` 9.x (mesmo
  monorepo/geração Fluent 2). Instalar com `^2` (ver passo 1).
- **Estado atual do Login** (`src/pages/Login.tsx`): já usa `Button`
  appearance="primary", `Field`, `Input`, `MessageBar`/`MessageBarBody`,
  `Spinner`, `makeStyles`, `tokens`, RHF + `zodResolver(loginSchema)`. O schema
  valida `email` (string, min 1 "Informe o e-mail", `.email()`) e `senha` (min 8).
  `useLogin()` (de `@/hooks/useAuth`) retorna `mutateAsync`, `isPending`,
  `isError`. O submit navega para `location.state.from` ou `/dashboard`. O erro
  usa `login.isError` + wrapper `role="alert"`/`aria-live="assertive"` em volta
  do `MessageBar intent="error"` com `MENSAGEM_CREDENCIAIS_INVALIDAS`. O estado
  `enviando = isSubmitting || login.isPending` controla `disabled` e o Spinner no
  botão. **Tudo isso deve ser preservado.**
- **AuthLayout** (`src/components/common/AuthLayout.tsx`): `<main>` centralizado
  (flex, `minHeight: 100vh`, `backgroundColor: tokens.colorNeutralBackground2`)
  com um `Card` Fluent (`maxWidth: 360px`, `padding`, `shadow16`) e um `Title2
  as="h1"` com o `titulo`. Usa `makeStyles` + `tokens`.
- **Testes existentes** (`src/__tests__/rotas-layout.test.tsx`): o único teste
  que toca o Login verifica que, em `/login`, **NÃO** existe `role="banner"` nem
  `role="navigation"` com nome "principal". **Restrição de projeto:** o redesign
  não pode introduzir um `<header>` em nível de landmark (que receberia role
  `banner` implícito) nem uma `<nav aria-label="principal">`. O topo do card
  (logo + nome do produto) deve usar `<div>`/elementos sem papel de landmark, ou
  um `<header>` aninhado dentro do `<main>` (um `<header>` dentro de `<main>` NÃO
  recebe role `banner`). Preferir `<div>` para evitar ambiguidade. Rodar o teste
  após a mudança para confirmar (passo 7).
- **Setup de teste** (`src/__tests__/setup.ts`): já há polyfills de
  `ResizeObserver` e `matchMedia` para componentes Fluent em jsdom. Componentes
  Fluent novos (ícones, Checkbox, Link) não exigem polyfills adicionais.
- **Não tocar:** `global.css`, `index.html` (`lang="pt-BR"` já presente), tema,
  nenhuma outra página. A regra de steering `ui.md` é fileMatch para
  `frontend/**/*.{ts,tsx,css}` — seguir tokens, nunca cor hard-coded, cor de
  marca = verde-sálvia (botão primary já resolve via tema), no máx. 1 primary por
  tela.

## Decisões de design (fixadas pela tarefa — não reabrir)

- Layout do mock, porém com a **cor de marca verde-sálvia do tema** (nenhum
  roxo). O botão "Entrar" usa `appearance="primary"`, que já puxa a marca do
  tema — **não** hard-codar cor.
- Ícones de `@fluentui/react-icons`: envelope (`Mail`), cadeado (`LockClosed`),
  olho (`Eye`/`EyeOff`) para o toggle, e um ícone de documento para o logo.
  Decoração (envelope, cadeado, logo) com `aria-hidden`; o toggle de senha é
  icon-only com `aria-label` dinâmico.
- "Lembrar de mim": **apenas visual** — `Checkbox` do Fluent fora do RHF, não
  entra no schema nem no submit.
- "Esqueceu a senha?" e "Criar conta": **placeholders que não navegam** — `Link`
  Fluent `as="button"` type="button" sem handler de navegação (ou `href`
  ausente), com comentário em pt-BR indicando que são placeholders do MVP. NÃO
  criar rotas novas no React Router.

## Itens do plano

- [ ] 1. Instalar a dependência de ícones Fluent.
      Adicionar `@fluentui/react-icons` (linha `^2`, compatível com
      `@fluentui/react-components` 9.74.9) às `dependencies` do frontend.
      Rodar do diretório `frontend/`: `npm install @fluentui/react-icons@^2`.
      Files: `/Users/nilson/Dev/ni-doc/frontend/package.json`,
      `/Users/nilson/Dev/ni-doc/package-lock.json` (atualizado pelo npm no root
      do monorepo com workspaces).
      Verify: do `frontend/`, `npm ls @fluentui/react-icons` resolve uma versão
      2.x sem erro de peer; confirmar que os ícones `Mail24Regular`,
      `LockClosed24Regular`, `Eye24Regular`, `EyeOff24Regular` e um ícone de
      documento (ex.: `Document24Regular` ou `DocumentText24Regular`) existem no
      pacote via `node -e "const i=require('@fluentui/react-icons'); console.log(['Mail24Regular','LockClosed24Regular','Eye24Regular','EyeOff24Regular','Document24Regular'].map(n=>n+':'+(n in i)))"`.
      Se algum nome não existir nessa versão, escolher o equivalente presente no
      catálogo e registrar no próprio componente.

- [ ] 2. Ajustar o `AuthLayout` para suportar o novo cabeçalho do card (logo +
      nome do produto + título + subtítulo), mantendo-o reutilizável.
      Tornar o `titulo` opcional e aceitar um `topo?: ReactNode` (renderizado
      acima do conteúdo) e um `subtitulo?: string` (texto secundário em
      `tokens.colorNeutralForeground2`, tipografia caption/`base200`). Preservar
      o `<main>` centralizado, o `Card` e o `shadow16`. Alternativa aceitável:
      manter o `AuthLayout` como está e montar todo o cabeçalho dentro do
      `Login.tsx`; se escolher isto, pular este item e documentar a decisão no
      topo do `Login.tsx`. **Decisão recomendada:** estender o `AuthLayout`
      (menos JSX no Login, casca reutilizável para futuras telas de auth), pois o
      diagnóstico aponta o AuthLayout como peça de convergência.
      Garantir que o título continue sendo um heading nível 1 (`Title2 as="h1"`)
      para não quebrar buscas por heading em testes.
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/components/common/AuthLayout.tsx`
      Verify: `npm run build` (do `frontend/`) compila sem erro de tipos; o
      componente aceita as novas props opcionais sem quebrar chamadas existentes.

- [ ] 3. Reescrever o corpo visual do `Login.tsx` espelhando o mock, preservando
      integralmente a lógica. Manter imports e lógica atuais: `useForm` +
      `zodResolver(loginSchema)`, `useLogin`, `useNavigate`/`useLocation`,
      `destino`, `aoEnviar` (handleSubmit), `enviando`, bloco de erro
      `login.isError`. Montar, dentro do AuthLayout:
      - Topo do card: quadrado arredondado (`borderRadius: tokens.borderRadiusLarge`,
        `backgroundColor: tokens.colorBrandBackground`) com um ícone de documento
        Fluent branco (`color: tokens.colorNeutralForegroundOnBrand`,
        `aria-hidden`), acima do nome "Ni.doc".
      - Título "Entre na sua conta" e subtítulo "Insira seus dados para
        continuar." (secundário).
      - Campo E-mail: `Field` label "E-mail" + `Input` type="email"
        autoComplete="email" placeholder "voce@exemplo.com"
        `contentBefore={<Mail… aria-hidden />}`, mantendo `{...register('email')}`
        e `validationState`/`validationMessage` dos erros Zod.
      - Campo Senha: `Field` cujo `label` é um elemento com "Senha" à esquerda e o
        `Link` "Esqueceu a senha?" à direita na mesma linha (flex,
        `justifyContent: space-between`); `Input` com `type` controlado por estado
        local `mostrarSenha` (`'password'`/`'text'`), autoComplete="current-password",
        placeholder "Digite sua senha", `contentBefore={<LockClosed… aria-hidden />}`
        e `contentAfter` com `Button appearance="transparent"` icon-only
        (`Eye`/`EyeOff`) e `aria-label` dinâmico ("Mostrar senha"/"Ocultar senha"),
        `type="button"`, que alterna `mostrarSenha`. Manter `{...register('senha')}`
        e os erros Zod.
      - `Checkbox` "Lembrar de mim" (Fluent), **sem** `register`, apenas visual
        (pode ter `useState` local só para refletir o toque, mas não entra no
        submit). Comentário pt-BR deixando claro que é visual.
      - Botão "Entrar": `appearance="primary"`, `type="submit"`, largura total do
        card (`style={{ width: '100%' }}` ou classe makeStyles com `width: '100%'`),
        `disabled={enviando}`, `icon={enviando ? <Spinner size="tiny"/> : undefined}`,
        texto "Entrando…"/"Entrar". Único primary da tela.
      - Rodapé: texto "Ainda não tem uma conta?" + `Link` "Criar conta"
        (placeholder, não navega). Comentário pt-BR.
      Usar `makeStyles` + `tokens` para todo espaçamento/cor (gaps com
      `tokens.spacingVertical*`); nenhuma cor hard-coded. Não introduzir
      `<header>`/`<nav>` com papel de landmark (ver restrição de teste no
      contexto).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/pages/Login.tsx`
      Verify: `npm run build` compila; inspeção garante que `loginSchema`,
      `useLogin`, `aoEnviar`, `enviando` e o bloco de erro permanecem intactos.

- [ ] 4. Garantir acessibilidade do novo markup. Conferir: cada `Field` associa
      label ao input (Fluent via htmlFor/id); erros Zod continuam via
      `aria-invalid`/`aria-describedby` (o `Field` cuida ao receber
      `validationState`/`validationMessage`); ícones decorativos com
      `aria-hidden`; toggle de senha com `aria-label` dinâmico; `Link`s de
      placeholder com texto autoexplicativo (não "clique aqui"); indicador de
      foco preservado (não adicionar `outline: none`). Placeholder não substitui
      label (labels explícitos presentes).
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/pages/Login.tsx`,
      `/Users/nilson/Dev/ni-doc/frontend/src/components/common/AuthLayout.tsx`
      Verify: `npm run lint` (do `frontend/`) — `eslint-plugin-jsx-a11y` sem novos
      avisos/erros nos arquivos tocados.

- [ ] 5. Rodar o linter e o formatador para alinhar ao estilo do projeto (aspas
      simples, sem ponto-e-vírgula, 2 espaços, trailing commas `all`, largura
      100).
      Files: arquivos tocados nos itens 2–3.
      Verify: `npm run lint` sem erros; `npx prettier --check src/pages/Login.tsx src/components/common/AuthLayout.tsx` (do `frontend/`) retorna "All matched files use Prettier code style" — caso contrário rodar `npm run format` e repetir.

- [ ] 6. Verificação de build de tipos do frontend inteiro.
      Files: nenhum (verificação).
      Verify: `npm run build` (do `frontend/`) conclui `tsc && vite build` sem
      erros de tipo nem de bundling.

- [ ] 7. Rodar a suíte de testes e confirmar que o teste de rotas/layout continua
      passando. O teste em `rotas-layout.test.tsx` monta o `Login` em `/login` e
      exige ausência de `role="banner"` e de `navigation` "principal" — o novo
      cabeçalho do card não pode violar isso. Se algum teste quebrar, ajustar o
      markup (ex.: trocar `<header>`/`<nav>` por `<div>`), não enfraquecer o
      teste.
      Files: nenhum (verificação); se necessário, correção em
      `/Users/nilson/Dev/ni-doc/frontend/src/pages/Login.tsx`.
      Verify: `npm run test` (do `frontend/`, executa `vitest run`) — todos os
      testes passam, incluindo os três casos de `rotas-layout.test.tsx`.

- [ ] 8. (Opcional, recomendado) Adicionar teste de UI do Login cobrindo o novo
      comportamento com seletores acessíveis. Criar
      `src/__tests__/login.test.tsx` mockando `@/hooks/useAuth` (como em
      `rotas-layout.test.tsx`) e envolvendo em `FluentProvider` +
      `MemoryRouter`. Cobrir: (a) campos E-mail e Senha presentes via
      `getByLabelText`; (b) toggle de senha alterna `type` do input e o
      `aria-label` do botão (`getByRole('button', { name: /mostrar senha/i })`);
      (c) checkbox "Lembrar de mim" presente e não afeta o submit; (d) submit com
      dados válidos chama `mutateAsync`. Seguir o padrão de mock e render do teste
      existente; priorizar `getByRole`/`getByLabelText`.
      Files: `/Users/nilson/Dev/ni-doc/frontend/src/__tests__/login.test.tsx`
      Verify: `npm run test` — o novo arquivo passa junto com os existentes.

## Riscos e observações

- **Nome exato dos ícones:** se os nomes sugeridos não existirem na versão 2.x
  instalada, usar o equivalente do catálogo Fluent (ex.: variações `20Regular`),
  resolvido no item 1 antes de usar no componente.
- **Largura do card:** o AuthLayout usa `maxWidth: 360px`. O mock pode pedir algo
  um pouco mais largo para acomodar label + "Esqueceu a senha?" na mesma linha;
  ajustar via token/px no `AuthLayout` se ficar apertado, mantendo centralização
  e responsividade (sem rolagem horizontal a 320px).
- **`global.css` intacto:** o seletor global `main { max-width: 72rem; … }` não
  conflita com o AuthLayout (que já centraliza o Card dentro do `<main>`).
- **Conformidade WCAG:** o item 4 cobre o verificável em código
  (jsx-a11y/estrutura). A conformidade AA plena ainda exige teste manual com
  leitor de tela e verificação de contraste (WebAIM), conforme a steering —
  declarar isso ao concluir.

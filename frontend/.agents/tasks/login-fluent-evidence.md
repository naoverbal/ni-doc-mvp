# Evidência de verificação — Redesign da tela de Login (Fluent 2)

Iteração: primeira (não havia `login-fluent-review.json`).

## Dependência instalada

- `@fluentui/react-icons` **2.0.344** (linha 2.x, pareada com
  `@fluentui/react-components` 9.74.9 do mesmo monorepo Fluent 2).
- Pinada com versão exata em `frontend/package.json`
  (`"@fluentui/react-icons": "2.0.344"`), seguindo o padrão de versões fixas do
  projeto. Registrada em `package-lock.json`.
- Ícones usados, todos confirmados presentes nessa versão: `Mail24Regular`
  (e-mail), `LockClosed24Regular` (senha), `Eye24Regular`/`EyeOff24Regular`
  (toggle de visibilidade), `Document24Regular` (logo).

### Nota de dependência (importante para o reviewer)

O `npm install @fluentui/react-icons@^2` inicial re-deduplicou a árvore e
atualizou `typescript-eslint` de `8.71.0` → `8.71.1` em disco, o que quebrou o
ESLint (o `8.71.1` tenta importar `./use-at-your-own-risk/raw-plugin`,
subcaminho inexistente no `@typescript-eslint/eslint-plugin@8.18.1` pinado pelo
projeto). É uma inconsistência latente de pins no monorepo (plugin `8.18.1` x
meta `typescript-eslint`), não introduzida por esta tarefa — confirmado com
`npm ci` a partir do lockfile original: o lint roda limpo e o lockfile fixa
`typescript-eslint@8.71.0`.

Resolução: reinstalei a partir do lockfile (`npm install` com a entrada já
registrada), que adiciona `@fluentui/react-icons@2.0.344` **sem** promover o
`typescript-eslint`, que permanece em `8.71.0`. Lint volta a passar. Nenhuma
outra dependência foi alterada; o diff do `package-lock.json` é apenas a nova
entrada de ícones.

## Comandos executados (de `frontend/`)

1. `npm run lint` — **OK**, zero erros/avisos (inclui `eslint-plugin-jsx-a11y`).
2. `npm run build` (`tsc && vite build`) — **OK**, sem erros de tipo (TS strict)
   nem de bundling. Há apenas o aviso informativo de chunk > 500 kB, pré-existente
   e não relacionado a esta tarefa.
3. `npm run test -- --run` (`vitest run`) — **OK**, 15 arquivos / 107 testes
   passando. Inclui `src/pages/__tests__/Login.test.tsx` (4),
   `src/__tests__/rotas-layout.test.tsx` (3, confirmando ausência de
   `banner`/`navigation` "principal" em `/login`) e o novo
   `src/__tests__/login.test.tsx` (2). A linha de stderr "Keyborg instance ...
   disposed incorrectly" é ruído de teardown do Fluent em jsdom, não falha.

## Testes

- **Nenhum teste existente precisou ser enfraquecido.** O teste existente usa
  `getByLabelText('Senha')`; para não quebrar a associação de rótulo, o link
  "Esqueceu a senha?" foi mantido **fora** do `<label>` do `Field` (posicionado
  via CSS absoluto no canto superior direito do campo), em vez de aninhado no
  slot de label. Isso preserva o nome acessível do input ("Senha") e evita
  elemento interativo dentro de `<label>`.
- Adicionado `src/__tests__/login.test.tsx` cobrindo o comportamento novo com
  seletores acessíveis: (a) toggle de senha alterna `type` e o `aria-label` do
  botão de olho (`Mostrar senha`/`Ocultar senha`); (b) checkbox "Lembrar de mim"
  presente e ausente do payload do submit.

## Conformidade de acessibilidade

Verificado em código: labels associados via `Field`, erros Zod via
`aria-invalid`/`aria-describedby` (slot do `Field`), ícones decorativos com
`aria-hidden`, botão de olho icon-only com `aria-label` dinâmico, links de
placeholder com texto autoexplicativo, indicador de foco preservado, cores só
via tokens Fluent (marca verde-sálvia via `appearance="primary"` /
`colorBrandBackground`). A conformidade WCAG 2.2 AA plena ainda exige teste
manual com leitor de tela e verificação de contraste (WebAIM), conforme a
steering.

## Arquivos tocados

- `frontend/src/pages/Login.tsx` (redesign, lógica preservada)
- `frontend/src/components/common/AuthLayout.tsx` (props opcionais `topo`,
  `subtitulo`, `titulo` opcional; largura do card 360px → 400px)
- `frontend/src/__tests__/login.test.tsx` (novo)
- `frontend/package.json` + `package-lock.json` (nova dependência)

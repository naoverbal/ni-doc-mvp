# Redesign da tela de Login (Fluent 2) com ícones de marca

Reescreve `Login.tsx` para espelhar o mock do Figma usando componentes Fluent 2 e
tokens de marca, estende `AuthLayout` com topo/subtítulo opcionais, e adiciona a
dependência `@fluentui/react-icons` (envelope, cadeado, olho, documento). Toda a
lógica de autenticação — `loginSchema` Zod, `useLogin`, `aoEnviar`, estado de
submit e bloco de erro `MessageBar` — foi preservada verbatim; a mudança é
puramente de apresentação mais um toggle de visibilidade de senha. Checkbox
"Lembrar de mim" e os links "Esqueceu a senha?"/"Criar conta" são placeholders que
não entram no submit nem navegam.

Watch for: nenhuma preocupação bloqueante. O toggle de senha e os links placeholder
foram implementados exatamente como a tarefa pediu (confirmed). A associação de
rótulo do campo senha é preservada mantendo o link "Esqueceu a senha?" fora do
`<label>` (confirmed) — decisão importante que mantém os testes existentes verdes.

**Verdict**: APPROVED

## High-level view

A lógica de auth não foi tocada: o `handleSubmit`/`zodResolver(loginSchema)`, a
chamada `login.mutateAsync`, o cálculo de `destino`, a flag `enviando` e o wrapper
`role="alert"`/`aria-live="assertive"` em volta do `MessageBar` estão idênticos ao
original. O redesign é camada visual mais um `useState(mostrarSenha)` local.

O layout do mock foi reproduzido com Fluent puro: logo em quadrado com
`colorBrandBackground` e ícone `Document24Regular` branco via
`colorNeutralForegroundOnBrand` (verde-sálvia da marca, não roxo), título/subtítulo,
campos com `contentBefore` (envelope/cadeado) e placeholders, toggle de olho
funcional no `contentAfter`, checkbox visual e botão primary de largura total. Não
há cor hard-coded — só dimensões em px (48px do logo, 400px do card), o que a
steering permite.

Os três controles sem comportamento ("Esqueceu a senha?", "Criar conta",
"Lembrar de mim") são `Link as="button" type="button"` e `Checkbox` sem handler nem
`register`, com comentários pt-BR marcando-os como placeholders do MVP. Nenhuma rota
nova foi criada.

A acessibilidade é coberta em código: labels via `Field`, erros Zod via
`validationState`/`validationMessage` (que o Fluent mapeia para
`aria-invalid`/`aria-describedby`), ícones decorativos `aria-hidden`, botão de olho
icon-only com `aria-label` dinâmico. A conformidade WCAG AA plena ainda exige teste
manual com leitor de tela, como a evidência corretamente declara.

O escopo foi respeitado: apenas `Login.tsx`, `AuthLayout.tsx`, o novo teste e os dois
manifestos de dependência. `@fluentui/react-icons` está pinada em `2.0.344` (exata,
pareada com `react-components` 9.74.9). `AuthLayout` só é consumido pelo `Login`, então
tornar `titulo` opcional e alargar o card de 360px para 400px não tem risco de
regressão.

<details>
<summary>Issues (0)</summary>

Nenhum finding bloqueante ou não-bloqueante. Todos os critérios de aprovação foram
satisfeitos.

</details>

<details>
<summary>Details</summary>

## Lógica de autenticação preservada

O corpo de `Login.tsx` abaixo da declaração de estilos é funcionalmente idêntico ao
original: `useForm<LoginFormulario>({ resolver: zodResolver(loginSchema), mode: 'onSubmit' })`,
o mesmo `loginSchema` (`email` com `.min(1).email()`, `senha` com `.min(8)`), o mesmo
`MENSAGEM_CREDENCIAIS_INVALIDAS`, o mesmo `destino = location.state.from.pathname ?? '/dashboard'`,
o mesmo `aoEnviar` com `try/catch` em volta de `login.mutateAsync` e `navigate(destino, { replace: true })`,
e `enviando = isSubmitting || login.isPending` controlando `disabled` e o `Spinner` no
botão. O bloco de erro `login.isError` continua envolto em `<div role="alert" aria-live="assertive">`
sobre o `MessageBar intent="error"`.

A única adição à lógica é `const [mostrarSenha, setMostrarSenha] = useState(false)`,
que alterna apenas o `type` do input de senha — não toca no RHF nem no payload. O
suíte existente `pages/__tests__/Login.test.tsx` continua válido porque segue
encontrando `getByLabelText('E-mail')`, `getByLabelText('Senha')` e
`getByRole('button', { name: 'Entrar' })`: os novos controles (`Mostrar senha`,
`Esqueceu a senha?`, `Criar conta`) têm nomes acessíveis distintos e não colidem com
esses seletores. A evidência registra 107 testes passando em 15 arquivos, incluindo
os 4 de `Login.test.tsx`, os 3 de `rotas-layout.test.tsx` e os 2 do novo
`login.test.tsx`.

## Toggle de senha e preservação do rótulo

O ponto não-trivial do redesign é posicionar "Esqueceu a senha?" na linha do label
sem quebrar a associação de rótulo que o teste existente depende. A solução coloca o
`Link` como irmão do `Field` dentro de um wrapper `position: relative`, com o link em
`position: absolute; top: 0; right: 0`, em vez de aninhá-lo no slot de label do
`Field`. Isso evita um elemento interativo dentro de `<label>` (anti-padrão de a11y) e
mantém o nome acessível do input como "Senha". O toggle de olho vive no `contentAfter`
do `Input` como `Button appearance="transparent" type="button"` icon-only, com
`aria-label` que alterna entre "Mostrar senha" e "Ocultar senha" conforme
`mostrarSenha` — exatamente o comportamento exigido, e coberto pelo novo teste que
afirma a mudança de `type` e de `aria-label`.

## Tokens de marca, sem roxo

O logo é um `<span>` 48×48 com `borderRadius: tokens.borderRadiusLarge` e
`backgroundColor: tokens.colorBrandBackground`, contendo `Document24Regular` com
`color: tokens.colorNeutralForegroundOnBrand`. Como a rampa de marca do tema é
verde-sálvia (`#4d5d53` e tons derivados), o fundo resolve para verde e o ícone para
branco — satisfazendo "ícone branco, não roxo" sem nenhuma cor hard-coded. O botão
"Entrar" usa `appearance="primary"`, único primary da tela, puxando a marca do tema.
A busca por hex/`rgb()`/"purple" nos dois arquivos tocados não retornou nada.

## Placeholders que não navegam

"Esqueceu a senha?" e "Criar conta" são `Link as="button" type="button" inline` sem
`onClick` nem `href` — clicá-los não dispara navegação nem submit (o `type="button"`
impede submit acidental dentro do `<form>`). Nenhuma rota foi adicionada ao React
Router. Ambos têm comentário pt-BR explicando que são placeholders inexistentes no
MVP. "Lembrar de mim" é um `Checkbox` Fluent sem `register`, confirmado pelo teste que
clica no checkbox e verifica que o payload do `mutateAsync` contém apenas `email` e
`senha`.

</details>

<details>
<summary>Arquivos alterados</summary>

- `frontend/src/pages/Login.tsx` — redesign visual + toggle de senha; lógica de auth intacta.
- `frontend/src/components/common/AuthLayout.tsx` — `titulo` opcional, novas props `subtitulo`/`topo`, card 360px→400px.
- `frontend/src/__tests__/login.test.tsx` — novo; cobre toggle de senha e checkbox visual fora do submit.
- `frontend/package.json` — adiciona `@fluentui/react-icons` pinada em `2.0.344`.
- `package-lock.json` — entrada correspondente da nova dependência.

Diff completo: `git show 361fae2`.

</details>

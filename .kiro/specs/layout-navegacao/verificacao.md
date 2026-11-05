# Nota de Verificação — Tarefa 5 (Acessibilidade e navegação por teclado)

Spec: `layout-navegacao`. Requisitos cobertos: RF-L05, RF-L06.

Esta é uma tarefa de verificação. Nenhum código de feature foi reescrito; o
trabalho consistiu em rodar as checagens automatizadas e confirmar, por código e
por testes, os critérios verificáveis estaticamente. O que depende de
renderização real e de tecnologia assistiva está registrado como pendência de
teste manual.

## Checagens automatizadas (frontend)

Executadas em `frontend/` com Node 22:

| Comando         | Resultado                                            |
| --------------- | ---------------------------------------------------- |
| `npm run lint`  | limpo — `eslint-plugin-jsx-a11y` sem avisos          |
| `npm run test`  | 101 testes em 13 arquivos, todos passando            |
| `npm run build` | `tsc` + `vite build` sem erros                       |

## Verificado em código / por testes

### Navegação por teclado e foco (RF-L05)

- **Skip link como primeiro elemento focável.** `LayoutApp` renderiza
  `<a class="skip-link" href="#conteudo">` antes do `<header>`. Teste
  `LayoutApp.test.tsx` confirma que o primeiro `Tab` leva o foco ao skip link.
- **Controles nativos operáveis por teclado.** A navegação usa `NavLink`
  (`<a>`) e o logout é um `<button type="button">` — ambos focáveis e
  acionáveis por teclado por padrão. Nenhum `div`/`span` com handler de clique.
- **Foco visível preservado e reforçado.** `global.css` define
  `:focus-visible { outline: 3px solid var(--cor-foco); outline-offset: 2px }`.
  Não há `outline: none` sem alternativa em todo o arquivo (confirmado na
  tarefa 1 e reconfirmado aqui).
- **Link atual não depende só de cor.** O seletor
  `.app-nav a[aria-current='page']` aplica `font-weight: 700`,
  `text-decoration: underline` e `border-bottom-color` além da cor — reforço
  não-cromático (WCAG 1.4.1). O `aria-current="page"` é aplicado pelo `NavLink`
  no link ativo; testes confirmam o atributo na rota atual e sua ausência nos
  demais, incluindo a permanência de "Orçamentos" ativo nas subrotas.
- **Logout acionável por teclado e resiliente.** Botão nativo; testes cobrem
  sucesso e erro de rede (em ambos limpa o estado e navega para `/login`) e o
  estado pendente (desabilitado, rótulo "Saindo…").
- **Ordem de foco lógica.** Skip link → header (marca, nav, identidade, Sair) →
  conteúdo, seguindo a ordem do DOM; nenhum `tabindex` positivo introduzido.

### Responsividade (RF-L06)

- **Três breakpoints oficiais** presentes e documentados no topo do
  `global.css`: base mobile (≥ 320 px, sem media query),
  `@media (min-width: 600px)` (tablet) e `@media (min-width: 1024px)` (desktop).
  Abordagem mobile-first.
- **Unidades fluidas:** `rem`/`%`/`clamp()` em tipografia, espaçamentos e
  larguras; sem larguras fixas em px que forcem rolagem horizontal.
- **Sem rolagem horizontal da página:** `body { overflow-x: hidden }`.
- **Tabela com rolagem própria:** `.tabela-rolavel { overflow-x: auto }`, para a
  tabela de orçamentos não introduzir rolagem horizontal na página a 320 px
  (WCAG 1.4.10 Reflow).
- **Meta viewport presente** em `frontend/index.html`:
  `<meta name="viewport" content="width=device-width, initial-scale=1.0" />`.
- **Alvos de toque** com `min-height: var(--alvo-toque)` (~44 px) em links de
  nav e botões.

### Contraste da paleta (RF-L05.2)

Valores documentados no topo de `global.css`, todos atingindo WCAG AA
(≥ 4.5:1 texto normal; ≥ 3:1 texto grande/componentes):

| Par                                   | Razão aprox. | Classificação |
| ------------------------------------- | ------------ | ------------- |
| texto `#1a1d21` sobre `#ffffff`       | ~16:1        | AA/AAA        |
| texto `#1a1d21` sobre `#f5f6f8`       | ~14.9:1      | AA/AAA        |
| texto fraco `#4a4f57` sobre `#ffffff` | ~8.6:1       | AA/AAA        |
| primária `#0b5cab` sobre `#ffffff`    | ~6.4:1       | AA            |
| branco sobre primária `#0b5cab`       | ~6.4:1       | AA            |
| primária escura `#084584` sobre `#fff`| ~9.3:1       | AA/AAA        |
| perigo `#a21b1b` sobre `#ffffff`      | ~7.1:1       | AA/AAA        |

Os valores documentados atendem AA. Os cálculos são os registrados no CSS;
confirmação em ferramenta de contraste no render real fica como item manual.

## Pendente de teste manual (fora do alcance do ambiente de execução)

Requer navegador real e/ou tecnologia assistiva — não validável só por código:

- **Reflow a 320 CSS px e zoom de 400%** no DevTools: confirmar visualmente
  ausência de rolagem em dois eixos e nenhuma perda de conteúdo/funcionalidade.
- **Qualidade do anúncio por leitor de tela** (NVDA/VoiceOver/JAWS): leitura de
  landmarks, do `aria-current`, do skip link e do estado do botão de logout.
- **Visibilidade real do indicador de foco** ao navegar com Tab/Shift+Tab/Enter
  em um navegador, incluindo o aparecimento do skip link ao receber foco.
- **Renderização efetiva de contraste** medida em ferramenta sobre a tela
  renderada (os valores aqui são os de projeto, documentados no CSS).
- **Operação por toque** em dispositivo real (alvos ~44×44 px nas três faixas).

> Conforme a diretriz de acessibilidade do projeto, a conformidade total com
> WCAG 2.1 AA exige esse teste manual com tecnologia assistiva e revisão humana;
> esta nota cobre o que é verificável em código e testes.

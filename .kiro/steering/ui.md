---
inclusion: fileMatch
fileMatchPattern: ['frontend/**/*.ts', 'frontend/**/*.tsx', 'frontend/**/*.css']
---

# UI/UX (Fluent 2 Web)

Padrões visuais, de componentes e de interação do ni-doc. A UI é construída sobre
**Microsoft Fluent 2** (`@fluentui/react-components`), com tema de marca `#4d5d53`
(verde-sálvia), light/dark mode, tipografia Inter e alvo de acessibilidade WCAG 2.2 AA.

**Regras de ouro:**
- Use tokens Fluent (`tokens.*` / CSS vars), nunca valores hard-coded. Se faltar um
  token, acrescente-o às tabelas abaixo antes de usar.
- Antes de criar um componente novo, confira o inventário (seção 3). Novo componente
  reutilizável vive em `components/common/` e deve ser documentado aqui.
- Prefira semântica Fluent/HTML nativa; só use ARIA quando a nativa não cobrir.
- Textos de UI em pt-BR. Veja também `accessibility.md` e `.kiro/specs/ni-doc-mvp/design.md`.

---

## 1. Tema e Setup

- Tema em `frontend/src/theme/ni-doc-theme.ts` exportando `lightTheme` e `darkTheme`,
  gerados de uma `BrandVariants` (rampa de 16 tons, 10 = escuro → 160 = claro) via
  `createLightTheme`/`createDarkTheme`, com `fontFamilyBase: 'Inter, system-ui, -apple-system, sans-serif'`
  e `fontFamilyMonospace: 'JetBrains Mono, Menlo, monospace'`.
- `<FluentProvider>` envolve a app na raiz (`App.tsx`), alternando tema pelo
  `theme.store.ts` (Zustand). Padrão inicial segue `prefers-color-scheme`.
- Cor de marca base = tom `60` (`#4d5d53`); botão brand usa `80` (default) / `70` (hover) /
  `30` (pressed); bordas em dark usam `110`. Regenere a rampa no Fluent Theme Designer
  para garantir contraste AA.
- Fonte Inter importada via `@fontsource/inter`.

Rampa de marca (`BrandVariants`):
`10 #171d19 · 20 #222924 · 30 #2d352f · 40 #38423a · 50 #414d44 · 60 #4d5d53 · 70 #5a6b60 · 80 #6b7c72 · 90 #7c8d83 · 100 #8fa096 · 110 #a4b4aa · 120 #b9c8be · 130 #cddad2 · 140 #dfe8e3 · 150 #ecf1ee · 160 #f7faf8`

---

## 2. Design Tokens

Use sempre os tokens; os valores servem de referência quando um custom token for necessário.

### Cores semânticas (light / dark)

| Token | Light | Dark | Uso |
|-------|-------|------|-----|
| `--colorSuccessBackground` / `Foreground` | `#dff6dd` / `#0e700e` | `#052505` / `#92c353` | Sucesso |
| `--colorWarningBackground` / `Foreground` | `#fff4ce` / `#835c00` | `#3d2d00` / `#f7d54c` | Aviso |
| `--colorDangerBackground` / `Foreground` | `#fde7e9` / `#b10e1c` | `#3b0a0a` / `#f1707b` | Erro |
| `--colorInfoBackground` / `Foreground` | `#e5f1fb` / `#0078d4` | `#0a2c4d` / `#6cb8f6` | Info |

### Tipografia (Inter)

`fontSizeBase100` 10px/400 · `base200` 12px/400 (legendas, hints) · `base300` 14px/400
(corpo padrão) · `base400` 16px/400 · `base500` 20px/600 (subtítulo) · `base600` 24px/600
(título de seção) · `Hero700` 28px/700 (título de página) · `Hero800` 32px/700 ·
`Hero900` 40px/700 (hero do dashboard). Números/códigos em JetBrains Mono.

### Espaçamento (grid 4px)

`XXS` 2 · `XS` 4 · `S` 8 · `M` 12 (padding de input) · `L` 16 (gap entre campos) ·
`XL` 20 (padding de card) · `XXL` 24 (gap entre seções) · `XXXL` 32 (padding de página).

### Bordas, sombras, movimento

- Raios: `Small` 2 (checkbox) · `Medium` 4 (input, botão) · `Large` 6 (card, modal) ·
  `XLarge` 8 (drawer) · `Circular` (avatar).
- Sombras: `shadow2` card · `shadow4` card hover · `shadow8` dropdown/popover ·
  `shadow16` modal/drawer · `shadow28` confirmação destrutiva.
- Durações: `UltraFast` 50 · `Faster` 100 · `Fast` 150 (dropdown) · `Normal` 200 (modal) ·
  `Slow` 300 (drawer); curva padrão `cubic-bezier(0.33, 0, 0.67, 1)`.
- **Sempre respeitar `prefers-reduced-motion`.**

---

## 3. Inventário de Componentes

### Botões (variantes Fluent)

`primary` ação principal · `secondary` cancelar/voltar · `subtle` ação terciária em toolbar ·
`transparent` ícone (ex.: fechar) · `outline` ação alternativa (ex.: baixar PDF) ·
`danger` ação destrutiva.
**Regra: no máximo um `primary` por tela.** Se houver dois, o segundo vira `outline`/`secondary`.

### Formulários

- Input/Textarea/Select/Combobox nativos do Fluent. Autocomplete = Combobox `freeform`
  com opção "Criar novo".
- Máscaras (CPF/CNPJ, telefone, moeda) via `react-imask`; componente `CurrencyInput`.
- Validação: React Hook Form + Zod; marque campo com `aria-invalid` e vincule a mensagem
  via `aria-describedby`; `<label htmlFor>` sempre (placeholder não é rótulo).
- Tokens `autocomplete`: `name`, `email`, `tel`, `postal-code`, `current-password`, `new-password`.

### DataGrid

`size="small"` (compact) para listagens; colunas redimensionáveis; ordenação por header
(`aria-sort`); seleção múltipla por checkbox; ações na última coluna (ícone + tooltip +
`aria-label`); paginação no rodapé, 20 itens/página.

### Modais e drawers

| Contexto | Componente | Tamanho |
|----------|-----------|---------|
| Confirmação (simples/destrutiva) | `Dialog` | Small 400px (destrutiva usa botão `danger`) |
| Formulário curto | `Dialog` | Medium 600px |
| Formulário longo | `Drawer` (right) | Large 720px |
| Detalhes | `Drawer` (right) | Medium 480px |

Fecham com `Esc` e clique fora **apenas** quando não há alterações não salvas. Use focus
trap, `aria-modal="true"` e devolva o foco ao fechar.

### Feedback

- Sucesso: `Toast` top-right, 4s. Erro de sistema: `Toast` danger, 8s ou manual.
  Erro de validação: mensagem inline persistente (`role="alert"`). Info: `MessageBar` inline.
- Carregamento: `Skeleton` (3–5 linhas) em listas; `Spinner` + `disabled` no botão durante
  ação; `Spinner` centralizado em página inteira; `ProgressBar` indeterminada no topo em refetch.
- Estado vazio: ilustração SVG (brand) + título (`base500`) + descrição (`base300`,
  `neutralForeground2`) + botão primário.

---

## 4. Layout

**App shell (área logada):** sidebar + header sticky + conteúdo.
- Sidebar: 240px expandida, 64px colapsada (ícones + tooltip); colapsa auto em tablet
  (< 1024px); vira drawer com hamburger em mobile (< 640px).
- Header: 56px, com nome do usuário, tenant, sino de notificações (badge), avatar e logout.

**Layout público (aprovação):** sem sidebar, header simples de 64px com logo do tenant,
sem navegação; foco no preview do PDF, integridade (hash SHA-256), aceite dos termos e
ações aprovar/reprovar.

**Breakpoints Fluent:** Small 320–479 (sidebar vira hamburger; tabelas viram cards) ·
Medium 480–639 · Large 640–1023 (sidebar colapsa) · XLarge 1024–1365 · XXLarge 1366–1919 ·
XXXLarge 1920+ (conteúdo centrado, max 1440px).

**Densidade:** compact em DataGrids; comfortable (`size="medium"`) em formulários, editor
de template e página pública.

---

## 5. Padrões de Interação

**Atalhos:** `Ctrl/Cmd+K` busca global · `Ctrl/Cmd+N` novo orçamento · `Ctrl/Cmd+S` salvar
rascunho · `Ctrl/Cmd+Enter` enviar · `Esc` fechar modal/drawer · `Alt+1..8` seções da sidebar.

**Autosave:** rascunho salva silenciosamente a cada 30s, com indicador "Salvo há X segundos"
no header; publicação só por ação manual ("Enviar"); sair com alterações salva como rascunho.

**Confirmações:** excluir orçamento ou descartar rascunho usam `Dialog` (danger quando
destrutivo); excluir item usa Toast com "Desfazer" (5s); mudança de status usa Toast.

**Assíncrono:** botão vira `Spinner` + `disabled` durante a ação; Toast de resultado ao
concluir; listas recarregam via TanStack Query (refetch).

**Navegação:** breadcrumbs em telas de detalhe, botão "Voltar" no topo esquerdo, deep
linking (`/orcamentos/:id`), estado de formulário preservado ao voltar.

---

## 6. Acessibilidade (específico de UI)

Complementa `accessibility.md`.
- Focus ring de marca (tom 80), 3px; nunca remover indicador de foco.
- Contraste AA em todos os pares texto/fundo (validar no WebAIM).
- Não comunicar informação só por cor — status de orçamento precisa de rótulo textual.
- Anúncios de leitor de tela via `aria-live`: mudança de status, recálculo de total; erros
  de validação com `role="alert"`.
- Idioma `lang="pt-BR"`; ícone-botão sem texto recebe `aria-label`.
- Verificar com `eslint-plugin-jsx-a11y`, axe-core (zero violações) e navegação por teclado
  antes de concluir tarefa de UI; teste manual com leitor de tela ainda é necessário para
  afirmar conformidade.

---

## 7. Estrutura de Pastas (frontend/src)

```
theme/        ni-doc-theme.ts (lightTheme, darkTheme), tokens.css
components/
  layout/     AppShell, Sidebar, Header, PublicLayout
  common/     AuthLayout, EmptyState, LoadingSkeleton, ConfirmDialog, Autocomplete, CurrencyInput
  domain/     OrcamentoDataGrid, ItemOrcamentoRow, CanvasA4, StatusBadge
pages/        Login, Dashboard, OrcamentoLista, OrcamentoEditor, TemplateEditor, PublicoOrcamento
hooks/  stores/ (theme.store.ts)  services/
```

Telas principais: Login, Dashboard (cards de métricas + orçamentos recentes), Lista de
Orçamentos (DataGrid com filtros), Editor de Orçamento (dados, itens, condições de
pagamento, resumo com subtotal/desconto/total), Editor de Template (canvas A4 +
ferramentas + painel de propriedades) e Página Pública de Aprovação.

---

## Referências

- Fluent 2 React — https://react.fluentui.dev/
- Fluent Theme Designer — https://react.fluentui.dev/?path=/docs/theme-theme-designer--docs
- Fluent Icons — https://react.fluentui.dev/?path=/docs/icons-catalog--docs
- Inter — https://rsms.me/inter/ · WebAIM Contrast Checker — https://webaim.org/resources/contrastchecker/
- `accessibility.md` · `.kiro/specs/ni-doc-mvp/design.md`

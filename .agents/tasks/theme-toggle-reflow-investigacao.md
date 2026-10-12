# Investigação: reflow do header ao alternar tema (read-only)

## Resposta-resumo (causa raiz)

O "pulo" horizontal do header ao clicar no `<Switch>` de tema é causado pela
**diferença de largura do texto do rótulo do Switch**: `"Tema escuro"` é
**~12,6 px mais largo** que `"Tema claro"`. Como o rótulo do Fluent `Switch`
não tem largura fixa, o `<Switch>` encolhe/estica a cada toggle, o contêiner
`tema` acompanha, e o grupo `acoes` (incluindo o botão **Sair**) desloca para a
esquerda/direita.

O fix anterior (`minWidth: 150px` + `justifyContent: flex-start` no contêiner
`tema`) **não funcionou porque 150 px é menor do que a largura real de QUALQUER
um dos dois estados** do contêiner `tema`:

| Estado          | Largura do contêiner `tema` | ≥ 150 px? |
|-----------------|-----------------------------|-----------|
| Tema claro      | **~166,2 px**               | sim (já passa) |
| Tema escuro     | **~178,8 px**               | sim (já passa) |

Como o conteúdo nos dois estados já é mais largo que `minWidth: 150px`, o
`min-width` **nunca entra em ação** — o elemento sempre dimensiona pelo
conteúdo, e a variação de 12,58 px entre os estados continua intacta. Por isso
o usuário vê o bug "exatamente como antes".

**Correção mínima:** reservar largura suficiente para o estado mais largo
(~179 px). Recomenda-se `minWidth: '188px'` (≈179 arredondado + folga) **ou**,
preferível, fixar o rótulo do Switch (ex.: sempre `"Tema"` ou um label estável)
para que a troca não altere a largura. Detalhes e números na seção
Recomendações.

---

## Como foi medido (evidência executada)

### Ambiente / limitação de execução

- `frontend` usa `@fluentui/react-components@9.74.9`, `@fluentui/react-icons@2.0.344`,
  fonte Inter via `@fontsource/inter@5.3.0`
  (`frontend/package.json`).
- **Não foi possível renderizar via browser.** O stack logado (dashboard) exige
  backend + Postgres + login (`App.tsx` → `PrivateRoute`). Além disso, o Chrome
  do Puppeteer disponível em cache (`mac_arm-127.0.6533.88`, usado pelo backend
  para PDF) é **encerrado pelo SO ao iniciar** (exit 137 / `SIGKILL`; `spawn`
  retorna erro `-88` sob Node v26.10). Não há Chrome/Edge de sistema instalado;
  só Safari. Portanto, caí para a **medição determinística via métricas da fonte
  real + composição do box-model com o CSS compilado do próprio Switch** —
  abordagem prevista no brief como fallback.
- Nenhum código-fonte foi alterado. A única modificação no working tree é o
  fix anterior já existente (ver "Verificação do fix anterior").

### 1. Largura do texto dos rótulos (fonte Inter real)

Parse do arquivo `.woff` que o app efetivamente carrega
(`@fontsource/inter/files/inter-latin-400-normal.woff`), lendo `head`
(`unitsPerEm = 2048`), `hhea`/`hmtx` (advance widths) e `cmap` (formato 4),
e somando os advances dos glifos em `fontSizeBase300 = 14px` (tamanho do rótulo
do Switch `size="medium"`):

| Texto         | Largura @14px | Fonte do dado |
|---------------|---------------|---------------|
| `Tema claro`  | **74,18 px**  | hmtx Inter 400 |
| `Tema escuro` | **86,75 px**  | hmtx Inter 400 |
| **Diferença** | **12,58 px**  | — |

### 2. Composição da largura do contêiner `tema` (box-model)

Valores extraídos do CSS **compilado** do Switch instalado
(`@fluentui/react-switch/.../useSwitchStyles.styles.js`), size `medium`,
`labelPosition="after"` (padrão):

- `indicator`: `width:40px` + `margin: var(--spacingVerticalS) var(--spacingHorizontalS)`
  → footprint horizontal = 8 + 40 + 8 = **56 px** (classe `.r1c3hft5`).
- `label` (base `.f1f5q0n8` = padding `8px 8px`; `after` `.fruq291` sobrescreve
  `padding-left` para `spacingHorizontalXS = 4px`): extra horizontal =
  4 (esq.) + 8 (dir.) = **12 px** + largura do texto.
- `input`: `position:absolute` → **não ocupa espaço** no fluxo (classe `.r12ojtgy`).
- `switchRoot` ≈ 56 + 12 + texto.
- Contêiner `tema` = ícone (20 px) + `columnGap` XS (4 px) + `switchRoot`
  (ver `Header.tsx`, `useStyles.tema`).

Resultado:

| Peça                     | Tema claro | Tema escuro |
|--------------------------|------------|-------------|
| texto do rótulo          | 74,18      | 86,75       |
| `switchRoot` (texto+68)  | 142,18     | 154,75      |
| contêiner `tema` (+24)   | **166,18** | **178,75**  |

Maior estado = **~178,75 px**.

### 3. Maior contribuinte da variação (resposta à pergunta 3)

| Causa candidata | Contribuição para a variação |
|-----------------|------------------------------|
| (a) **texto do rótulo** (`Tema escuro` vs `Tema claro`) | **12,58 px — 100% da variação** |
| (b) troca de ícone (`WeatherMoon20Regular` ↔ `WeatherSunny20Regular`) | **0 px** |
| (c) padding/estilo do Switch dependente de `checked` | **0 px** |
| (d) outro | 0 px |

- (b) **0 px**: ambos os ícones são criados com
  `createFluentIcon('...', "20", ...)` → caixa fixa 20×20 nos dois estados.
- (c) **0 px**: as diferenças por `:checked` no CSS do Switch são apenas de
  **cor/background/border e `transform: translateX` do thumb** — nenhuma muda
  largura, padding ou margin (classe `.r12ojtgy` e correlatas).

Logo, **o texto do rótulo é o único contribuinte** (12,58 px).

### 4. 150 px é suficiente? (resposta à pergunta 4)

**Não.** `minWidth: 150px < 166,18px` (estado mais estreito) `< 178,75px`
(estado mais largo). Como o conteúdo já excede 150 px nos dois estados, o
`min-width` é inócuo: o contêiner dimensiona pelo conteúdo e a variação de
12,58 px persiste. **Esse é o motivo exato de o fix anterior ter falhado.**

Largura mínima necessária para o estado mais largo: **≥ ~179 px**
(recomendado **188 px** com folga para kerning/arredondamento de subpixel).

---

## Verificação do fix anterior

`git diff frontend/src/components/layout/Header.tsx` mostra exatamente o fix que
não resolveu, no bloco `useStyles.tema`:

```
+    minWidth: '150px',
+    justifyContent: 'flex-start',
```

Diagnóstico: valor subdimensionado (150 < 179). O `justifyContent: flex-start`
é inofensivo mas irrelevante enquanto o `min-width` não for atingido.

---

## Recomendações (não implementadas)

Em ordem de preferência:

### Opção A — fixar o rótulo (mais robusta, Fluent-idiomática)

Tornar o texto do Switch **invariante** para que a largura não dependa do
estado. Como o `aria-label="Alternar tema claro e escuro"` já descreve a ação,
o rótulo visível pode ser estável, por exemplo `label="Tema"` (ou `"Tema escuro"`
fixo como legenda da ação), mantendo o ícone como pista do estado atual.

- Prós: elimina a causa raiz (variação de 0 px por construção); não depende de
  medir larguras; imune a mudança futura de fonte/tamanho.
- Contras: o texto deixa de refletir o estado atual (mitigado pelo ícone
  sol/lua, que já troca, e pelo próprio estado on/off do Switch).

### Opção B — reservar largura suficiente (menor mudança no comportamento visual)

Manter o texto dinâmico, mas dar ao contêiner `tema` largura reservada para o
estado mais largo:

```
minWidth: '188px'   // ≥ 178,75px medido + folga
```

- Prós: mantém "Tema claro"/"Tema escuro" dinâmicos.
- Contras: valor "mágico" acoplado à fonte/tamanho atuais; se Inter, o tamanho
  do rótulo ou os textos mudarem, precisa ser recalculado. Documentar a origem
  do número (179 px medidos) no comentário.
- Observação: `justifyContent: flex-start` deve ser mantido para o conteúdo não
  "dançar" dentro da largura reservada; com largura adequada, ele passa a ter
  efeito.

### Opção C — reservar largura só no rótulo

Aplicar `minWidth` ao próprio `.fui-Switch__label` suficiente para o texto mais
largo (~87 px de texto → `min-width` do label ~99 px considerando o padding de
12 px), via `className` no slot `label` do Switch. Fixa a variação na origem
(o rótulo) sem número no contêiner inteiro, mas ainda é um valor dependente da
fonte, como a Opção B.

**Recomendação final:** **Opção A** (rótulo fixo) por eliminar a causa raiz sem
números frágeis. Se o produto exigir manter o texto dinâmico "Tema claro/escuro",
usar a **Opção B** com `minWidth: '188px'` e comentário citando os 178,75 px
medidos.

---

## Arquivos/símbolos citados

- `frontend/src/components/layout/Header.tsx` — `useStyles.tema` (contêiner),
  `<Switch label={ehEscuro ? 'Tema escuro' : 'Tema claro'}>`, ícones
  `WeatherMoon20Regular`/`WeatherSunny20Regular`, grupo `acoes`, `espacador`.
- `frontend/src/stores/theme.store.ts` — `alternar()` troca `claro`/`escuro`.
- `frontend/src/theme/ni-doc-theme.ts` — `fontFamilyBase: 'Inter, ...'`.
- `@fluentui/react-switch/.../useSwitchStyles.styles.js` — larguras/margens/
  paddings compilados do Switch (indicator 40px + margin S; label padding S/S
  com `after` → padding-left XS).
- `@fluentui/react-icons` — `createFluentIcon('WeatherMoon20Regular', "20", …)`
  e `WeatherSunny20Regular` (caixa fixa 20px).
- `@fontsource/inter/files/inter-latin-400-normal.woff` — origem das métricas de
  texto (`unitsPerEm` 2048; advances via `hmtx`/`cmap`).

## Nota de método

As larguras de texto vêm das métricas reais da fonte Inter que o app carrega
(determinístico, independente de GPU/subpixel). A composição do contêiner usa os
valores do CSS **compilado** do Switch instalado, não suposições. Não foi
possível confirmar via rasterização de browser (Chrome do Puppeteer é morto pelo
SO neste ambiente; stack logado exige backend/login). Pequenas diferenças de
subpixel (kerning/hinting do browser) podem alterar os números em ~1 px, o que
não muda a conclusão: o estado mais largo (~179 px) excede o `minWidth: 150px`,
então o fix anterior não tinha como surtir efeito.

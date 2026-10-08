# Plano de Implementação — Tarefa 36: Renderizador de HTML

Fase 8 (Geração de PDF) do ni-doc. Requisito **RF-016** (critérios 4 e 5:
aplicar o template ativo e substituir placeholders pelos dados reais).

Serviço **puro e determinístico**: recebe o template (layout) + os dados do
orçamento (snapshot) e devolve uma `string` HTML. **Sem** banco, rede ou
Puppeteer (Puppeteer é a Tarefa 38; paginação é a 37; QR Code é a 39;
integração envio→PDF é a 40 — nada disso entra aqui).

Ciclo **TDD obrigatório**: escrever os testes primeiro, vê-los falhar, depois
implementar até passar. Cobertura mínima de serviço: **80%+**.

---

## Decisões de design (fixadas a partir da investigação)

Cada decisão abaixo foi tomada lendo o código real, não assumida.

### D1 — Shape de entrada: `template (layout) + snapshot + numero + versao`

O snapshot (`OrcamentoSnapshot` em `src/services/snapshot.service.ts`) **não
contém** o número do orçamento nem o número da versão: `numero` vive em
`orcamentos.numero` (ver `OrcamentoComItens` no repositório) e `versao` vive em
`orcamento_versoes`. Como RF-016 exige o placeholder `{numero}` e o nome de
arquivo `{numero}-v{versao}.pdf`, o renderer **precisa recebê-los explicitamente**
além do snapshot. Decisão: a entrada é
`{ layout, snapshot, numero, versao }`. Reutilizamos o tipo real
`OrcamentoSnapshot` (importado de `snapshot.service.js`) como fonte dos dados —
nada de redefinir shapes.

### D2 — Tipo do template: `LayoutTemplate` (genérico), lido defensivamente

`layout_json` é `LayoutTemplate = Record<string, unknown>` (ver
`src/repositories/template.repository.ts`). O shape detalhado (placeholders,
CSS, imagens, área de itens) é definido pelo **editor visual da Tarefa 49** e
deliberadamente **não** está enrijecido (confirmado em `template.schema.ts`: só
valida que é um objeto). O seed atual (`003_seed_dev.sql`) traz apenas
`formato`, `orientacao`, `margens`, `secoes` — **sem** `css`/`imagens`.

Decisão: o renderer **reutiliza `LayoutTemplate`** como tipo de entrada e lê
campos **opcionais e bem-conhecidos** de forma defensiva (narrowing manual, por
causa de `noUncheckedIndexedAccess` + `strict`), com fallback seguro quando
ausentes:
- `layout.css` (string) → injetado em `<style>`; ausente ⇒ CSS mínimo embutido.
- `layout.imagens` (objeto `nome → dataUrl` **ou** array `{ nome, dataUrl }`)
  → embutidas como `data:` URLs no HTML (ver D4).
- `layout.formato` / `layout.orientacao` → usados em `@page` no CSS.
Campos desconhecidos são ignorados. Isso mantém o renderer compatível com o
template atual e com o shape futuro do editor, sem acoplar a um schema que ainda
não existe. **Registrar essa suposição** é o objetivo desta decisão.

### D3 — Formato de placeholder: chave única entre chaves `{...}`

Requirements (glossário e RF-016, critério 5) e o design usam **chave simples**:
`{cliente}`, `{numero}`, `{valor_total}` — **não** `{{...}}`. Decisão: o formato
real é `\{chave\}` (uma chave, sem duplicar). A substituição é feita por regex
global `/\{(\w+)\}/g`, resolvendo contra um mapa de valores. Placeholders sem
valor correspondente são substituídos por **string vazia** (não deixar `{x}`
cru no HTML — mantém o DoD "placeholders substituídos" e evita vazar sintaxe).

Mapa de placeholders suportados (derivado do snapshot + numero/versao):
- `{numero}` → `numero`
- `{versao}` → `versao`
- `{cliente}` → `snapshot.cliente.nome`
- `{cliente_documento}` → `snapshot.cliente.documento`
- `{cliente_email}` / `{cliente_telefone}` / `{cliente_endereco}`
- `{empresa}` → `snapshot.empresa_cliente?.razao_social` (vazio se null)
- `{subtotal}` / `{total}` / `{valor_total}` (alias de `{total}`) → formatados
  em BRL (ver D5)
- `{data_emissao}` → `snapshot.data_emissao` (`YYYY-MM-DD`, já pronto)
- `{validade_dias}`
- `{condicoes_pagamento}` / `{observacoes}` (vazio se null)

### D4 — Imagens em base64 (data URLs)

Testes do DoD exigem imagens embutidas como base64. O renderer **não lê disco**
(permanece puro): ele recebe as imagens **já em data URL** dentro do
`layout.imagens` (produzidas pelo editor/serviço de template no futuro) e as
embute em `<img src="data:...">`. Suporta duas formas de `layout.imagens`:
mapa `{ logo: "data:image/png;base64,..." }` ou array
`[{ nome, dataUrl }]`. Cada imagem conhecida vira um placeholder de imagem
`{img:nome}` substituído pela tag `<img>` com o data URL, e também fica
disponível uma seção de imagens no HTML quando referenciada. Se `layout.imagens`
estiver ausente, nenhuma imagem é embutida (sem erro).

### D5 — Formatação monetária determinística

Para ser **determinístico** (sem depender de locale do processo), formatar BRL
com um helper puro próprio (ex.: `R$ 6.840,00`) a partir do `number`, **sem**
`Intl.NumberFormat` com locale implícito. Centralizar num helper interno
`formatarMoeda(valor: number): string`.

### D6 — HTML válido e escaping

Os valores vindos do snapshot (nome do cliente, observações etc.) devem ser
**escapados** (`&`, `<`, `>`, `"`, `'`) antes de entrar no HTML, para produzir
HTML válido e evitar quebra de marcação. Helper interno `escaparHtml`. O CSS do
template e os data URLs de imagem **não** são escapados (são markup/estrutura).
O documento final é um HTML completo: `<!DOCTYPE html>` + `<html>` + `<head>`
(com `<meta charset="utf-8">` e `<style>`) + `<body>`.

### D7 — Lista de itens

Iterar `snapshot.itens` (array de `SnapshotItem`) em uma `<table>` de itens,
preservando a `ordem`, renderizando nome, descrição, quantidade, unidade,
valor unitário, desconto e total (todos formatados/escapados). Se houver
`responsavel`, exibir nome + registro. A tabela é gerada como um bloco e
inserida via placeholder `{itens}` **ou**, se o template não contiver `{itens}`,
anexada numa seção padrão do corpo (fallback), garantindo que os itens sempre
apareçam.

### D8 — Erros

Lançar `AppError(statusCode, message)` (ver `src/errors/app-error.ts`) para
falhas esperadas — por exemplo, snapshot sem itens quando a renderização os
exige, ou entrada ausente. Como é um serviço puro de montagem, as validações
são mínimas; preferir `AppError(422, ...)` para entrada inconsistente.

---

## Assinatura da interface + factory

Arquivo: `backend/src/services/html-renderer.service.ts`

```ts
import type { OrcamentoSnapshot } from './snapshot.service.js'
import type { LayoutTemplate } from '../repositories/template.repository.js'

export interface RenderizarHtmlInput {
  layout: LayoutTemplate   // template.layoutJson (genérico, lido defensivamente)
  snapshot: OrcamentoSnapshot
  numero: string           // ex.: 'ORC-2026-0001' (não vem no snapshot)
  versao: number           // ex.: 1 (não vem no snapshot)
}

export interface HtmlRendererService {
  renderizar(input: RenderizarHtmlInput): string
}

export function criarHtmlRendererService(): HtmlRendererService
```

A factory **não recebe dependências** (serviço puro, como `criarSnapshotService`).
Export nomeado da interface `HtmlRendererService`, da factory
`criarHtmlRendererService` e das interfaces de input (`RenderizarHtmlInput`).

---

## Casos de teste a escrever (TDD-first)

Arquivo: `backend/src/services/__tests__/html-renderer.service.test.ts`,
seguindo o estilo de `snapshot.service.test.ts` (fixtures montados no próprio
teste, serviço puro, sem mocks de repo). Usar helpers de fixture que devolvem um
`OrcamentoSnapshot` e um `LayoutTemplate` controlados.

1. **Substitui `{cliente}` e `{numero}`** pelos valores reais — o HTML contém o
   nome do cliente e o número do orçamento, e não contém mais os literais
   `{cliente}`/`{numero}`.
2. **Substitui os demais placeholders** do template (`{total}`/`{valor_total}`,
   `{data_emissao}`, `{validade_dias}`, `{empresa}`, `{condicoes_pagamento}`) —
   verifica os valores formatados/escapados no HTML.
3. **Placeholder sem valor vira string vazia** — um `{inexistente}` no CSS/corpo
   do template não aparece cru no HTML final.
4. **Itera sobre os itens** — HTML contém uma linha por item em `snapshot.itens`,
   na ordem correta (nome, quantidade, total formatado); item com `responsavel`
   mostra nome + registro; snapshot com múltiplos itens gera múltiplas linhas.
5. **Aplica o CSS do template** — quando `layout.css` existe, o HTML contém um
   `<style>` com esse CSS; quando ausente, usa o CSS mínimo de fallback (há
   `<style>` mesmo assim).
6. **Embute imagens em base64 (data URLs)** — com `layout.imagens` (nas duas
   formas: mapa e array), o HTML contém `<img src="data:image/...;base64,...">`;
   sem `layout.imagens`, nenhum `<img data:>` é emitido e não lança erro.
7. **Escaping de HTML** — um nome de cliente com `&`/`<`/`>`/aspas é escapado no
   HTML (não quebra a marcação; não aparece `<` cru vindo do dado).
8. **Formatação monetária determinística** — `total` 6840 vira `R$ 6.840,00`
   independentemente de locale (helper puro).
9. **HTML válido e completo** — a saída começa com `<!DOCTYPE html>`, tem
   `<meta charset`, um único `<head>`/`<body>`, e `@page`/formato refletindo
   `layout.formato`/`orientacao`.
10. **Determinismo** — chamar `renderizar` duas vezes com a mesma entrada
    produz exatamente a mesma string.
11. **Fallback de itens** — template sem `{itens}` ainda assim contém a tabela
    de itens anexada ao corpo (os itens nunca somem).

---

## Itens de implementação (ordenados por dependência)

- [ ] 1. Escrever o arquivo de testes `html-renderer.service.test.ts` com todos
      os casos acima (TDD: devem falhar porque o serviço ainda não existe).
      Montar fixtures locais `snapshotMock()` e `layoutMock()` reutilizando o
      tipo `OrcamentoSnapshot` real (importado de `../snapshot.service.js`) e
      `LayoutTemplate` (de `../../repositories/template.repository.js`). Lembrar
      da extensão `.js` nos imports (Node16 ESM) e do estilo Prettier (aspas
      simples, sem ponto e vírgula, 2 espaços).
      Files: `backend/src/services/__tests__/html-renderer.service.test.ts`
      Verify: `cd backend && npm test -- html-renderer` — testes **falham** por
      módulo inexistente (passo "ver falhar" do TDD).

- [ ] 2. Implementar `html-renderer.service.ts`: a interface
      `HtmlRendererService`, as interfaces de input (`RenderizarHtmlInput`), a
      factory `criarHtmlRendererService`, e os helpers internos puros
      (`escaparHtml`, `formatarMoeda`, `montarMapaPlaceholders`,
      `substituirPlaceholders`, `renderizarItens`, `coletarImagens`,
      `montarCss`, `montarDocumento`). Ler `layout` defensivamente (narrowing
      manual por causa de `noUncheckedIndexedAccess`). Usar `AppError` para
      entrada inconsistente. Nenhuma dependência de banco/rede/Puppeteer.
      Files: `backend/src/services/html-renderer.service.ts`
      Verify: `cd backend && npm test -- html-renderer` — todos os testes do
      item 1 **passam**.

- [ ] 3. Garantir cobertura e qualidade: rodar a suíte completa com cobertura e
      confirmar ≥ 80% para o novo serviço; ajustar testes/implementação se algum
      ramo ficar descoberto (ex.: formas alternativas de `layout.imagens`,
      fallbacks).
      Files: (sem novos arquivos; ajustes nos dois acima se necessário)
      Verify: `cd backend && npm run test:coverage` — suíte verde e
      `html-renderer.service.ts` com cobertura ≥ 80%.

- [ ] 4. Lint e formatação limpos no escopo da tarefa.
      Files: (os dois arquivos da tarefa)
      Verify: `cd backend && npm run lint` retorna sucesso; `npm run build`
      compila sem erros de tipo (confirma o strict/ESM).

---

## Escopo — NÃO fazer (reafirmado)

- NÃO implementar Puppeteer/PDF (Tarefa 38), paginação (37), QR Code (39) nem a
  integração envio→PDF (40).
- NÃO alterar outros serviços, rotas, `app.ts`, migrations ou a spec.
- NÃO marcar a Tarefa 36 em `tasks.md` (feito por outra etapa do fluxo).
- NÃO enrijecer o schema do template (`template.schema.ts`) — o shape do layout
  continua genérico até a Tarefa 49.

## Lacunas e suposições

- O shape de `layout.css`/`layout.imagens`/`layout.placeholders` ainda não é
  definido (Tarefa 49). Suposição registrada (D2/D4): o renderer lê campos
  opcionais bem-conhecidos com fallback seguro e tolera ausência. Quando o
  editor visual fixar o shape, o renderer poderá ser estreitado sem quebrar os
  testes atuais (que exercitam os campos opcionais explicitamente).
- `{numero}`/`{versao}` entram pela entrada do renderer (D1), pois não existem
  no snapshot; o chamador (Tarefa 40) fornecerá `orcamento.numero` e
  `versao.versao`.

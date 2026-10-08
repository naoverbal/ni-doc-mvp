# QR Code da URL pública como data URL PNG (Tarefa 39)

A mudança adiciona a lib pura `backend/src/lib/qrcode.ts` com `gerarQrCodeDataUrl(url)`, que converte uma URL pública já montada em um QR Code como data URL PNG base64 (`data:image/png;base64,...`) via `QRCode.toDataURL`. Opções exportadas (`QR_WIDTH = 256`, `QR_MARGEM = 2`, `QR_NIVEL_CORRECAO = 'M'`) tornam o tamanho mínimo escaneável verificável sem decodificar o PNG. A função recebe a URL pronta em vez de `token` + base URL — decisão fundamentada em que `token.ts` só produz o token e não há env de base URL em `config/env.ts`; a montagem da URL e a integração ao HTML/PDF ficam deliberadamente para a Tarefa 40. Três testes cobrem o DoD, escritos via TDD (vermelho antes da implementação).

Watch for: a asserção "URL contém token" do item de teste da spec é satisfeita de forma indireta (URLs distintas geram data URLs distintas) e não por extração literal do token — proxy adequado dado que não há leitor de QR disponível (confirmed). A evidência de build/test/coverage/lint vem da nota do coder no commit, não re-executada neste review (confirmed).

**Verdict**: APPROVED

## High-level view

A lib é um único caminho sem ramos: delega a `QRCode.toDataURL` com opções fixas e devolve a string. A pureza exigida pelo escopo está respeitada — sem banco, rede ou Puppeteer, apenas a dependência `qrcode` já pinada (`1.5.4`, com `@types/qrcode@1.5.5`), nenhuma dependência nova.

A assinatura URL-only é a decisão de design central e está bem justificada no cabeçalho do arquivo e no plano: evita introduzir uma env de base URL fora de escopo e espelha o padrão de transformação única da lib `pdf.ts`. A montagem de `/publico/orcamento/:token` e o embute no HTML pertencem à Tarefa 40, e o diff respeita essa fronteira — nenhum arquivo fora de `qrcode.ts` e seu teste foi tocado.

Os três testes do DoD estão presentes e são significativos: data URL PNG válida, determinismo (mesma URL → saída idêntica; URLs distintas → saídas distintas, provando que o conteúdo entra na codificação) e tamanho mínimo via `QR_WIDTH >= 200`. Como a lib não tem ramos, esses testes bastam para os 100% exigidos de `lib/`. A cobertura 100% de `qrcode.ts` foi reportada pelo coder no commit, não re-medida aqui conforme instrução.

<details>
<summary>Issues (0)</summary>

Nenhuma finding bloqueante. A nota sobre a asserção indireta do token é um esclarecimento de design, não um item acionável.

</details>

<details>
<summary>Details</summary>

## Assinatura URL-only e a fronteira com a Tarefa 40

A escolha de `gerarQrCodeDataUrl(url: string)` em vez de `(token, baseUrl)` é o ponto de design que mais merece atenção, e está correta para o escopo. O cabeçalho do arquivo documenta os três motivos: `token.ts` não conhece host nem path, não existe `APP_URL`/`BASE_URL` em `config/env.ts`, e a lib `pdf.ts` já estabelece o padrão de transformação assíncrona pura. Introduzir uma env de base URL agora seria antecipar trabalho da Tarefa 40 e sujar a pureza da lib. A consequência é que o DoD "QR embutido no HTML / URL `/publico/orcamento/:token`" é parcialmente deferido: esta tarefa entrega o gerador de data URL; o embute no HTML e a montagem da URL com token são da Tarefa 40 (`html-renderer.service.ts` consome data URLs via `{img:nome}`). O diff não cruza essa fronteira — não há toque em `token.ts`, `pdf.ts`, `html-renderer.service.ts` nem `package.json`.

## Determinismo como proxy do "URL contém token"

O item de teste da spec pede "URL contém token". Como um data URL PNG não é inspecionável sem um leitor de QR, o teste prova a propriedade de forma equivalente: a mesma URL gera saída idêntica (`a1 === a2`) e URLs distintas geram saídas distintas (`a1 !== b1`). Isso demonstra que o conteúdo da URL entra na codificação de forma determinística — a garantia funcional por trás de "contém token", sem acoplar o teste a detalhes de bytes do PNG. Não há como ser mais literal sem adicionar um decodificador de QR, o que estaria fora de escopo.

## Pureza, escopo e convenções

A lib não importa banco, cliente HTTP nem Puppeteer; a única dependência externa é `qrcode`, já pinada em `backend/package.json` (`1.5.4`) com tipos (`@types/qrcode@1.5.5`). Nenhuma dependência nova foi introduzida. As convenções do projeto estão respeitadas: default import `QRCode from 'qrcode'` (bare specifier, sem extensão), o import relativo do teste usa `../qrcode.js` conforme a resolução Node16, identificadores e comentários em português, e o estilo Prettier (aspas simples, sem ponto e vírgula, 2 espaços) é consistente no diff.

## Cobertura e verificação (evidência do coder)

A convenção do projeto exige 100% de cobertura para `lib/`. `qrcode.ts` é um único statement de retorno sem ramos nem tratamento de erro próprio, então os três testes exercitam o caminho completo — a propagação de rejeição de `QRCode.toDataURL` não é um ramo da lib e não exige teste dedicado. O commit `df4c324` registra a verificação: `tsc` sem erros, eslint limpo, 414 testes passando (incluindo os 3 novos), `src/lib/qrcode.ts` em 100% (stmts/branch/funcs/lines) e `prettier --check` ok nos dois arquivos. Conforme a instrução de review, essas suítes não foram re-executadas; a evidência está presente e é coerente com o diff, então não há finding por ausência de verificação.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/lib/qrcode.ts` — nova lib pura: constantes de opção e `gerarQrCodeDataUrl(url)` sobre `QRCode.toDataURL`.
- `backend/src/lib/__tests__/qrcode.test.ts` — três testes do DoD: data URL PNG válida, determinismo, tamanho mínimo.

Diff completo: `git diff HEAD~1`.

</details>

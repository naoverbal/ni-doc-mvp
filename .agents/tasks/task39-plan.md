# Implementation Plan — Tarefa 39: QR Code no PDF

Escopo: criar a lib pura `backend/src/lib/qrcode.ts` que transforma uma URL
pública em um QR Code como data URL (PNG base64), com testes TDD escritos antes
da implementação. SEM integração ao HTML/PDF (Tarefa 40), SEM banco, rede ou
Puppeteer. A dependência `qrcode@1.5.4` e `@types/qrcode@1.5.5` já estão
pinadas em `backend/package.json` (confirmado) — nada a instalar.

## Decisões de design

- **Assinatura:** `gerarQrCodeDataUrl(url: string): Promise<string>`. Recebe a
  URL pública JÁ montada (não token + base URL). Justificativa fundamentada no
  código lido:
  - `src/lib/token.ts` produz apenas o token (`uuid.hmac`) e não conhece host
    nem path; não há variável de base URL em `src/config/env.ts` (sem
    `APP_URL`/`BASE_URL`). Montar a URL dentro da lib exigiria introduzir uma
    env agora, fora do escopo da Tarefa 39.
  - `pdf.ts` estabelece o padrão de lib pura como uma única transformação
    assíncrona (`html -> Buffer`); espelhamos isso (`url -> data URL`).
  - O `html-renderer.service.ts` embute imagens como data URL via placeholders
    `{img:nome}`. Um data URL de QR encaixa nesse mecanismo na Tarefa 40, onde o
    chamador (serviço de versionamento/envio) monta a URL
    `/publico/orcamento/:token` e passa a esta função. Manter a lib URL-only a
    deixa pura e sem dependência de env.
- **API da dependência:** `QRCode.toDataURL(text, options)` retorna
  `Promise<string>` no formato `data:image/png;base64,...` (PNG é o default).
  Fonte: [qrcode (npm)](https://www.npmjs.com/package/qrcode). Conteúdo
  reescrito para conformidade de licença.
- **Opções de geração (tamanho mínimo escaneável, RF-018):** usar `width: 256`
  (>= 200px do DoD), `margin: 2` (quiet zone recomendada) e
  `errorCorrectionLevel: 'M'`. Exportar essas constantes para permitir
  verificação determinística no teste sem inspecionar o PNG.
- **Import ESM:** `import QRCode from 'qrcode'` (default import). Imports
  relativos permanecem com extensão `.js`; `qrcode` é bare specifier, sem
  extensão.
- **Estilo:** aspas simples, sem ponto e vírgula, 2 espaços, print width 100,
  identificadores/comentários em português.

## Itens

- [ ] 1. Escrever os testes PRIMEIRO em `backend/src/lib/__tests__/qrcode.test.ts` (TDD — devem falhar antes da implementação).
      Importar `gerarQrCodeDataUrl` (e as constantes de opção exportadas, p.ex.
      `QR_WIDTH`/`QR_OPCOES`) de `../qrcode.js`. Cobrir os três casos do DoD:
      (1) retorna uma data URL válida — `await gerarQrCodeDataUrl('https://ex.com/publico/orcamento/uuid.hmac')`
      é string que começa com `data:image/png;base64,`;
      (2) determinismo/refletir a URL — URLs diferentes produzem data URLs
      diferentes, e a MESMA URL produz resultado idêntico em duas chamadas
      (prova de que o conteúdo entra na codificação, sem leitor de QR);
      (3) tamanho mínimo escaneável — assertar que a constante de largura
      exportada é `>= 200` (ex.: `expect(QR_WIDTH).toBeGreaterThanOrEqual(200)`)
      e, opcionalmente, que uma URL mais longa (gera QR maior) ainda retorna
      data URL válida. Seguir o estilo de `__tests__/token.test.ts`
      (describe/it, Vitest globals já habilitados). Nenhuma env é necessária
      para esta lib.
      Files: backend/src/lib/__tests__/qrcode.test.ts
      Verify: `cd backend && npm test -- src/lib/__tests__/qrcode.test.ts` — a suíte FALHA
      com erro de import/módulo inexistente (confirma que os testes exercitam código ainda não escrito).

- [ ] 2. Implementar `backend/src/lib/qrcode.ts` para fazer os testes do item 1 passarem.
      Default import `QRCode from 'qrcode'`. Exportar constantes de opção
      (`QR_WIDTH = 256`, `QR_MARGEM = 2`, nível `'M'`) e a função async
      `gerarQrCodeDataUrl(url: string): Promise<string>` que chama
      `QRCode.toDataURL(url, { width: QR_WIDTH, margin: QR_MARGEM, errorCorrectionLevel: 'M' })`
      e retorna o resultado. Incluir comentário de cabeçalho em português
      documentando a decisão de assinatura (URL já montada; montagem fica na
      Tarefa 40) e o motivo das opções de tamanho (escaneabilidade RF-018).
      Files: backend/src/lib/qrcode.ts
      Verify: `cd backend && npm test -- src/lib/__tests__/qrcode.test.ts` — todos os testes passam.

- [ ] 3. Garantir cobertura 100% da lib, lint e build limpos.
      `lib/` exige 100% de cobertura por convenção (vitest.config.ts). A lib é
      um único caminho sem ramos, então os testes do item 1 já devem cobrir
      100%; confirmar no relatório por arquivo.
      Files: (nenhum — verificação; ajustar item 1/2 se faltar cobertura ou lint falhar)
      Verify:
      `cd backend && npm run test:coverage` — relatório mostra `src/lib/qrcode.ts` em 100% (lines/branches/functions/statements);
      `cd backend && npm run lint` — sem erros;
      `cd backend && npm run build` — `tsc` compila sem erros.

- [ ] 4. Fechar a tarefa na spec.
      Mudar o item 39 de `[~]` para `[x]` em `.kiro/specs/ni-doc-mvp/tasks.md`
      somente após itens 1–3 verdes. Não alterar o estado de outras tarefas.
      Files: .kiro/specs/ni-doc-mvp/tasks.md
      Verify: inspeção — a linha `- [x] 39. QR Code no PDF`; demais itens inalterados.

## Notas e suposições

- Caso `npm test`/`npm run lint`/`npm run build` falhem por `node_modules`
  ausente (observado durante a exploração: `backend/node_modules` não existe no
  momento), rodar `npm install` na raiz do monorepo antes das verificações.
  Não adicionar nem alterar dependências — `qrcode` e `@types/qrcode` já estão
  pinadas.
- Não tocar em `html-renderer.service.ts`, `pdf.ts`, `token.ts` nem em
  `package.json`/lockfile. O único código novo é a lib e seu teste; o item 4
  edita apenas a linha da Tarefa 39 em `tasks.md`.

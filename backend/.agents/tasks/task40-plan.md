# Plano de Implementação — Tarefa 40: Integração envio → PDF (RF-016)

## Contexto e assinaturas reais observadas

Fluxo de envio hoje (`versionamento.service.ts#enviar`):
`buscarPorId` → valida rascunho/itens → carrega cliente/empresa/responsáveis →
`snapshotService.montar(...)` → `orcamentoVersaoRepo.criarVersaoEnviar({ tenantId, orcamentoId, snapshot, expiraEm })`
→ `auditoriaService.registrar(...)` → retorna `VersaoEnviada`.

Assinaturas confirmadas no código (NÃO inventar — usar estas):

- `VersionamentoService.enviar(ctx: VersionamentoContexto, orcamentoId: string): Promise<VersaoEnviada>`.
  `VersaoEnviada` já tem `pdfPath: string | null` e `pdfHash: string | null`.
- `criarVersionamentoService(deps: VersionamentoServiceDeps)` — DI por objeto. Deps atuais:
  `orcamentoRepo, orcamentoVersaoRepo, clienteRepo, empresaRepo, responsavelRepo, snapshotService, auditoriaService`.
- Repositório: `OrcamentoVersaoRepository.criarVersaoEnviar(input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica>`.
  Hoje `criarVersaoEnviar` abre a própria transação Kysely (`db.transaction().execute(async (trx) => {...})`),
  calcula `versao` (advisory lock + MAX+1), resolve `templateId` (`tenants_template_ativo`), invalida aceite anterior,
  gera `versaoId = randomUUID()` + `tokenPublico = gerarTokenPublico(versaoId)`, faz o INSERT em `orcamento_versoes`
  com `pdf_path: null, pdf_hash: null`, atualiza `orcamentos` para `status='enviado'` e commita. `OrcamentoVersaoPublica`
  expõe `id, orcamentoId, versao, tokenPublico, templateId, pdfPath, pdfHash, enviadoEm, expiraEm`.
- PDF: `PdfService.gerarPdf(input: GerarPdfInput): Promise<GerarPdfResultado>` onde
  `GerarPdfInput = { html: string; numero: string; versao: number }` e
  `GerarPdfResultado = { buffer: Buffer; caminho: string; hash: string }`.
  `gerarPdf` é IMUTÁVEL: se o arquivo (`{numero}-v{versao}.pdf`) já existe, lê e reusa os bytes, não regenera.
  Factory: `criarPdfService(deps: PdfServiceDeps)` com `{ pdfsDir: string; renderizarPdf?; fs?; hash? }`.
- HTML: `HtmlRendererService.renderizar(input: RenderizarHtmlInput): string` (SÍNCRONO) onde
  `RenderizarHtmlInput = { layout: LayoutTemplate; snapshot: OrcamentoSnapshot; numero: string; versao: number }`.
  Embute `{img:nome}` do `layout.imagens`. Lança `AppError(422)` se snapshot sem itens.
  Factory: `criarHtmlRendererService()` (sem deps).
- QR: `gerarQrCodeDataUrl(url: string): Promise<string>` — recebe a URL pública JÁ montada, devolve data URL PNG.
- Template: `TemplateRepository.buscarAtivo(tenantId: string): Promise<TemplatePublico | null>`.
  `TemplatePublico.layoutJson: LayoutTemplate`. Factory `criarTemplateRepository({ db })`. Já instanciado em `app.ts`.
- `env.PDFS_DIR` existe (default `/var/ni-doc/pdfs`).

### Decisão de arquitetura — atomicidade/rollback (justificativa)

O critério exige que, se a geração do PDF falhar, TODO o envio reverta (nenhuma versão nem `status='enviado'`
persiste), reusando a transação já aplicada. Hoje a transação vive inteiramente dentro de `criarVersaoEnviar`
e é commitada ANTES de qualquer PDF. Para gerar o PDF dentro da MESMA transação sem vazar SQL para o serviço
(regra de camadas: SQL só no repositório), o repositório passa a aceitar um **callback** opcional
`gerarPdfDaVersao` em `CriarVersaoEnviarInput`. O repositório, já dentro da `trx` e após ter `versao`,
`templateId` e `tokenPublico`, invoca o callback (orquestrado pelo serviço) que renderiza HTML + QR e chama
`pdfService.gerarPdf`, retornando `{ pdfPath, pdfHash }`. O repositório grava esses valores no mesmo INSERT
e commita. Se o callback lançar, a `trx` do Kysely faz rollback de tudo (versão + status). Isso mantém SQL no
repositório e a orquestração de PDF no serviço (Design §: "Services: orquestração de transações").

Alternativa descartada: gerar o PDF depois do commit e dar `UPDATE` — não atende rollback (a versão já teria
sido persistida). Alternativa descartada: mover todo o SQL para o serviço — viola a regra de camadas.

### Decisão — QR Code / URL pública (escopo)

`gerarQrCodeDataUrl` exige a URL pública montada, mas não há env de base URL (`APP_URL`) em `config/env.ts`
(confirmado em `qrcode.ts`). Para não introduzir env fora do escopo, o serviço monta a URL **relativa**
`/publico/orcamento/<tokenPublico>` e passa ao QR; o data URL entra no `layout.imagens` sob o nome `qrcode`
(o renderer já resolve `{img:qrcode}`). Observação registrada no comentário do serviço: a base URL absoluta é
item de uma tarefa futura; aqui garantimos QR embutido e PDF gerado/persistido conforme RF-016/RF-018.

### Como o `pdfService` é injetado

No estilo DI existente: adicionar `pdfService`, `htmlRenderer` e `templateRepo` a `VersionamentoServiceDeps`
e compor em `app.ts`. `pdfService` é criado via `criarPdfService({ pdfsDir: env.PDFS_DIR })` (sem mocks em prod).
`htmlRenderer = criarHtmlRendererService()`. `templateRepo` já existe em `app.ts` (`criarTemplateRepository({ db })`).

---

## Passos (TDD: ajustar teste → ver falhar → implementar → ver passar → refatorar)

- [ ] 1. Estender o contrato do repositório para suportar PDF dentro da transação.
      Adicionar em `CriarVersaoEnviarInput` o campo opcional
      `gerarPdfDaVersao?: (dados: { versao: number; numero: string; tokenPublico: string; templateId: string }) => Promise<{ pdfPath: string; pdfHash: string }>`.
      Em `criarVersaoEnviar`, após obter `versao`/`templateId`/`versaoId`/`tokenPublico` e ANTES do INSERT, se o
      callback existir, invocá-lo (dentro da `trx`) e usar o retorno em `pdf_path`/`pdf_hash` no `.values(...)`
      (quando ausente, manter `null` como hoje — retrocompatível). Exceção do callback propaga e a `trx` reverte.
      O serviço não terá o `numero` dentro do repo? Sim tem: passar `numero` como novo campo de `CriarVersaoEnviarInput`
      (vindo de `orcamento.numero`), já que o nome do arquivo PDF depende dele.
      Files: `backend/src/repositories/orcamento-versao.repository.ts`
      Verify: `npm run build -w backend` compila sem erros de tipo (a interface muda; consumidores ainda compilam).

- [ ] 2. Ajustar o teste do serviço (TDD — escrever antes da implementação) para os 3 casos exigidos + DI.
      Atualizar `makeDeps` para injetar mocks de `pdfService` (`gerarPdf: vi.fn().mockResolvedValue({ buffer, caminho: '/pdfs/ORC-2026-0001-v1.pdf', hash: 'abc123' })`),
      `htmlRenderer` (`renderizar: vi.fn().mockReturnValue('<html/>')`) e `templateRepo` (`buscarAtivo: vi.fn().mockResolvedValue({ id, tenantId, versao, layoutJson: {}, criadoEm })`).
      Ajustar o mock de `orcamentoVersaoRepo.criarVersaoEnviar` para INVOCAR o callback `gerarPdfDaVersao` recebido
      (simulando o comportamento transacional real) e devolver `versaoPublicaMock` com `pdfPath`/`pdfHash` preenchidos
      a partir do retorno do callback — assim os testes observam o resultado do callback.
      Casos novos:
      (a) "envio gera PDF e persiste pdf_path+pdf_hash na versão": espera `pdfService.gerarPdf` chamado com
          `{ html, numero: 'ORC-2026-0001', versao: 1 }`; `htmlRenderer.renderizar` chamado com `layout`/`snapshot`/`numero`/`versao`;
          `criarVersaoEnviar` recebe `gerarPdfDaVersao` (função) e `numero`; a `VersaoEnviada` retornada tem `pdfPath`/`pdfHash` não-nulos.
      (b) "PDF imutável (não regenerado em acessos posteriores)": asserção de que o serviço só chama `gerarPdf`
          (que é o ponto de imutabilidade — reusa bytes se já existir) e NUNCA um caminho de regeneração; validar
          que uma segunda chamada ao fluxo (ou o contrato do mock) não força novo render além do `gerarPdf` idempotente.
          Observação: a imutabilidade real é garantida por `pdf.service` (teste próprio já cobre); aqui garantir que o
          serviço delega a `gerarPdf` e não implementa regeneração própria.
      (c) "rollback quando a geração de PDF falha": configurar `pdfService.gerarPdf` para `mockRejectedValue(new AppError(500,'falha pdf'))`
          e `criarVersaoEnviar` para propagar a exceção do callback (como a `trx` real faria); esperar que `enviar` rejeite,
          que `auditoriaService.registrar` NÃO seja chamado e que nenhum estado parcial seja retornado.
      Files: `backend/src/services/__tests__/versionamento.service.test.ts`
      Verify: `npm run test -w backend -- versionamento.service` — os novos testes FALHAM (implementação ainda não existe).

- [ ] 3. Implementar a integração no serviço de versionamento.
      Adicionar `pdfService: PdfService`, `htmlRenderer: HtmlRendererService`, `templateRepo: TemplateRepository`
      a `VersionamentoServiceDeps`. No `enviar`, após montar o `snapshot`:
      carregar `template = await templateRepo.buscarAtivo(ctx.tenantId)` (se null → `AppError(409,'Tenant não possui template ativo')`,
      coerente com o repo). Chamar `criarVersaoEnviar` passando também `numero: orcamento.numero` e o callback
      `gerarPdfDaVersao: async ({ versao, numero, tokenPublico }) => { const urlPublica = `/publico/orcamento/${tokenPublico}`;
      const qrDataUrl = await gerarQrCodeDataUrl(urlPublica); const layoutComQr = { ...template.layoutJson, imagens: { ...(imagens existentes), qrcode: qrDataUrl } };
      const html = htmlRenderer.renderizar({ layout: layoutComQr, snapshot, numero, versao }); const pdf = await pdfService.gerarPdf({ html, numero, versao });
      return { pdfPath: pdf.caminho, pdfHash: pdf.hash } }`. Manter `auditoriaService.registrar` após a persistência
      (só executa se a transação com PDF teve sucesso). Retornar `VersaoEnviada` com `pdfPath`/`pdfHash` vindos de `versao`.
      Imports ESM com extensão `.js`: `./pdf.service.js`, `./html-renderer.service.js`, `../lib/qrcode.js`, `../repositories/template.repository.js`.
      Comentários/identificadores em pt-BR; manter nomes existentes (`enviar`, `orcamento`, `versao`).
      Files: `backend/src/services/versionamento.service.ts`
      Verify: `npm run test -w backend -- versionamento.service` — os 3 casos novos e os existentes PASSAM.

- [ ] 4. Compor as novas dependências em `app.ts` (DI real de produção).
      Criar `const htmlRenderer = criarHtmlRendererService()` e `const pdfService = criarPdfService({ pdfsDir: env.PDFS_DIR })`.
      Passar `pdfService`, `htmlRenderer` e o já existente `templateRepo` ao `criarVersionamentoService({ ... })`.
      Garantir que `templateRepo` seja criado antes do bloco de versionamento (hoje é criado depois, na seção de templates —
      mover a criação de `templateRepo` para antes de `criarVersionamentoService`, ou reutilizar a mesma instância).
      Imports ESM com `.js`: `./services/html-renderer.service.js`, `./services/pdf.service.js`.
      Files: `backend/src/app.ts`
      Verify: `npm run build -w backend` compila; `npm run test -w backend -- orcamentos.routes` (testes de rota de envio) continuam passando.

- [ ] 5. Verificação final e cobertura.
      Rodar lint, build e a suíte completa do backend; conferir cobertura ≥ 80% nos serviços alterados.
      Files: (nenhum — apenas verificação)
      Verify: `npm run lint -w backend && npm run build -w backend && npm run test:coverage -w backend` — tudo verde,
      sem regressões; `versionamento.service.ts` com cobertura ≥ 80%.

---

## Casos de teste exigidos (resumo de rastreabilidade)

- (a) Envio gera PDF e persiste `pdf_path` + `pdf_hash` na versão → Passo 2(a) + Passo 3.
- (b) PDF imutável, não regenerado em acessos posteriores → Passo 2(b); delega a `pdf.service.gerarPdf` (já testado em `pdf.service.test.ts`).
- (c) Rollback quando a geração de PDF falha (nenhum estado parcial persiste) → Passo 2(c) + callback dentro da `trx` no Passo 1/3.

## Notas e suposições

- Testes unitários do serviço usam mocks/stubs de `pdfService`/`htmlRenderer`/`templateRepo`; NÃO dependem de
  Puppeteer/Chromium reais. A atomicidade real da `trx` é validada no repositório (teste de integração existente/futuro),
  não no teste unitário do serviço — por isso o mock de `criarVersaoEnviar` simula a invocação do callback e a propagação
  de erro para exercitar o contrato de rollback do ponto de vista do serviço.
- URL pública relativa (`/publico/orcamento/:token`) para o QR; a base URL absoluta fica para tarefa futura (fora do escopo 40).
- Nenhuma outra tarefa é adiantada; alterações restritas a `versionamento.service.ts`, `orcamento-versao.repository.ts`,
  `app.ts` e ao teste `versionamento.service.test.ts`.
```
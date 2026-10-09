# Integração envio → PDF: geração e persistência dentro da transação de envio (Tarefa 40)

O envio de um orçamento passa a gerar o PDF da versão e persistir `pdf_path`/`pdf_hash`
no mesmo INSERT da versão, dentro da transação Kysely que o repositório já abria. A
orquestração (carregar template ativo, embutir QR Code, renderizar HTML, chamar o
`pdfService`) vive no `versionamento.service`, que injeta a geração no repositório por um
callback opcional `gerarPdfDaVersao`. Assim o SQL permanece no repositório e a lógica de
negócio no serviço, sem vazamento de camadas. Se o PDF falhar, o callback lança, a
transação do Kysely reverte tudo (versão + `status='enviado'`) e nenhum estado parcial
persiste. A imutabilidade é delegada ao `pdfService.gerarPdf`, que reusa os bytes se o
arquivo já existir — o serviço não implementa regeneração própria.

Watch for: nada bloqueante nesta iteração. A evidência de verificação, único finding
bloqueante do passe anterior, agora está presente e consistente (`confirmed`). Dois
tradeoffs de MVP permanecem documentados e explicitamente aceitos (template lido por duas
fontes; rollback coberto por mocks, não por integração contra Postgres) — ambos
`non-blocking`.

**Verdict**: APPROVED

## High-level view

A atomicidade do rollback foi resolvida mantendo a geração do PDF *dentro* da transação do
repositório, em vez de gerar o PDF após o commit e dar `UPDATE`. O repositório expõe um
callback opcional `gerarPdfDaVersao`, invocado depois de resolver `versao`/`templateId`/
`tokenPublico` e antes do INSERT; o retorno popula `pdf_path`/`pdf_hash` no mesmo `.values()`.
Uma exceção no callback propaga e o Kysely reverte versão e status juntos. O contrato é
retrocompatível: sem callback, o comportamento anterior (pdf nulo) é preservado.

A injeção de dependência segue o padrão `criar*` do projeto: `pdfService`, `htmlRenderer` e
`templateRepo` entram em `VersionamentoServiceDeps` e são compostos em `app.ts`. Nenhum
serviço é instanciado dentro do serviço. O `templateRepo` foi movido para antes do bloco de
versionamento em `app.ts` e passou a ser compartilhado com o bloco de templates (uma única
instância).

O QR Code usa uma URL pública relativa (`/publico/orcamento/<token>`) porque não há env de
base URL no escopo; o data URL entra em `layout.imagens.qrcode` sem descartar imagens
pré-existentes do layout, e o renderer resolve `{img:qrcode}`. A base URL absoluta fica para
tarefa futura, documentado no código.

O `templateId` é resolvido por duas leituras independentes (o serviço lê o layout via
`buscarAtivo`; o repositório relê `template_id` de `tenants_template_ativo` dentro da trx).
No MVP, com um único template ativo por tenant, as duas convergem; a janela de divergência é
aceita e documentada. O rollback é verificado por asserções de mock nos dois níveis, não por
um teste de integração contra Postgres real — aceite explícito, coerente com a estratégia de
testes unitários de serviço do projeto.

<details>
<summary>Issues (2)</summary>

1. **templateId por duas fontes (non-blocking)** — Serviço e repositório leem o template
   ativo independentemente; poderiam divergir se o template mudasse entre as leituras.
   Aceito como tradeoff de MVP (um template ativo por tenant) e documentado no código.
2. **Rollback sem cobertura de integração (non-blocking)** — A reversão da trx em falha de
   PDF é verificada só por mocks nos dois níveis; não há teste contra Postgres real. Aceite
   explícito, consistente com a estratégia de testes do projeto.

</details>

<details>
<summary>Details</summary>

### Atomicidade do rollback via callback dentro da trx

A transação vivia inteiramente dentro de `criarVersaoEnviar` e commitava antes de qualquer
PDF. Mover o SQL para o serviço violaria a regra de camadas; gerar o PDF após o commit não
atenderia o rollback. O callback opcional resolve os dois: o repositório, já dentro da `trx`
e após resolver `versao`, `templateId` e `tokenPublico`, invoca `input.gerarPdfDaVersao(...)`
e usa o retorno em `pdf_path`/`pdf_hash` no mesmo INSERT.

```ts
let pdfPath: string | null = null
let pdfHash: string | null = null
if (input.gerarPdfDaVersao) {
  const pdf = await input.gerarPdfDaVersao({ versao, numero: input.numero, tokenPublico, templateId })
  pdfPath = pdf.pdfPath
  pdfHash = pdf.pdfHash
}
```

Como o callback roda dentro do `db.transaction().execute(...)`, uma rejeição propaga e o
Kysely reverte o INSERT da versão e o `UPDATE` do status juntos — nenhum estado parcial. O
teste do repositório `propaga erro do gerarPdfDaVersao e não executa o insert da versão
(rollback)` prende exatamente esse contrato: ao rejeitar o callback, `insertVersao.values` e
`updateOrcamento.set` não são chamados. O contrato é retrocompatível: ausente o callback,
`pdf_path`/`pdf_hash` permanecem nulos, e o teste renomeado `insere pdf_path e pdf_hash
nulos quando não há callback de geração de PDF` cobre esse caminho.

### Imutabilidade delegada ao pdfService

O serviço não contém lógica de regeneração: ele chama `pdfService.gerarPdf({ html, numero,
versao })` uma única vez por envio. A imutabilidade (reuso de bytes quando `{numero}-v{versao}.pdf`
já existe) está inteiramente no `pdf.service.gerarPdf`, que já tem cobertura própria. O teste
`é imutável: delega a geração ao pdfService.gerarPdf sem regenerar por conta própria` fixa o
limite correto — valida que o serviço delega e não duplica a responsabilidade — em vez de
reimplementar a asserção de imutabilidade do `pdf.service`.

### DI e composição em app.ts

`pdfService`, `htmlRenderer` e `templateRepo` entram em `VersionamentoServiceDeps` e são
desestruturados no factory, sem `new`/instanciação interna. Em `app.ts`, `templateRepo` foi
movido para antes do bloco de versionamento e reaproveitado pelo bloco de templates; a linha
antiga `const templateRepo = criarTemplateRepository({ db })` da seção de templates foi
removida, então não há sombra de variável nem segunda instância. `pdfService` recebe
`env.PDFS_DIR`.

### QR Code e URL pública relativa

A montagem do QR respeita o shape genérico do layout. O código lê `template.layoutJson['imagens']`
defensivamente (checa `object` e não-`null`) antes de espalhar, e adiciona `qrcode` sem
descartar imagens pré-existentes:

```ts
const layoutComQr: LayoutTemplate = {
  ...template.layoutJson,
  imagens: { ...imagensExistentes, qrcode: qrCodeDataUrl },
}
```

O teste `embute o QR Code da URL pública no layout antes de renderizar o HTML` verifica tanto
que `imagens.qrcode` é um data URL PNG quanto que `imagens.logo` pré-existente sobrevive. A URL
relativa `/publico/orcamento/<token>` é um escopo deliberado — não há env de base URL — e está
documentada no comentário do callback como item de tarefa futura. Coerente com a assinatura
URL-only de `gerarQrCodeDataUrl`.

### Ponto de template ativo ausente

Antes de persistir, o serviço carrega `templateRepo.buscarAtivo(ctx.tenantId)` e lança
`AppError(409, 'Tenant não possui template ativo')` se nulo, coerente com a coluna
`template_id` NOT NULL e com o repositório. O teste `lança AppError(409) quando o tenant não
possui template ativo` confirma, e verifica que `pdfService.gerarPdf` não é chamado nesse
caminho — falha cedo, sem efeito colateral de disco.

### Cobertura de testes

Os cinco casos exigidos pelo plano estão cobertos no nível de serviço (gera e persiste
pdf_path/pdf_hash; embute QR; imutabilidade por delegação; rollback com não-registro de
auditoria; 409 sem template) e no nível de repositório (callback invocado com os dados da trx
e persistido no insert; propagação de erro sem insert/update). O mock de `criarVersaoEnviar`
no teste de serviço invoca de fato o callback recebido e reflete o retorno na versão, de modo
que o serviço observa o resultado real do contrato — não um valor fixo.

Não testado contra Postgres real: a semântica transacional de rollback de ponta a ponta. A
reversão é verificada por asserções de mock nos dois níveis. Aceite explícito e consistente
com a estratégia do projeto (serviços testados com mocks; semântica transacional real fica
para teste de integração/repositório). `non-blocking`.

### Verificação (evidência do coder, não reexecutada)

O finding bloqueante do passe anterior era a ausência de evidência. Agora `task40-verificacao.md`
registra os três comandos a partir de `backend/`: `npm run build` (tsc, exit 0, sem erros),
`npm run lint` (eslint src, exit 0, sem erros/warnings) e `npm run test:coverage` (exit 0, 38
arquivos / 421 testes passando). A cobertura dos arquivos alterados está acima do mínimo de
80%: `versionamento.service.ts` 99.04% e `orcamento-versao.repository.ts` 96.12%. A evidência
é internamente consistente (os testes descritos no diff correspondem aos casos relatados) e
suficiente para confirmar o DoD. `confirmed`.

Spot-check estreito realizado (sem rodar suítes): `OrcamentoDetalhe.numero: string` existe no
`orcamento.repository`, `LayoutTemplate = Record<string, unknown>` e `TemplatePublico.layoutJson`
é tipado — as três referências load-bearing do diff conferem. As assinaturas de `PdfService`,
`HtmlRendererService` e `gerarQrCodeDataUrl` batem com o uso no serviço.

### Conformidade de estilo e convenções

ESM/Node16 com extensão `.js` nos imports relativos novos (`./pdf.service.js`,
`./html-renderer.service.js`, `../lib/qrcode.js`, `../repositories/template.repository.js`).
Identificadores e comentários em pt-BR. `AppError` para falhas esperadas (404/409/400).
Multi-tenancy respeitado — `buscarAtivo(ctx.tenantId)` e todas as leituras passam o tenant.
Formatação (aspas simples, sem ponto e vírgula, 2 espaços, trailing commas, print width 100)
confirmada pelo lint limpo relatado.

</details>

<details>
<summary>Arquivos alterados</summary>

- `backend/src/app.ts` — compõe `htmlRenderer`/`pdfService`, injeta em `criarVersionamentoService`, move `templateRepo` para antes e compartilha a instância.
- `backend/src/repositories/orcamento-versao.repository.ts` — adiciona `numero` e o callback opcional `gerarPdfDaVersao` ao input; invoca o callback na trx e grava `pdf_path`/`pdf_hash` no insert.
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` — renomeia o caso nulo; adiciona casos de invocação do callback e de rollback (sem insert/update).
- `backend/src/services/versionamento.service.ts` — carrega template ativo, orquestra QR + HTML + PDF no callback dentro da trx, retorna versão com pdf_path/pdf_hash.
- `backend/src/services/__tests__/versionamento.service.test.ts` — injeta mocks de pdfService/htmlRenderer/templateRepo; adiciona casos de PDF, QR, imutabilidade, rollback e 409.

Diff completo: `git diff -- backend/src` (working tree, sobre `main`).

</details>

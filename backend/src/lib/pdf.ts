import puppeteer from 'puppeteer'

// -----------------------------------------------------------------------------
// Wrapper de baixo nível do Puppeteer (RF-016). Encapsula o ciclo de vida do
// browser (launch → newPage → setContent → pdf → close) e converte uma string
// HTML já montada (pelo `html-renderer.service.ts`) em um PDF A4.
//
// Decisões:
//  - Formato A4 + `printBackground` reforçados aqui no `page.pdf` (o
//    `@page { size: A4 }` já é emitido pelo renderer; reforçamos no Puppeteer).
//  - O browser é SEMPRE fechado no `finally`, inclusive quando a renderização
//    falha, para não vazar processos do Chromium. Erros do Puppeteer sobem
//    limpos (sem serem engolidos).
//  - `page.pdf` devolve `Uint8Array` nas versões recentes; convertemos com
//    `Buffer.from` para honrar o contrato `Promise<Buffer>`.
//  - A meta de performance < 2s (RF-016.2) é delegada ao Puppeteer com Chromium
//    real e validada em integração/manual (Tarefa 40), não em teste unitário
//    (onde o Puppeteer é mockado).
// -----------------------------------------------------------------------------

// Isolamento (auditoria B-5): o HTML do template é conteúdo do admin do tenant e
// é marcação bruta (`corpo`/`css`). Para que ele não vire SSRF (requisições a
// rede interna/metadados da VPS) nem leitura de arquivos locais (`file://`), a
// página roda SEM JavaScript e com interceptação de requisições: só `data:` (imagens
// embutidas) e `about:` (documento em branco) passam; todo o resto é abortado.
const PROTOCOLOS_PERMITIDOS = ['data:', 'about:']

export function requisicaoPermitida(url: string): boolean {
  return PROTOCOLOS_PERMITIDOS.some((protocolo) => url.startsWith(protocolo))
}

// Margens padrão do documento A4 (consistentes com o layout do template).
const MARGENS_A4 = { top: '1cm', right: '1cm', bottom: '1cm', left: '1cm' }

export async function renderizarPdf(html: string): Promise<Buffer> {
  const browser = await puppeteer.launch()
  try {
    const page = await browser.newPage()
    await page.setJavaScriptEnabled(false)
    await page.setRequestInterception(true)
    page.on('request', (requisicao) => {
      if (requisicaoPermitida(requisicao.url())) {
        void requisicao.continue()
      } else {
        void requisicao.abort('blockedbyclient')
      }
    })
    await page.setContent(html, { waitUntil: 'load' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: MARGENS_A4,
    })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

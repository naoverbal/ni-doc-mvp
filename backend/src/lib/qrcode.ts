import QRCode from 'qrcode'

// -----------------------------------------------------------------------------
// Geração de QR Code para a URL pública do orçamento (RF-018/RF-019).
//
// Decisão de assinatura: `gerarQrCodeDataUrl(url)` recebe a URL pública JÁ
// montada (não `token` + base URL). Justificativa:
//  - `token.ts` produz apenas o token (`uuid.hmac`); não conhece host nem path,
//    e não há env de base URL (`APP_URL`/`BASE_URL`) em `config/env.ts`. Montar
//    a URL aqui exigiria introduzir uma env fora do escopo desta tarefa.
//  - Espelha o padrão da lib pura `pdf.ts` (uma única transformação async).
//  - Na Tarefa 40, o chamador monta a URL `/publico/orcamento/:token` e passa a
//    esta função; o data URL resultante encaixa no mecanismo de imagens
//    embutidas (`{img:nome}`) do `html-renderer.service.ts`. Manter a lib
//    URL-only a deixa pura, sem banco, rede nem dependência de env.
// -----------------------------------------------------------------------------

// Opções de geração. `width` >= 200px garante um QR escaneável (RF-018);
// `margin` reserva a quiet zone recomendada e o nível 'M' equilibra correção de
// erro e densidade. O PNG é o formato padrão do `toDataURL`, produzindo um
// data URL `data:image/png;base64,...`.
export const QR_WIDTH = 256
export const QR_MARGEM = 2
export const QR_NIVEL_CORRECAO = 'M' as const

export async function gerarQrCodeDataUrl(url: string): Promise<string> {
  return QRCode.toDataURL(url, {
    width: QR_WIDTH,
    margin: QR_MARGEM,
    errorCorrectionLevel: QR_NIVEL_CORRECAO,
  })
}

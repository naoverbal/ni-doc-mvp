import { z } from 'zod'
import { ehDataUrlImagemValido } from '../lib/data-url-imagem.js'

// Validação de forma (shape). O layout trafega como JSON genérico
// (LayoutTemplate = Record<string, unknown>); o shape detalhado é definido pelo
// editor visual (tarefa 49) e não deve ser enrijecido aqui. Exigimos que
// `layoutJson` seja um objeto (não-array) e, como defesa em profundidade contra
// injeção de atributos no HTML do PDF (auditoria B-5), que toda imagem em
// `layoutJson.imagens` seja um data URL de imagem base64 válido. O renderer
// revalida na hora de gerar o PDF (templates antigos já gravados).
function dataUrlsDasImagens(imagens: unknown): unknown[] {
  if (Array.isArray(imagens)) {
    return imagens.map((entrada) =>
      entrada !== null && typeof entrada === 'object'
        ? (entrada as Record<string, unknown>)['dataUrl']
        : undefined,
    )
  }
  if (imagens !== null && typeof imagens === 'object') {
    return Object.values(imagens as Record<string, unknown>)
  }
  return []
}

export const atualizarTemplateSchema = z.object({
  layoutJson: z.record(z.unknown()).superRefine((layout, ctx) => {
    const invalidas = dataUrlsDasImagens(layout['imagens']).some(
      (valor) => typeof valor !== 'string' || !ehDataUrlImagemValido(valor),
    )
    if (invalidas) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['imagens'],
        message: 'Imagens do template devem ser data URLs base64 de PNG, JPEG, GIF, WebP ou SVG',
      })
    }
  }),
})

export type AtualizarTemplatePayload = z.infer<typeof atualizarTemplateSchema>

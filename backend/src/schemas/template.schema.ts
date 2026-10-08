import { z } from 'zod'

// Validação apenas de forma (shape). O layout trafega como JSON genérico
// (LayoutTemplate = Record<string, unknown>); o shape detalhado é definido pelo
// editor visual (tarefa 49) e não deve ser enrijecido aqui. Exigimos apenas que
// `layoutJson` seja um objeto (não-array) presente no body.
export const atualizarTemplateSchema = z.object({
  layoutJson: z.record(z.unknown()),
})

export type AtualizarTemplatePayload = z.infer<typeof atualizarTemplateSchema>

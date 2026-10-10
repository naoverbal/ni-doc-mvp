import type { OrcamentoStatus } from '@/types/api'

// Fonte única dos rótulos textuais de status (pt-BR). O status NUNCA é
// transmitido só por cor (WCAG AA — informação perceptível): a cor é um
// reforço opcional, mas o texto é a fonte de verdade acessível. Reusado pela
// lista de orçamentos e pelo dashboard para evitar duplicar o mapa.
export const ROTULO_STATUS: Record<OrcamentoStatus, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
}

// Todos os status na ordem de exibição (ex.: opções de filtro).
export const OPCOES_STATUS: OrcamentoStatus[] = [
  'rascunho',
  'enviado',
  'aprovado',
  'reprovado',
  'expirado',
  'cancelado',
]

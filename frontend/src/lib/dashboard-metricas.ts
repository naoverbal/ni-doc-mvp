import { ROTULO_STATUS } from '@/lib/orcamento-status'
import type { OrcamentoResumo, OrcamentoStatus } from '@/types/api'

// Funções PURAS de agregação do dashboard: recebem `OrcamentoResumo[]` (campos
// de data como string ISO) e derivam contagens, somas, taxa e séries temporais.
// Sem efeitos colaterais, testáveis isoladamente. A Fase B poderá trocar a
// fonte dos dados (endpoint de agregação) sem reescrever estas funções nem a UI.

export type Granularidade = 'semana' | 'mes' | 'ano'

const TODOS_STATUS: OrcamentoStatus[] = [
  'rascunho',
  'enviado',
  'aprovado',
  'reprovado',
  'expirado',
  'cancelado',
]

// Contagem por status: Record com TODOS os 6 status, zero quando ausente.
export function contarPorStatus(
  orcamentos: OrcamentoResumo[],
): Record<OrcamentoStatus, number> {
  const contagem = Object.fromEntries(TODOS_STATUS.map((s) => [s, 0])) as Record<
    OrcamentoStatus,
    number
  >
  for (const orcamento of orcamentos) {
    contagem[orcamento.status] += 1
  }
  return contagem
}

// Soma de `total` dos orçamentos cujo status está em `statuses`.
export function somarTotalPorStatus(
  orcamentos: OrcamentoResumo[],
  statuses: OrcamentoStatus[],
): number {
  const alvo = new Set(statuses)
  return orcamentos.reduce(
    (soma, orcamento) => (alvo.has(orcamento.status) ? soma + orcamento.total : soma),
    0,
  )
}

// Valor em aberto = soma de `total` dos 'enviado' (aguardando decisão).
export function valorEmAberto(orcamentos: OrcamentoResumo[]): number {
  return somarTotalPorStatus(orcamentos, ['enviado'])
}

// Valor enviado = soma de `total` dos que saíram de rascunho:
// enviado + aprovado + reprovado.
export function valorEnviado(orcamentos: OrcamentoResumo[]): number {
  return somarTotalPorStatus(orcamentos, ['enviado', 'aprovado', 'reprovado'])
}

// Taxa de conversão = aprovados / (enviado + aprovado + reprovado).
// Retorna null quando o denominador é 0 (a UI exibe '—'); senão fração 0..1.
export function taxaConversao(orcamentos: OrcamentoResumo[]): number | null {
  const contagem = contarPorStatus(orcamentos)
  const denominador = contagem.enviado + contagem.aprovado + contagem.reprovado
  if (denominador === 0) return null
  return contagem.aprovado / denominador
}

// Ponto da série temporal já pronto para o VerticalBarChart.
export interface PontoSerie {
  // Chave de ordenação canônica (ex.: '2025-03', '2025-W03', '2025').
  chave: string
  // Rótulo pt-BR para o eixo x (ex.: '03/2025', '2025-S03', '2025').
  rotulo: string
  quantidade: number
}

// Número da semana ISO 8601: semanas de segunda a domingo; a semana 1 é a que
// contém a primeira quinta-feira do ano (equivalente: a que contém 4 de
// janeiro). Padrão internacional, determinístico e independente de locale.
function numeroSemanaIso(data: Date): { ano: number; semana: number } {
  // Trabalha em UTC para evitar deslocamento por fuso.
  const d = new Date(Date.UTC(data.getUTCFullYear(), data.getUTCMonth(), data.getUTCDate()))
  // getUTCDay: 0 (domingo)..6 (sábado); ISO usa 1 (segunda)..7 (domingo).
  const diaIso = d.getUTCDay() === 0 ? 7 : d.getUTCDay()
  // Desloca para a quinta-feira da mesma semana ISO (a que define o ano/semana).
  d.setUTCDate(d.getUTCDate() + 4 - diaIso)
  const ano = d.getUTCFullYear()
  const inicioAno = new Date(Date.UTC(ano, 0, 1))
  const semana = Math.ceil(((d.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7)
  return { ano, semana }
}

// Agrupa por `criadoEm` na granularidade pedida, ordenado asc pela chave
// canônica. Buckets sem orçamentos NÃO são preenchidos (série esparsa) —
// simples e suficiente para o MVP. Rótulos de eixo em pt-BR.
export function agruparCriadosPorPeriodo(
  orcamentos: OrcamentoResumo[],
  granularidade: Granularidade,
): PontoSerie[] {
  const buckets = new Map<string, { rotulo: string; quantidade: number }>()

  for (const orcamento of orcamentos) {
    const data = new Date(orcamento.criadoEm)
    let chave: string
    let rotulo: string

    if (granularidade === 'ano') {
      const ano = data.getUTCFullYear()
      chave = String(ano)
      rotulo = String(ano)
    } else if (granularidade === 'mes') {
      const ano = data.getUTCFullYear()
      const mes = data.getUTCMonth() + 1
      const mesStr = String(mes).padStart(2, '0')
      // Chave canônica ordenável; rótulo pt-BR 'MM/AAAA'.
      chave = `${ano}-${mesStr}`
      rotulo = `${mesStr}/${ano}`
    } else {
      const { ano, semana } = numeroSemanaIso(data)
      const semanaStr = String(semana).padStart(2, '0')
      // Chave canônica ordenável 'AAAA-Www'; rótulo pt-BR 'AAAA-Sww'.
      chave = `${ano}-W${semanaStr}`
      rotulo = `${ano}-S${semanaStr}`
    }

    const existente = buckets.get(chave)
    if (existente) {
      existente.quantidade += 1
    } else {
      buckets.set(chave, { rotulo, quantidade: 1 })
    }
  }

  return Array.from(buckets.entries())
    .map(([chave, { rotulo, quantidade }]) => ({ chave, rotulo, quantidade }))
    .sort((a, b) => a.chave.localeCompare(b.chave))
}

// 5 mais recentes. A entrada já vem ordenada `criado_em DESC` da API, mas
// ordenamos defensivamente para não depender dessa garantia.
export function recentes(orcamentos: OrcamentoResumo[], limite = 5): OrcamentoResumo[] {
  return [...orcamentos]
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm))
    .slice(0, limite)
}

// 'enviado' ordenados do mais antigo ao mais novo (asc por criadoEm); top 5.
export function aguardandoHaMaisTempo(
  orcamentos: OrcamentoResumo[],
  limite = 5,
): OrcamentoResumo[] {
  return orcamentos
    .filter((orcamento) => orcamento.status === 'enviado')
    .sort((a, b) => a.criadoEm.localeCompare(b.criadoEm))
    .slice(0, limite)
}

// Fatia do donut: uma por status COM contagem > 0.
export interface FatiaStatus {
  status: OrcamentoStatus
  legenda: string
  valor: number
}

// Distribuição por status: só os status com contagem > 0, com a legenda textual
// (ROTULO_STATUS) — status nunca é comunicado só por cor.
export function distribuicaoPorStatus(orcamentos: OrcamentoResumo[]): FatiaStatus[] {
  const contagem = contarPorStatus(orcamentos)
  return TODOS_STATUS.filter((status) => contagem[status] > 0).map((status) => ({
    status,
    legenda: ROTULO_STATUS[status],
    valor: contagem[status],
  }))
}

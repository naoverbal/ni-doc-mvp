import {
  STATUS_ORCAMENTO,
  type OrcamentoStatus,
} from '../repositories/orcamento.repository.js'
import type {
  DashboardRepository,
  FiltroCriados,
  OrcamentoDashboard,
} from '../repositories/dashboard.repository.js'
import type { Granularidade } from '../schemas/dashboard.schema.js'

// -----------------------------------------------------------------------------
// Dashboard (somente leitura). O escopo é o tenant do usuário logado; não há
// restrição por operador (decisão de produto: o dashboard segue a regra atual
// por tenant). O status ATUAL do orçamento é o que decide cada métrica.
// -----------------------------------------------------------------------------

export interface DashboardContexto {
  tenantId: string
}

export interface TotalPorStatus {
  quantidade: number
  valor: number
}

export interface ResumoDashboard {
  // Todos os status, com zero quando ausentes.
  porStatus: Record<OrcamentoStatus, TotalPorStatus>
  // Soma de `total` dos `enviado` (aguardando decisão).
  valorEmAberto: number
  // Soma de `total` de enviado + aprovado + reprovado.
  valorEnviado: number
  // Soma de `total` dos `aprovado` (status atual).
  valorAprovado: number
  // Fração 0..1 (aprovados sobre enviado + aprovado + reprovado), ou null quando
  // não há base de cálculo. Ver DENOMINADOR_CONVERSAO.
  taxaConversao: number | null
}

export interface PontoCriados {
  chave: string
  rotulo: string
  quantidade: number
}

export interface OrcamentoDashboardPublico extends OrcamentoDashboard {
  // Dias inteiros desde o envio da versão vigente; null se não houver envio.
  diasAguardando: number | null
}

// Status que entram no denominador da taxa de conversão. Decisão de produto:
// expirado e cancelado NÃO entram; só quem recebeu decisão (aprovado/reprovado)
// ou ainda aguarda (enviado). É o único ponto a alterar se a regra mudar.
const DENOMINADOR_CONVERSAO: readonly OrcamentoStatus[] = ['enviado', 'aprovado', 'reprovado']

const MS_POR_DIA = 24 * 60 * 60 * 1000

// Arredonda a 2 casas para não expor ruído de ponto flutuante nas somas.
function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100
}

function rotuloDe(granularidade: Granularidade, chave: string): string {
  if (granularidade === 'mes') {
    // 'AAAA-MM' → 'MM/AAAA'
    const [ano, mes] = chave.split('-')
    return `${mes}/${ano}`
  }
  if (granularidade === 'semana') {
    // 'AAAA-Www' → 'AAAA-Sww'
    return chave.replace('-W', '-S')
  }
  return chave
}

export interface DashboardService {
  resumo(ctx: DashboardContexto): Promise<ResumoDashboard>
  criadosPorPeriodo(ctx: DashboardContexto, filtro: FiltroCriados): Promise<PontoCriados[]>
  recentes(ctx: DashboardContexto, limite: number): Promise<OrcamentoDashboardPublico[]>
  pendentes(ctx: DashboardContexto, limite: number): Promise<OrcamentoDashboardPublico[]>
}

export interface DashboardServiceDeps {
  dashboardRepo: DashboardRepository
  // Relógio injetável (testes determinísticos).
  relogio?: () => Date
}

export function criarDashboardService({
  dashboardRepo,
  relogio = () => new Date(),
}: DashboardServiceDeps): DashboardService {
  function comDias(itens: OrcamentoDashboard[]): OrcamentoDashboardPublico[] {
    const agora = relogio().getTime()
    return itens.map((item) => ({
      ...item,
      diasAguardando:
        item.enviadoEm === null
          ? null
          : Math.max(0, Math.floor((agora - item.enviadoEm.getTime()) / MS_POR_DIA)),
    }))
  }

  return {
    async resumo(ctx: DashboardContexto): Promise<ResumoDashboard> {
      const linhas = await dashboardRepo.resumoPorStatus(ctx.tenantId)

      const porStatus = Object.fromEntries(
        STATUS_ORCAMENTO.map((status) => [status, { quantidade: 0, valor: 0 }]),
      ) as Record<OrcamentoStatus, TotalPorStatus>
      for (const linha of linhas) {
        porStatus[linha.status] = {
          quantidade: linha.quantidade,
          valor: arredondar(linha.valor),
        }
      }

      const denominador = DENOMINADOR_CONVERSAO.reduce(
        (soma, status) => soma + porStatus[status].quantidade,
        0,
      )

      return {
        porStatus,
        valorEmAberto: porStatus.enviado.valor,
        valorEnviado: arredondar(
          porStatus.enviado.valor + porStatus.aprovado.valor + porStatus.reprovado.valor,
        ),
        valorAprovado: porStatus.aprovado.valor,
        taxaConversao: denominador === 0 ? null : porStatus.aprovado.quantidade / denominador,
      }
    },

    async criadosPorPeriodo(
      ctx: DashboardContexto,
      filtro: FiltroCriados,
    ): Promise<PontoCriados[]> {
      const pontos = await dashboardRepo.criadosPorPeriodo(ctx.tenantId, filtro)
      return pontos.map((ponto) => ({
        chave: ponto.chave,
        rotulo: rotuloDe(filtro.granularidade, ponto.chave),
        quantidade: ponto.quantidade,
      }))
    },

    async recentes(ctx: DashboardContexto, limite: number): Promise<OrcamentoDashboardPublico[]> {
      return comDias(await dashboardRepo.recentes(ctx.tenantId, limite))
    },

    async pendentes(ctx: DashboardContexto, limite: number): Promise<OrcamentoDashboardPublico[]> {
      return comDias(await dashboardRepo.pendentes(ctx.tenantId, limite))
    },
  }
}

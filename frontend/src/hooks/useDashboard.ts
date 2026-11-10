import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/services/api'
import type {
  GranularidadeDashboard,
  OrcamentoDashboard,
  PontoCriados,
  ResumoDashboard,
} from '@/types/api'

// Dados do dashboard vindos dos endpoints de agregação do backend
// (/api/dashboard/*). As chaves começam por 'dashboard' para invalidar o painel
// inteiro de uma vez; ficam distintas de ['orcamentos', ...] (listas/detalhe).

const LIMITE_LISTAS = 5

export interface DadosDashboard {
  resumo: ResumoDashboard
  recentes: OrcamentoDashboard[]
  pendentes: OrcamentoDashboard[]
}

export interface EstadoDashboard {
  data: DadosDashboard | undefined
  isLoading: boolean
  isError: boolean
}

// Resumo + listas (recentes e aguardando há mais tempo). Expõe a mesma
// superfície das demais telas (data/isLoading/isError); `data` só existe quando
// as três consultas resolveram, para a tela nunca renderizar parcialmente.
export function useDashboard(): EstadoDashboard {
  const resumo = useQuery<ResumoDashboard, ApiError>({
    queryKey: ['dashboard', 'resumo'],
    queryFn: () => api.get<ResumoDashboard>('/dashboard/resumo'),
  })
  const recentes = useQuery<OrcamentoDashboard[], ApiError>({
    queryKey: ['dashboard', 'recentes', LIMITE_LISTAS],
    queryFn: () => api.get<OrcamentoDashboard[]>(`/dashboard/recentes?limite=${LIMITE_LISTAS}`),
  })
  const pendentes = useQuery<OrcamentoDashboard[], ApiError>({
    queryKey: ['dashboard', 'pendentes', LIMITE_LISTAS],
    queryFn: () => api.get<OrcamentoDashboard[]>(`/dashboard/pendentes?limite=${LIMITE_LISTAS}`),
  })

  const data =
    resumo.data && recentes.data && pendentes.data
      ? { resumo: resumo.data, recentes: recentes.data, pendentes: pendentes.data }
      : undefined

  return {
    data,
    isLoading: resumo.isLoading || recentes.isLoading || pendentes.isLoading,
    isError: resumo.isError || recentes.isError || pendentes.isError,
  }
}

// Série de orçamentos criados por período. Trocar a granularidade refaz a busca
// (o agrupamento é no servidor, no fuso de São Paulo); o gráfico anterior
// permanece visível enquanto a nova série carrega.
export function useDashboardCriados(granularidade: GranularidadeDashboard) {
  return useQuery<PontoCriados[], ApiError>({
    queryKey: ['dashboard', 'criados', granularidade],
    queryFn: () => api.get<PontoCriados[]>(`/dashboard/criados?granularidade=${granularidade}`),
    placeholderData: keepPreviousData,
  })
}

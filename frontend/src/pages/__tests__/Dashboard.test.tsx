import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { lightTheme } from '@/theme/ni-doc-theme'
import { Dashboard } from '@/pages/Dashboard'
import type {
  OrcamentoDashboard,
  OrcamentoVencendo,
  PontoCriados,
  ResumoDashboard,
  TempoDecisao,
} from '@/types/api'

// Mocka os hooks de dados do dashboard para controlar os estados
// (loading/erro/vazio/dados) sem tocar a rede. As agregações são do servidor e
// têm testes próprios no backend.
vi.mock('@/hooks/useDashboard', () => ({
  useDashboard: vi.fn(),
  useDashboardSerie: vi.fn(),
}))

const { useDashboard, useDashboardSerie } = await import('@/hooks/useDashboard')
const mockDashboard = vi.mocked(useDashboard)
const mockSerie = vi.mocked(useDashboardSerie)

type EstadoDashboard = ReturnType<typeof useDashboard>
type EstadoSerie = ReturnType<typeof useDashboardSerie>

function estado(parcial: Partial<EstadoDashboard>): EstadoDashboard {
  return { data: undefined, isLoading: false, isError: false, ...parcial }
}

function estadoSerie(parcial: Partial<EstadoSerie> = {}): EstadoSerie {
  return { data: [], isError: false, ...parcial } as EstadoSerie
}

const ZERO = { quantidade: 0, valor: 0 }

function resumo(parcial: Partial<ResumoDashboard['porStatus']> = {}): ResumoDashboard {
  return {
    porStatus: {
      rascunho: ZERO,
      enviado: ZERO,
      aprovado: ZERO,
      reprovado: ZERO,
      expirado: ZERO,
      cancelado: ZERO,
      ...parcial,
    },
    valorEmAberto: 150,
    valorEnviado: 380,
    valorAprovado: 200,
    taxaConversao: 0.25,
  }
}

let contador = 0
function orc(parcial: Partial<OrcamentoDashboard> = {}): OrcamentoDashboard {
  contador += 1
  return {
    id: `orc-${contador}`,
    numero: `ORC-2025-${String(contador).padStart(4, '0')}`,
    titulo: `Orçamento ${contador}`,
    status: 'enviado',
    clienteId: 'cli-1',
    clienteNome: 'Cliente Exemplo',
    total: 100,
    criadoEm: '2025-01-01T12:00:00.000Z',
    enviadoEm: '2025-01-02T12:00:00.000Z',
    expiraEm: null,
    diasAguardando: 3,
    ...parcial,
  }
}

function venc(diasParaVencer: number): OrcamentoVencendo {
  const base = orc()
  return {
    id: base.id,
    numero: base.numero,
    titulo: base.titulo,
    status: 'enviado',
    clienteId: base.clienteId,
    clienteNome: base.clienteNome,
    total: base.total,
    criadoEm: base.criadoEm,
    enviadoEm: base.enviadoEm,
    expiraEm: '2025-07-01T03:00:00.000Z',
    diasParaVencer,
  }
}

const TEMPO: TempoDecisao = {
  geral: { quantidade: 4, mediaDias: 5.5, medianaDias: 5 },
  aprovados: { quantidade: 3, mediaDias: 5.3, medianaDias: 4 },
  reprovados: { quantidade: 1, mediaDias: 6, medianaDias: 6 },
}

const DADOS = {
  vencendo: [venc(1), venc(5)],
  tempoDecisao: TEMPO,
  resumo: resumo({
    rascunho: { quantidade: 1, valor: 999 },
    enviado: { quantidade: 2, valor: 150 },
    aprovado: { quantidade: 1, valor: 200 },
    reprovado: { quantidade: 1, valor: 30 },
  }),
  recentes: [orc({ status: 'rascunho', diasAguardando: null, enviadoEm: null }), orc()],
  pendentes: [orc({ diasAguardando: 0 }), orc({ diasAguardando: 1 }), orc({ diasAguardando: 7 })],
}

const SERIE: PontoCriados[] = [{ chave: '2025-03', rotulo: '03/2025', quantidade: 3 }]

function renderDashboard(): void {
  render(
    <FluentProvider theme={lightTheme}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/orcamentos/:id" element={<h1>Editor</h1>} />
          <Route path="/orcamentos/novo" element={<h1>Novo orçamento</h1>} />
        </Routes>
      </MemoryRouter>
    </FluentProvider>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSerie.mockReturnValue(estadoSerie({ data: SERIE }))
  })

  it('renderiza um <main id="conteudo"> e um <h1> descritivo', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()
    const principal = screen.getByRole('main')
    expect(principal).toHaveAttribute('id', 'conteudo')
    const titulo = screen.getByRole('heading', { level: 1 })
    expect(titulo).toHaveTextContent(/painel de orçamentos/i)
  })

  it('anuncia o carregamento via região aria-live="polite"', () => {
    mockDashboard.mockReturnValue(estado({ isLoading: true }))
    renderDashboard()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/carregando/i)
  })

  it('anuncia erro de carregamento com role=alert', () => {
    mockDashboard.mockReturnValue(estado({ isError: true }))
    renderDashboard()
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível carregar/i)
  })

  it('mostra o estado vazio com ação "Novo orçamento" quando não há orçamentos', () => {
    mockDashboard.mockReturnValue(
      estado({
        data: {
          resumo: resumo(),
          recentes: [],
          pendentes: [],
          vencendo: [],
          tempoDecisao: TEMPO,
        },
      }),
    )
    renderDashboard()
    expect(screen.getByText(/nenhum orçamento ainda/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /novo orçamento/i })).toBeInTheDocument()
  })

  it('exibe os cards de KPI com os valores do resumo do servidor', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()

    // Aguardando (= enviado) = 2.
    const aguardando = screen.getByText('Aguardando').closest('div')?.parentElement
    expect(aguardando).toHaveTextContent('2')

    // Aprovados = 1.
    expect(screen.getByText('Aprovados').closest('div')?.parentElement).toHaveTextContent('1')

    // Total de orçamentos = 1 + 2 + 1 + 1 = 5.
    expect(screen.getByText('Total de orçamentos').closest('div')?.parentElement).toHaveTextContent(
      '5',
    )

    // Valor em aberto e taxa vêm prontos do servidor.
    expect(screen.getByText(/150,00/)).toBeInTheDocument()
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('renderiza as seções de distribuição e série com títulos acessíveis', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()
    expect(screen.getByRole('heading', { name: /distribuição por status/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /orçamentos criados/i })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /granularidade/i })).toBeInTheDocument()
  })

  it('troca a granularidade pedindo a série correspondente ao servidor', async () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    const usuario = userEvent.setup()
    renderDashboard()

    expect(mockSerie).toHaveBeenLastCalledWith('criados', 'mes')
    await usuario.click(screen.getByRole('tab', { name: /ano/i }))

    expect(screen.getByRole('tab', { name: /ano/i })).toHaveAttribute('aria-selected', 'true')
    expect(mockSerie).toHaveBeenLastCalledWith('criados', 'ano')
  })

  it('troca a série (criação, envio, aprovação) e atualiza título e descrição', async () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    const usuario = userEvent.setup()
    renderDashboard()

    expect(screen.getByRole('heading', { name: 'Orçamentos criados' })).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: 'Envio' }))
    expect(mockSerie).toHaveBeenLastCalledWith('enviados', 'mes')
    expect(screen.getByRole('heading', { name: 'Orçamentos enviados' })).toBeInTheDocument()
    expect(screen.getByText(/aparecem no período do envio/i)).toBeInTheDocument()

    await usuario.click(screen.getByRole('tab', { name: 'Aprovação' }))
    expect(mockSerie).toHaveBeenLastCalledWith('aprovados', 'mes')
    expect(screen.getByRole('heading', { name: 'Orçamentos aprovados' })).toBeInTheDocument()
  })

  it('mostra o detalhamento com valor e cancelados no período de origem', () => {
    const porStatus = resumo({
      enviado: { quantidade: 1, valor: 100 },
      aprovado: { quantidade: 2, valor: 400 },
      cancelado: { quantidade: 1, valor: 200 },
    }).porStatus
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    mockSerie.mockReturnValue(
      estadoSerie({
        data: [
          { chave: '2025-03', rotulo: '03/2025', quantidade: 4, valor: 700, porStatus },
        ] as EstadoSerie['data'],
      }),
    )
    renderDashboard()

    const tabela = screen.getByRole('table', { name: /detalhamento por período/i })
    const linha = within(tabela).getByText('03/2025').closest('tr') as HTMLElement
    expect(within(linha).getByText('4')).toBeInTheDocument()
    expect(within(linha).getByText(/700,00/)).toBeInTheDocument()
    // Cancelados depois = 1 (aparece no período do envio).
    expect(within(linha).getByText('1')).toBeInTheDocument()
    expect(within(tabela).getByRole('columnheader', { name: /cancelados depois/i })).toBeInTheDocument()
  })

  it('anuncia erro ao carregar a série sem derrubar o restante do painel', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    mockSerie.mockReturnValue(estadoSerie({ data: undefined, isError: true }))
    renderDashboard()

    expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível carregar a série/i)
    expect(screen.getByRole('heading', { name: /indicadores/i })).toBeInTheDocument()
  })

  it('lista os orçamentos recentes com cliente e link para o detalhe', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()
    const recentes = screen
      .getByRole('heading', { name: /orçamentos recentes/i })
      .closest('div') as HTMLElement
    const links = within(recentes).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('/orcamentos/'))
    expect(within(recentes).getAllByText('Cliente Exemplo').length).toBeGreaterThan(0)
  })

  it('mostra há quantos dias cada orçamento aguarda decisão', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()
    const secao = screen
      .getByRole('heading', { name: /aguardando há mais tempo/i })
      .closest('div') as HTMLElement
    expect(within(secao).getByText('Enviado hoje')).toBeInTheDocument()
    expect(within(secao).getByText('Aguardando há 1 dia')).toBeInTheDocument()
    expect(within(secao).getByText('Aguardando há 7 dias')).toBeInTheDocument()
  })

  it('exibe o tempo mediano até a decisão com a média e a quebra por resultado', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()

    const card = screen.getByText('Tempo mediano até a decisão').closest('div')?.parentElement
    expect(card).toHaveTextContent('5 dias')
    expect(card).toHaveTextContent('Média 5,5 dias em 4 decisões')
    expect(card).toHaveTextContent('Aprovados: 4 dias')
    expect(card).toHaveTextContent('Reprovados: 6 dias')
  })

  it('mostra traço e aviso no card de tempo quando não há decisões', () => {
    const vazio = { quantidade: 0, mediaDias: null, medianaDias: null }
    mockDashboard.mockReturnValue(
      estado({
        data: { ...DADOS, tempoDecisao: { geral: vazio, aprovados: vazio, reprovados: vazio } },
      }),
    )
    renderDashboard()

    const card = screen.getByText('Tempo mediano até a decisão').closest('div')?.parentElement
    expect(card).toHaveTextContent('—')
    expect(card).toHaveTextContent('Sem decisões registradas')
  })

  it('lista os orçamentos que vencem na janela com os dias restantes', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    renderDashboard()

    const secao = screen
      .getByRole('heading', { name: /vencendo nos próximos 7 dias/i })
      .closest('div') as HTMLElement
    expect(within(secao).getByText('Vence em 1 dia')).toBeInTheDocument()
    expect(within(secao).getByText('Vence em 5 dias')).toBeInTheDocument()
    expect(within(secao).getAllByRole('link')).toHaveLength(2)
  })

  it('informa quando nenhum orçamento vence na janela', () => {
    mockDashboard.mockReturnValue(estado({ data: { ...DADOS, vencendo: [] } }))
    renderDashboard()

    expect(screen.getByText(/nenhum orçamento vence nesse período/i)).toBeInTheDocument()
  })

  it('informa quando nenhum orçamento aguarda decisão', () => {
    mockDashboard.mockReturnValue(estado({ data: { ...DADOS, pendentes: [] } }))
    renderDashboard()
    expect(screen.getByText(/nenhum orçamento aguardando decisão/i)).toBeInTheDocument()
  })
})

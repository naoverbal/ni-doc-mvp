import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { lightTheme } from '@/theme/ni-doc-theme'
import { Dashboard } from '@/pages/Dashboard'
import type { OrcamentoDashboard, PontoCriados, ResumoDashboard } from '@/types/api'

// Mocka os hooks de dados do dashboard para controlar os estados
// (loading/erro/vazio/dados) sem tocar a rede. As agregações são do servidor e
// têm testes próprios no backend.
vi.mock('@/hooks/useDashboard', () => ({
  useDashboard: vi.fn(),
  useDashboardCriados: vi.fn(),
}))

const { useDashboard, useDashboardCriados } = await import('@/hooks/useDashboard')
const mockDashboard = vi.mocked(useDashboard)
const mockCriados = vi.mocked(useDashboardCriados)

type EstadoDashboard = ReturnType<typeof useDashboard>
type EstadoCriados = ReturnType<typeof useDashboardCriados>

function estado(parcial: Partial<EstadoDashboard>): EstadoDashboard {
  return { data: undefined, isLoading: false, isError: false, ...parcial }
}

function estadoCriados(parcial: Partial<EstadoCriados> = {}): EstadoCriados {
  return { data: [], isError: false, ...parcial } as EstadoCriados
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

const DADOS = {
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
    mockCriados.mockReturnValue(estadoCriados({ data: SERIE }))
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
      estado({ data: { resumo: resumo(), recentes: [], pendentes: [] } }),
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

    expect(mockCriados).toHaveBeenLastCalledWith('mes')
    await usuario.click(screen.getByRole('tab', { name: /ano/i }))

    expect(screen.getByRole('tab', { name: /ano/i })).toHaveAttribute('aria-selected', 'true')
    expect(mockCriados).toHaveBeenLastCalledWith('ano')
  })

  it('anuncia erro ao carregar a série sem derrubar o restante do painel', () => {
    mockDashboard.mockReturnValue(estado({ data: DADOS }))
    mockCriados.mockReturnValue(estadoCriados({ data: undefined, isError: true }))
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

  it('informa quando nenhum orçamento aguarda decisão', () => {
    mockDashboard.mockReturnValue(estado({ data: { ...DADOS, pendentes: [] } }))
    renderDashboard()
    expect(screen.getByText(/nenhum orçamento aguardando decisão/i)).toBeInTheDocument()
  })
})

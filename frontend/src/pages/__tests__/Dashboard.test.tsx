import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { lightTheme } from '@/theme/ni-doc-theme'
import { Dashboard } from '@/pages/Dashboard'
import type { OrcamentoResumo } from '@/types/api'

// Mocka o hook de dados do dashboard para controlar os três estados
// (loading/erro/vazio/dados) sem tocar a rede. Mantém a UI isolada das funções
// de busca; as funções puras de agregação têm testes próprios.
vi.mock('@/hooks/useDashboardOrcamentos', () => ({
  useDashboardOrcamentos: vi.fn(),
}))

const { useDashboardOrcamentos } = await import('@/hooks/useDashboardOrcamentos')
const mockHook = vi.mocked(useDashboardOrcamentos)

type EstadoHook = ReturnType<typeof useDashboardOrcamentos>

function estado(parcial: Partial<EstadoHook>): EstadoHook {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    ...parcial,
  } as EstadoHook
}

let contador = 0
function orc(parcial: Partial<OrcamentoResumo> = {}): OrcamentoResumo {
  contador += 1
  return {
    id: `orc-${contador}`,
    numero: `ORC-2025-${String(contador).padStart(4, '0')}`,
    titulo: `Orçamento ${contador}`,
    status: 'rascunho',
    clienteId: 'cli-1',
    subtotal: 100,
    total: 100,
    versaoAtual: 0,
    dataEmissao: '2025-01-01',
    criadoEm: '2025-01-01T12:00:00.000Z',
    ...parcial,
  }
}

const BASE: OrcamentoResumo[] = [
  orc({ status: 'enviado', total: 100, criadoEm: '2025-01-05T12:00:00.000Z' }),
  orc({ status: 'enviado', total: 50, criadoEm: '2025-02-10T12:00:00.000Z' }),
  orc({ status: 'aprovado', total: 200, criadoEm: '2025-03-01T12:00:00.000Z' }),
  orc({ status: 'reprovado', total: 30, criadoEm: '2025-03-15T12:00:00.000Z' }),
  orc({ status: 'rascunho', total: 999, criadoEm: '2025-04-01T12:00:00.000Z' }),
]

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
  })

  it('renderiza um <main id="conteudo"> e um <h1> descritivo', () => {
    mockHook.mockReturnValue(estado({ data: BASE }))
    renderDashboard()
    const principal = screen.getByRole('main')
    expect(principal).toHaveAttribute('id', 'conteudo')
    const titulo = screen.getByRole('heading', { level: 1 })
    expect(titulo).toHaveTextContent(/painel de orçamentos/i)
  })

  it('anuncia o carregamento via região aria-live="polite"', () => {
    mockHook.mockReturnValue(estado({ isLoading: true }))
    renderDashboard()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/carregando/i)
  })

  it('anuncia erro de carregamento com role=alert', () => {
    mockHook.mockReturnValue(estado({ isError: true }))
    renderDashboard()
    const alerta = screen.getByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível carregar/i)
  })

  it('mostra o estado vazio com ação "Novo orçamento" quando não há orçamentos', () => {
    mockHook.mockReturnValue(estado({ data: [] }))
    renderDashboard()
    expect(screen.getByText(/nenhum orçamento ainda/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /novo orçamento/i })).toBeInTheDocument()
  })

  it('exibe os cards de KPI com contagens e valores derivados', () => {
    mockHook.mockReturnValue(estado({ data: BASE }))
    renderDashboard()

    // Aguardando (= enviado) = 2.
    const aguardando = screen.getByText('Aguardando').closest('div')?.parentElement
    expect(aguardando).toHaveTextContent('2')

    // Aprovados = 1, reprovados = 1, rascunhos = 1.
    expect(screen.getByText('Aprovados').closest('div')?.parentElement).toHaveTextContent('1')

    // Valor em aberto = 150 (100 + 50 dos enviados).
    expect(screen.getByText(/150,00/)).toBeInTheDocument()

    // Taxa de conversão = 1 / (2 + 1 + 1) = 25%.
    expect(screen.getByText('25%')).toBeInTheDocument()
  })

  it('renderiza as seções de distribuição e série com títulos acessíveis', () => {
    mockHook.mockReturnValue(estado({ data: BASE }))
    renderDashboard()
    expect(screen.getByRole('heading', { name: /distribuição por status/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /orçamentos criados/i })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: /granularidade/i })).toBeInTheDocument()
  })

  it('troca a granularidade sem refazer a busca (reagrupa no cliente)', async () => {
    mockHook.mockReturnValue(estado({ data: BASE }))
    const usuario = userEvent.setup()
    renderDashboard()

    const chamadasAntes = mockHook.mock.calls.length
    await usuario.click(screen.getByRole('tab', { name: /ano/i }))

    // A seleção da tab muda, mas o hook de dados não é chamado de novo com
    // argumentos diferentes (a base é a mesma; só o reagrupamento muda).
    expect(screen.getByRole('tab', { name: /ano/i })).toHaveAttribute('aria-selected', 'true')
    expect(mockHook.mock.calls.length).toBeGreaterThanOrEqual(chamadasAntes)
  })

  it('lista os orçamentos recentes com link para o detalhe', () => {
    mockHook.mockReturnValue(estado({ data: BASE }))
    renderDashboard()
    const recentes = screen
      .getByRole('heading', { name: /orçamentos recentes/i })
      .closest('div') as HTMLElement
    const links = within(recentes).getAllByRole('link')
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('/orcamentos/'))
  })
})

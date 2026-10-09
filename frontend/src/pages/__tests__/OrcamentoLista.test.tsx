import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OrcamentoLista } from '@/pages/OrcamentoLista'
import { ApiError } from '@/services/api'
import type { ListaOrcamentos } from '@/types/api'

// Mocka o cliente HTTP para controlar as respostas de /orcamentos nos testes.
vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  }
})

const { api } = await import('@/services/api')

const LISTA_EXEMPLO: ListaOrcamentos = {
  itens: [
    {
      id: 'orc-1',
      numero: 'ORC-2025-0001',
      titulo: 'Reforma do escritório',
      status: 'rascunho',
      clienteId: 'cli-1',
      subtotal: 1000,
      total: 900,
      versaoAtual: 0,
      dataEmissao: '2025-01-10',
      criadoEm: '2025-01-10T12:00:00.000Z',
    },
    {
      id: 'orc-2',
      numero: 'ORC-2025-0002',
      titulo: 'Projeto elétrico',
      status: 'aprovado',
      clienteId: 'cli-2',
      subtotal: 2000,
      total: 2000,
      versaoAtual: 1,
      dataEmissao: '2025-02-01',
      criadoEm: '2025-02-01T12:00:00.000Z',
    },
  ],
  total: 2,
  pagina: 1,
  tamanhoPagina: 20,
}

function renderLista(): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/orcamentos']}>
        <Routes>
          <Route path="/orcamentos" element={<OrcamentoLista />} />
          <Route path="/orcamentos/novo" element={<h1>Novo orçamento</h1>} />
          <Route path="/orcamentos/:id" element={<h1>Editor</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('OrcamentoLista', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('anuncia o carregamento via região aria-live="polite"', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
    render(renderLista())

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/carregando/i)
  })

  it('lista os orçamentos em tabela semântica com cabeçalhos de coluna', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTA_EXEMPLO)
    render(renderLista())

    const tabela = await screen.findByRole('table')
    expect(tabela).toBeInTheDocument()

    // Cabeçalhos de coluna acessíveis (th scope="col").
    expect(screen.getByRole('columnheader', { name: /número/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /título/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument()

    expect(screen.getByText('ORC-2025-0001')).toBeInTheDocument()
    expect(screen.getByText('Reforma do escritório')).toBeInTheDocument()
  })

  it('mostra o status com rótulo textual (não apenas por cor)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTA_EXEMPLO)
    render(renderLista())

    const tabela = await screen.findByRole('table')
    // O texto do status deve estar na própria linha da tabela, não só na cor.
    expect(within(tabela).getByText('Rascunho')).toBeInTheDocument()
    expect(within(tabela).getByText('Aprovado')).toBeInTheDocument()
  })

  it('anuncia estado vazio via aria-live quando não há orçamentos', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      itens: [],
      total: 0,
      pagina: 1,
      tamanhoPagina: 20,
    } satisfies ListaOrcamentos)
    render(renderLista())

    const vazio = await screen.findByText(/nenhum orçamento/i)
    expect(vazio).toHaveAttribute('role', 'status')
    expect(vazio).toHaveAttribute('aria-live', 'polite')
  })

  it('tem botão "novo orçamento" que navega para o editor de criação', async () => {
    vi.mocked(api.get).mockResolvedValue(LISTA_EXEMPLO)
    const usuario = userEvent.setup()
    render(renderLista())

    await screen.findByRole('table')
    const botaoNovo = screen.getByRole('link', { name: /novo orçamento/i })
    await usuario.click(botaoNovo)

    expect(screen.getByRole('heading', { name: 'Novo orçamento' })).toBeInTheDocument()
  })

  it('navega para o editor ao acionar a ação de editar', async () => {
    vi.mocked(api.get).mockResolvedValue(LISTA_EXEMPLO)
    const usuario = userEvent.setup()
    render(renderLista())

    await screen.findByRole('table')
    const editar = screen.getByRole('link', { name: /editar ORC-2025-0001/i })
    await usuario.click(editar)

    expect(screen.getByRole('heading', { name: 'Editor' })).toBeInTheDocument()
  })

  it('filtra por status refazendo a consulta', async () => {
    vi.mocked(api.get).mockResolvedValue(LISTA_EXEMPLO)
    const usuario = userEvent.setup()
    render(renderLista())

    await screen.findByRole('table')
    const filtro = screen.getByLabelText(/filtrar por status/i)
    await usuario.selectOptions(filtro, 'aprovado')

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(expect.stringContaining('status=aprovado')),
    )
  })

  it('exclui um orçamento com ação ícone-only rotulada por aria-label', async () => {
    vi.mocked(api.get).mockResolvedValue(LISTA_EXEMPLO)
    vi.mocked(api.delete).mockResolvedValueOnce(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const usuario = userEvent.setup()
    render(renderLista())

    await screen.findByRole('table')
    const excluir = screen.getByRole('button', { name: /excluir ORC-2025-0001/i })
    await usuario.click(excluir)

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/orcamentos/orc-1'))
  })

  it('anuncia erro de carregamento com role=alert', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(500, 'Falha'))
    render(renderLista())

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível carregar/i)
  })

  it('cada linha de dados tem um cabeçalho de linha (th scope="row")', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(LISTA_EXEMPLO)
    render(renderLista())

    const tabela = await screen.findByRole('table')
    const rowheaders = within(tabela).getAllByRole('rowheader')
    expect(rowheaders.length).toBe(2)
  })
})

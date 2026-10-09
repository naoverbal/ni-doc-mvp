import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PublicoOrcamento } from '@/pages/PublicoOrcamento'
import { ApiError } from '@/services/api'
import type { AceiteRegistradoPublico, VisualizacaoPublica } from '@/types/api'

// Mocka o cliente HTTP para controlar as respostas das rotas públicas nos testes.
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

const TOKEN = 'uuid-valido.hmac'

const VISUALIZACAO: VisualizacaoPublica = {
  numero: 'ORC-2026-0001',
  versao: 1,
  integro: true,
  pdfUrl: `/api/publico/orcamento/${TOKEN}/pdf`,
  snapshot: {
    cliente: {
      id: 'cli-1',
      nome: 'Maria Souza',
      tipo_pessoa: 'PF',
      documento: '123.456.789-00',
      email: 'maria@exemplo.com',
      telefone: null,
      endereco: null,
    },
    empresa_cliente: null,
    itens: [
      {
        ordem: 1,
        nome: 'Projeto arquitetônico',
        descricao: 'Planta baixa',
        quantidade: 1,
        unidade: 'un',
        valor_unitario: 5000,
        desconto_tipo: null,
        desconto_valor: null,
        total: 5000,
        responsavel: null,
      },
    ],
    desconto_global: null,
    subtotal: 5000,
    total: 5000,
    condicoes_pagamento: '50% na assinatura',
    observacoes: null,
    data_emissao: '2026-02-01',
    validade_dias: 30,
  },
}

const ACEITE: AceiteRegistradoPublico = {
  id: 'aceite-1',
  versaoId: 'versao-1',
  orcamentoId: 'orc-1',
  metodo: 'cliente',
  hashDocumento: 'a'.repeat(64),
  comprovantePdfPath: '/pdfs/ORC-2026-0001-aceite-v1.pdf',
  comprovantePdfHash: 'comprovante-hash',
  criadoEm: '2026-02-01T12:00:00.000Z',
}

function renderPagina(token = TOKEN): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/publico/orcamento/${token}`]}>
        <Routes>
          <Route path="/publico/orcamento/:token" element={<PublicoOrcamento />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('PublicoOrcamento', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('anuncia o carregamento via região aria-live="polite"', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}))
    render(renderPagina())

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/carregando/i)
  })

  it('exibe o orçamento em modo leitura dentro de um <main> com título', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(VISUALIZACAO)
    render(renderPagina())

    expect(await screen.findByRole('main')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: /ORC-2026-0001/i })).toBeInTheDocument()
    expect(screen.getByText(/Maria Souza/)).toBeInTheDocument()
    expect(screen.getByText(/Projeto arquitetônico/)).toBeInTheDocument()
  })

  it('exibe o selo "Documento íntegro" quando a versão é íntegra (não só por cor)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(VISUALIZACAO)
    render(renderPagina())

    expect(await screen.findByText(/documento íntegro/i)).toBeInTheDocument()
  })

  it('embute o PDF com título/alternativa textual e link para abrir/baixar', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(VISUALIZACAO)
    render(renderPagina())

    await screen.findByRole('main')

    // Alternativa textual: iframe com title acessível.
    const quadro = screen.getByTitle(/documento do orçamento/i)
    expect(quadro).toHaveAttribute('src', VISUALIZACAO.pdfUrl)

    // Link para abrir/baixar o documento (texto autoexplicativo).
    const link = screen.getByRole('link', { name: /abrir o documento|baixar o documento/i })
    expect(link).toHaveAttribute('href', VISUALIZACAO.pdfUrl)
  })

  it('exige o checkbox de aceite para habilitar o botão "Aprovar"', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(VISUALIZACAO)
    const usuario = userEvent.setup()
    render(renderPagina())

    await screen.findByRole('main')

    const aprovar = screen.getByRole('button', { name: /aprovar/i })
    expect(aprovar).toBeDisabled()

    const checkbox = screen.getByRole('checkbox', { name: /li e concordo|aceito/i })
    await usuario.click(checkbox)

    expect(aprovar).toBeEnabled()
  })

  it('aprova via teclado e anuncia o comprovante via aria-live', async () => {
    vi.mocked(api.get).mockResolvedValue(VISUALIZACAO)
    vi.mocked(api.post).mockResolvedValueOnce(ACEITE)
    const usuario = userEvent.setup()
    render(renderPagina())

    await screen.findByRole('main')

    // Fluxo operável por teclado: foca o checkbox, marca com Espaço, Tab até o
    // botão aprovar e aciona com Enter.
    const checkbox = screen.getByRole('checkbox', { name: /li e concordo|aceito/i })
    checkbox.focus()
    await usuario.keyboard(' ')
    expect(checkbox).toBeChecked()

    const aprovar = screen.getByRole('button', { name: /aprovar/i })
    aprovar.focus()
    await usuario.keyboard('{Enter}')

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(`/publico/orcamento/${TOKEN}/aprovar`),
    )

    const sucesso = await screen.findByRole('status')
    expect(sucesso).toHaveAttribute('aria-live', 'polite')
    expect(sucesso).toHaveTextContent(/aprovad/i)
    // Link para o comprovante gerado.
    expect(screen.getByRole('link', { name: /comprovante/i })).toBeInTheDocument()
  })

  it('reprova o orçamento e anuncia o resultado', async () => {
    vi.mocked(api.get).mockResolvedValue(VISUALIZACAO)
    vi.mocked(api.post).mockResolvedValueOnce({ ...ACEITE, comprovantePdfPath: null })
    const usuario = userEvent.setup()
    render(renderPagina())

    await screen.findByRole('main')

    const reprovar = screen.getByRole('button', { name: /reprovar/i })
    await usuario.click(reprovar)

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        `/publico/orcamento/${TOKEN}/reprovar`,
        expect.anything(),
      ),
    )

    const resultado = await screen.findByRole('status')
    expect(resultado).toHaveTextContent(/reprovad/i)
  })

  it('mostra erro genérico com role=alert quando o token é inválido (404)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(404, 'Orçamento não encontrado'))
    render(renderPagina())

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível acessar|link inválido|expirado/i)
  })

  it('mostra erro genérico com role=alert quando o link está expirado (410)', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new ApiError(410, 'Link expirado'))
    render(renderPagina())

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/expirad|não foi possível acessar|link inválido/i)
  })

  it('anuncia erro (role=alert) quando a aprovação falha', async () => {
    vi.mocked(api.get).mockResolvedValue(VISUALIZACAO)
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(409, 'Orçamento já aprovado'))
    const usuario = userEvent.setup()
    render(renderPagina())

    await screen.findByRole('main')

    const checkbox = screen.getByRole('checkbox', { name: /li e concordo|aceito/i })
    await usuario.click(checkbox)
    await usuario.click(screen.getByRole('button', { name: /aprovar/i }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/não foi possível|já aprovad/i)
  })

  it('o checkbox tem <label> associado', async () => {
    vi.mocked(api.get).mockResolvedValueOnce(VISUALIZACAO)
    render(renderPagina())

    await screen.findByRole('main')
    const checkbox = screen.getByRole('checkbox', { name: /li e concordo|aceito/i })
    // getByRole com name confirma o nome acessível vindo do <label>.
    expect(checkbox).toBeInTheDocument()
  })

  it('oferece link textual alternativo quando não há PDF embutível', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ ...VISUALIZACAO, pdfUrl: null, integro: false })
    render(renderPagina())

    const main = await screen.findByRole('main')
    // Sem PDF, não há iframe; o selo de integridade reflete "não verificável".
    expect(within(main).queryByTitle(/documento do orçamento/i)).not.toBeInTheDocument()
  })
})

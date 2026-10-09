import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { OrcamentoEditor } from '@/pages/OrcamentoEditor'
import type { ClienteResumo, OrcamentoComItens, VersaoEnviada } from '@/types/api'

vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  }
})

const { api } = await import('@/services/api')

const CLIENTES: ClienteResumo[] = [
  { id: 'cli-1', nome: 'Acme Ltda', tipoPessoa: 'PJ', documento: '11222333000181' },
  { id: 'cli-2', nome: 'Acácia ME', tipoPessoa: 'PJ', documento: '99888777000166' },
]

function renderEditor(entrada = '/orcamentos/novo'): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path="/orcamentos/novo" element={<OrcamentoEditor />} />
          <Route path="/orcamentos/:id" element={<OrcamentoEditor />} />
          <Route path="/orcamentos" element={<h1>Lista</h1>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

// Preenche cliente/título/um item com valores válidos.
async function preencherValido(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  vi.mocked(api.get).mockResolvedValue(CLIENTES)

  const cliente = screen.getByRole('combobox', { name: /cliente/i })
  await usuario.type(cliente, 'Acme')
  await usuario.click(await screen.findByRole('option', { name: /acme ltda/i }))

  await usuario.type(screen.getByLabelText(/^título/i), 'Projeto X')

  const grupoItem = screen.getByRole('group', { name: /item 1/i })
  await usuario.type(within(grupoItem).getByLabelText(/nome/i), 'Serviço')
  const quantidade = within(grupoItem).getByLabelText(/quantidade/i)
  await usuario.clear(quantidade)
  await usuario.type(quantidade, '2')
  const valor = within(grupoItem).getByLabelText(/valor unitário/i)
  await usuario.clear(valor)
  await usuario.type(valor, '100')
}

describe('OrcamentoEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.get).mockResolvedValue([])
  })

  it('renderiza um formulário de criação com os campos principais', () => {
    render(renderEditor())
    expect(screen.getByRole('heading', { name: /novo orçamento/i })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: /cliente/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/^título/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/descrição/i)).toBeInTheDocument()
  })

  it('agrupa a seção de itens em um fieldset com legend', () => {
    render(renderEditor())
    expect(screen.getByRole('group', { name: /itens/i })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /item 1/i })).toBeInTheDocument()
  })

  it('recalcula o total em tempo real e anuncia via aria-live=polite', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    const grupoItem = screen.getByRole('group', { name: /item 1/i })
    const quantidade = within(grupoItem).getByLabelText(/quantidade/i)
    const valor = within(grupoItem).getByLabelText(/valor unitário/i)
    await usuario.clear(quantidade)
    await usuario.type(quantidade, '3')
    await usuario.clear(valor)
    await usuario.type(valor, '50')

    const totalRegion = screen.getByRole('status', { name: /total do orçamento/i })
    expect(totalRegion).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(totalRegion).toHaveTextContent(/R\$\s?150,00/))
  })

  it('adiciona e remove itens', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    expect(screen.getAllByRole('group', { name: /item \d/i })).toHaveLength(1)
    await usuario.click(screen.getByRole('button', { name: /adicionar item/i }))
    expect(screen.getAllByRole('group', { name: /item \d/i })).toHaveLength(2)

    await usuario.click(screen.getByRole('button', { name: /remover item 2/i }))
    expect(screen.getAllByRole('group', { name: /item \d/i })).toHaveLength(1)
  })

  it('mostra erros de validação vinculados por aria quando o formulário é inválido', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    await usuario.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    // Título obrigatório: erro com role=alert e campo marcado aria-invalid.
    const erro = await screen.findByText(/informe o título/i)
    expect(erro).toBeInTheDocument()
    expect(screen.getByLabelText(/^título/i)).toHaveAttribute('aria-invalid', 'true')
    expect(api.post).not.toHaveBeenCalled()
  })

  it('salva um rascunho válido via POST e navega para a lista', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.post).mockResolvedValue({ id: 'orc-novo' } as OrcamentoComItens)
    render(renderEditor())

    await preencherValido(usuario)
    await usuario.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/orcamentos',
        expect.objectContaining({
          clienteId: 'cli-1',
          titulo: 'Projeto X',
          itens: expect.arrayContaining([
            expect.objectContaining({ nome: 'Serviço', quantidade: 2, valorUnitario: 100 }),
          ]),
        }),
      ),
    )
    expect(await screen.findByRole('heading', { name: 'Lista' })).toBeInTheDocument()
  })

  it('em modo edição, carrega o orçamento e salva via PUT', async () => {
    const existente: OrcamentoComItens = {
      id: 'orc-1',
      tenantId: 't1',
      numero: 'ORC-2025-0001',
      clienteId: 'cli-1',
      empresaClienteId: null,
      usuarioId: 'u1',
      titulo: 'Reforma',
      descricao: 'desc',
      status: 'rascunho',
      dataEmissao: '2025-01-10',
      validadeDias: 30,
      descontoGlobalTipo: null,
      descontoGlobalValor: null,
      subtotal: 200,
      total: 200,
      versaoAtual: 0,
      observacoes: null,
      condicoesPagamento: null,
      criadoEm: '2025-01-10T12:00:00.000Z',
      atualizadoEm: '2025-01-10T12:00:00.000Z',
      itens: [
        {
          id: 'it-1',
          ordem: 1,
          nome: 'Serviço A',
          descricao: null,
          quantidade: 2,
          unidade: 'un',
          valorUnitario: 100,
          descontoTipo: null,
          descontoValor: null,
          total: 200,
          responsavelId: null,
        },
      ],
    }
    vi.mocked(api.get).mockImplementation((caminho: string) => {
      if (caminho === '/orcamentos/orc-1') return Promise.resolve(existente)
      return Promise.resolve([])
    })
    vi.mocked(api.put).mockResolvedValue(existente)
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    expect(await screen.findByDisplayValue('Reforma')).toBeInTheDocument()
    await usuario.click(screen.getByRole('button', { name: /salvar rascunho/i }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/orcamentos/orc-1',
        expect.objectContaining({ titulo: 'Reforma', clienteId: 'cli-1' }),
      ),
    )
  })

  // ---------------------------------------------------------------------------
  // Envio e versionamento (RF-008) — tarefa 48.
  // ---------------------------------------------------------------------------

  const rascunho: OrcamentoComItens = {
    id: 'orc-1',
    tenantId: 't1',
    numero: 'ORC-2025-0001',
    clienteId: 'cli-1',
    empresaClienteId: null,
    usuarioId: 'u1',
    titulo: 'Reforma',
    descricao: null,
    status: 'rascunho',
    dataEmissao: '2025-01-10',
    validadeDias: 30,
    descontoGlobalTipo: null,
    descontoGlobalValor: null,
    subtotal: 200,
    total: 200,
    versaoAtual: 0,
    observacoes: null,
    condicoesPagamento: null,
    criadoEm: '2025-01-10T12:00:00.000Z',
    atualizadoEm: '2025-01-10T12:00:00.000Z',
    itens: [
      {
        id: 'it-1',
        ordem: 1,
        nome: 'Serviço A',
        descricao: null,
        quantidade: 2,
        unidade: 'un',
        valorUnitario: 100,
        descontoTipo: null,
        descontoValor: null,
        total: 200,
        responsavelId: null,
      },
    ],
  }

  const versaoEnviada: VersaoEnviada = {
    id: 'versao-1',
    orcamentoId: 'orc-1',
    versao: 1,
    tokenPublico: 'uuid.hmac-token',
    templateId: 'tpl-1',
    pdfPath: null,
    pdfHash: null,
    enviadoEm: '2025-01-10T13:00:00.000Z',
    expiraEm: null,
  }

  function mockRascunho(): void {
    vi.mocked(api.get).mockImplementation((caminho: string) => {
      if (caminho === '/orcamentos/orc-1') return Promise.resolve(rascunho)
      return Promise.resolve([])
    })
  }

  it('não mostra o botão Enviar ao criar (sem id)', () => {
    render(renderEditor())
    expect(screen.queryByRole('button', { name: /^enviar$/i })).not.toBeInTheDocument()
  })

  it('mostra o botão Enviar para um rascunho em edição', async () => {
    mockRascunho()
    render(renderEditor('/orcamentos/orc-1'))
    expect(await screen.findByRole('button', { name: /^enviar$/i })).toBeInTheDocument()
  })

  it('abre um modal de confirmação ao clicar em Enviar e cancela sem enviar', async () => {
    mockRascunho()
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    await usuario.click(await screen.findByRole('button', { name: /^enviar$/i }))
    const dialogo = screen.getByRole('dialog')
    expect(dialogo).toHaveAttribute('aria-modal', 'true')

    await usuario.click(within(dialogo).getByRole('button', { name: /cancelar/i }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('confirma o envio via POST, exibe o link público e lista a versão', async () => {
    mockRascunho()
    vi.mocked(api.post).mockResolvedValue(versaoEnviada)
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    await usuario.click(await screen.findByRole('button', { name: /^enviar$/i }))
    const dialogo = screen.getByRole('dialog')
    await usuario.click(within(dialogo).getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orcamentos/orc-1/enviar'))

    // Confirmação anunciada via aria-live.
    const status = await screen.findByRole('status', { name: /envio/i })
    expect(status).toHaveAttribute('aria-live', 'polite')

    // Link público com texto autoexplicativo (não "clique aqui").
    const link = await screen.findByRole('link', { name: /orçamento/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('uuid.hmac-token'))
    expect(link).not.toHaveAccessibleName(/clique aqui/i)

    // Botão de copiar com aria-label.
    expect(screen.getByRole('button', { name: /copiar link/i })).toBeInTheDocument()

    // Versão listada.
    const versoes = screen.getByRole('list', { name: /versões/i })
    expect(within(versoes).getByText(/versão 1/i)).toBeInTheDocument()
  })

  it('mostra erro quando o envio falha', async () => {
    mockRascunho()
    const { ApiError } = await import('@/services/api')
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'Só é possível enviar rascunhos'))
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    await usuario.click(await screen.findByRole('button', { name: /^enviar$/i }))
    const dialogo = screen.getByRole('dialog')
    await usuario.click(within(dialogo).getByRole('button', { name: /^enviar$/i }))

    expect(await screen.findByText(/não foi possível enviar/i)).toBeInTheDocument()
  })
})

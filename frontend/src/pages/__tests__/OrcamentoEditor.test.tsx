import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { lightTheme } from '@/theme/ni-doc-theme'
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
    <FluentProvider theme={lightTheme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entrada]}>
          <Routes>
            <Route path="/orcamentos/novo" element={<OrcamentoEditor />} />
            <Route path="/orcamentos/:id" element={<OrcamentoEditor />} />
            <Route path="/orcamentos" element={<h1>Lista</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>
  )
}

// Botão primário de salvar (há dois na tela: barra de ação e ações finais).
function botaoSalvar(): HTMLElement {
  return screen.getAllByRole('button', { name: /salvar rascunho/i })[0] as HTMLElement
}

// Preenche cliente/título/um item com valores válidos.
async function preencherValido(usuario: ReturnType<typeof userEvent.setup>): Promise<void> {
  vi.mocked(api.get).mockResolvedValue(CLIENTES)

  const cliente = screen.getByRole('combobox', { name: /cliente/i })
  await usuario.type(cliente, 'Acme')
  await usuario.click(await screen.findByRole('option', { name: /acme ltda/i }))

  await usuario.type(screen.getByRole('textbox', { name: /^título/i }), 'Projeto X')

  const nome = screen.getByRole('textbox', { name: /nome do item 1/i })
  await usuario.type(nome, 'Serviço')
  const quantidade = screen.getByRole('spinbutton', { name: /quantidade do item 1/i })
  await usuario.clear(quantidade)
  await usuario.type(quantidade, '2')
  const valor = screen.getByRole('spinbutton', { name: /valor unitário do item 1/i })
  await usuario.clear(valor)
  await usuario.type(valor, '100')
}

describe('OrcamentoEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.get).mockResolvedValue([])
  })

  it('renderiza os cards principais com os campos de dados', () => {
    render(renderEditor())
    expect(screen.getByRole('heading', { name: /dados do orçamento/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /itens do orçamento/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /condições de pagamento/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /resumo financeiro/i })).toBeInTheDocument()

    expect(screen.getByRole('combobox', { name: /cliente/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^título/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /descrição/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/validade/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/prazo de entrega/i)).toBeInTheDocument()
  })

  it('mostra a tabela de itens com uma linha editável inicial', () => {
    render(renderEditor())
    expect(screen.getByRole('table', { name: /itens do orçamento/i })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /nome do item 1/i })).toBeInTheDocument()
  })

  it('recalcula o total em tempo real e anuncia via aria-live=polite', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    const quantidade = screen.getByRole('spinbutton', { name: /quantidade do item 1/i })
    const valor = screen.getByRole('spinbutton', { name: /valor unitário do item 1/i })
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

    expect(screen.getAllByRole('textbox', { name: /nome do item \d/i })).toHaveLength(1)
    await usuario.click(screen.getByRole('button', { name: /adicionar item/i }))
    expect(screen.getAllByRole('textbox', { name: /nome do item \d/i })).toHaveLength(2)

    // Remoção via menu de ações do item 2.
    await usuario.click(screen.getByRole('button', { name: /ações do item 2/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /remover item 2/i }))
    expect(screen.getAllByRole('textbox', { name: /nome do item \d/i })).toHaveLength(1)
  })

  it('adiciona e remove condições de pagamento e mostra a soma dos percentuais', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    // Nenhuma condição inicialmente: a região de soma existe mas sem badge.
    const regiaoSoma = screen.getByRole('status', { name: /soma dos percentuais/i })
    expect(regiaoSoma).toHaveAttribute('aria-live', 'polite')

    await usuario.click(screen.getByRole('button', { name: /adicionar condição/i }))
    await usuario.click(screen.getByRole('button', { name: /adicionar condição/i }))

    const percentuais = screen.getAllByRole('spinbutton', { name: /percentual da condição/i })
    expect(percentuais).toHaveLength(2)

    await usuario.clear(percentuais[0]!)
    await usuario.type(percentuais[0]!, '60')
    await usuario.clear(percentuais[1]!)
    await usuario.type(percentuais[1]!, '40')

    // Soma = 100 anuncia o badge de sucesso.
    await waitFor(() => expect(regiaoSoma).toHaveTextContent(/soma dos percentuais:\s*100%/i))

    // Remove a segunda condição.
    await usuario.click(screen.getByRole('button', { name: /excluir condição 2/i }))
    expect(
      screen.getAllByRole('spinbutton', { name: /percentual da condição/i }),
    ).toHaveLength(1)
  })

  it('mostra erro de validação quando a soma dos percentuais não é 100', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    await preencherValido(usuario)

    await usuario.click(screen.getByRole('button', { name: /adicionar condição/i }))
    const percentual = screen.getByRole('spinbutton', { name: /percentual da condição 1/i })
    await usuario.clear(percentual)
    await usuario.type(percentual, '30')

    await usuario.click(botaoSalvar())

    expect(await screen.findByText(/soma dos percentuais.*deve ser 100/i)).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('mostra erros de validação vinculados por aria quando o formulário é inválido', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())

    await usuario.click(botaoSalvar())

    const erro = await screen.findByText(/informe o título/i)
    expect(erro).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^título/i })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(api.post).not.toHaveBeenCalled()
  })

  it('salva um rascunho válido via POST com os campos novos e navega para a lista', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.post).mockResolvedValue({ id: 'orc-novo' } as OrcamentoComItens)
    render(renderEditor())

    await preencherValido(usuario)
    await usuario.click(botaoSalvar())

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/orcamentos',
        expect.objectContaining({
          clienteId: 'cli-1',
          titulo: 'Projeto X',
          validadeDias: 30,
          itens: expect.arrayContaining([
            expect.objectContaining({
              nome: 'Serviço',
              quantidade: 2,
              valorUnitario: 100,
              unidade: 'un',
            }),
          ]),
        }),
      ),
    )
    expect(await screen.findByRole('heading', { name: 'Lista' })).toBeInTheDocument()
  })

  it('em modo edição, carrega o orçamento e salva via PUT', async () => {
    const existente: OrcamentoComItens = {
      ...rascunho,
      titulo: 'Reforma',
      descricao: 'desc',
      prazoEntregaDias: 45,
      condicoesPagamento: [],
    }
    vi.mocked(api.get).mockImplementation((caminho: string) => {
      if (caminho === '/orcamentos/orc-1') return Promise.resolve(existente)
      return Promise.resolve([])
    })
    vi.mocked(api.put).mockResolvedValue(existente)
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    expect(await screen.findByDisplayValue('Reforma')).toBeInTheDocument()
    await usuario.click(botaoSalvar())

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/orcamentos/orc-1',
        expect.objectContaining({
          titulo: 'Reforma',
          clienteId: 'cli-1',
          prazoEntregaDias: 45,
        }),
      ),
    )
  })

  // ---------------------------------------------------------------------------
  // Envio e versionamento (RF-008).
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
    prazoEntregaDias: null,
    descontoGlobalTipo: null,
    descontoGlobalValor: null,
    subtotal: 200,
    total: 200,
    versaoAtual: 0,
    observacoes: null,
    condicoesPagamento: [],
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
    expect((await screen.findAllByRole('button', { name: /^enviar$/i })).length).toBeGreaterThan(0)
  })

  it('abre um modal de confirmação ao clicar em Enviar e cancela sem enviar', async () => {
    mockRascunho()
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    const enviar = (await screen.findAllByRole('button', { name: /^enviar$/i }))[0]!
    await usuario.click(enviar)
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

    const enviar = (await screen.findAllByRole('button', { name: /^enviar$/i }))[0]!
    await usuario.click(enviar)
    const dialogo = screen.getByRole('dialog')
    await usuario.click(within(dialogo).getByRole('button', { name: /^enviar$/i }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orcamentos/orc-1/enviar'))

    const status = await screen.findByRole('status', { name: /envio/i })
    expect(status).toHaveAttribute('aria-live', 'polite')

    const link = await screen.findByRole('link', { name: /orçamento/i })
    expect(link).toHaveAttribute('href', expect.stringContaining('uuid.hmac-token'))
    expect(link).not.toHaveAccessibleName(/clique aqui/i)

    expect(screen.getByRole('button', { name: /copiar link/i })).toBeInTheDocument()

    const versoes = screen.getByRole('list', { name: /versões/i })
    expect(within(versoes).getByText(/versão 1/i)).toBeInTheDocument()
  })

  it('mostra erro quando o envio falha', async () => {
    mockRascunho()
    const { ApiError } = await import('@/services/api')
    vi.mocked(api.post).mockRejectedValue(new ApiError(409, 'Só é possível enviar rascunhos'))
    const usuario = userEvent.setup()
    render(renderEditor('/orcamentos/orc-1'))

    const enviar = (await screen.findAllByRole('button', { name: /^enviar$/i }))[0]!
    await usuario.click(enviar)
    const dialogo = screen.getByRole('dialog')
    await usuario.click(within(dialogo).getByRole('button', { name: /^enviar$/i }))

    expect(await screen.findByText(/não foi possível enviar/i)).toBeInTheDocument()
  })
})

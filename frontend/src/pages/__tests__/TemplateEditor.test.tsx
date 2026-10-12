import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { TemplateEditor } from '@/pages/TemplateEditor'
import type { LayoutTemplate, TemplatePublico } from '@/types/api'

vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  }
})

const { api } = await import('@/services/api')

const LAYOUT_VAZIO: LayoutTemplate = {
  versao: 1,
  paginas: [{ fundo: null, largura: 210, altura: 297, elementos: [] }],
  fontes: [],
}

const TEMPLATE: TemplatePublico = {
  id: 'tpl-1',
  tenantId: 't1',
  versao: 1,
  layoutJson: LAYOUT_VAZIO,
  criadoEm: '2025-01-10T12:00:00.000Z',
}

function renderEditor(): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TemplateEditor />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('TemplateEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.get).mockResolvedValue(TEMPLATE)
  })

  it('renderiza o editor com canvas A4 e controles principais', async () => {
    render(renderEditor())
    // Aguarda o canvas (só existe no estado carregado) para evitar latch no
    // heading transitório do estado de carregamento.
    expect(await screen.findByRole('group', { name: /canvas a4/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /editor de template/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /adicionar texto/i })).toBeInTheDocument()
  })

  it('tem inputs de upload com label associado (fundo, imagem, fonte)', async () => {
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })
    expect(screen.getByLabelText(/carregar arquivo base/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/adicionar imagem/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/enviar fonte customizada/i)).toBeInTheDocument()
  })

  it('adiciona um elemento de texto ao canvas', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.click(screen.getByRole('button', { name: /adicionar texto/i }))
    expect(screen.getByRole('button', { name: /texto: novo texto/i })).toBeInTheDocument()
  })

  it('insere um placeholder no texto selecionado', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.click(screen.getByRole('button', { name: /adicionar texto/i }))
    // Limpa o conteúdo e insere o placeholder {cliente}.
    const conteudo = screen.getByLabelText(/^conteúdo/i)
    await usuario.clear(conteudo)
    await usuario.click(screen.getByRole('button', { name: /inserir placeholder \{cliente\}/i }))
    expect(conteudo).toHaveValue('{cliente}')
  })

  it('reposiciona o elemento selecionado pelos campos numéricos (alternativa ao mouse)', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.click(screen.getByRole('button', { name: /adicionar texto/i }))
    const posY = screen.getByLabelText(/posição vertical/i)
    // Acrescenta um dígito à posição Y inicial (20 → 205); o canvas reflete a
    // nova posição no nome acessível do elemento, provando o reposicionamento
    // via campo numérico (operável só por teclado). 205 cabe na altura A4
    // (297 − 10 de altura do texto = 287), então não há recorte.
    await usuario.type(posY, '5')

    expect(screen.getByRole('button', { name: /posição 20 por 205/i })).toBeInTheDocument()
    expect(posY).toHaveValue(205)
  })

  it('salva o template via PUT e anuncia a nova versão', async () => {
    const usuario = userEvent.setup()
    vi.mocked(api.put).mockResolvedValue({ ...TEMPLATE, versao: 2 })
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.click(screen.getByRole('button', { name: /adicionar texto/i }))
    await usuario.click(screen.getByRole('button', { name: /salvar template/i }))

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        '/templates/atual',
        expect.objectContaining({
          layoutJson: expect.objectContaining({ paginas: expect.any(Array) }),
        }),
      ),
    )

    const status = screen.getByRole('status', { name: /salvamento/i })
    await waitFor(() => expect(status).toHaveTextContent(/versão 2 criada/i))
  })

  it('mostra erro quando o salvamento falha (ex.: operador sem permissão)', async () => {
    const usuario = userEvent.setup()
    const { ApiError } = await import('@/services/api')
    vi.mocked(api.put).mockRejectedValue(new ApiError(403, 'Acesso negado'))
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.click(screen.getByRole('button', { name: /salvar template/i }))
    expect(await screen.findByText(/não foi possível salvar o template/i)).toBeInTheDocument()
  })

  it('agrupa fontes por família ao enviar (RF-014.6)', async () => {
    const usuario = userEvent.setup()
    render(renderEditor())
    await screen.findByRole('group', { name: /canvas a4/i })

    await usuario.type(screen.getByLabelText(/fonte do documento/i), 'Inter')
    const arquivo = new File(['fake'], 'inter.woff2', { type: 'font/woff2' })
    await usuario.upload(screen.getByLabelText(/enviar fonte customizada/i), arquivo)

    const lista = await screen.findByRole('list', { name: /fontes carregadas/i })
    expect(within(lista).getByText(/inter \(woff2\)/i)).toBeInTheDocument()
  })
})

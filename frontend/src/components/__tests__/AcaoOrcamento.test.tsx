import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FluentProvider } from '@fluentui/react-components'
import { AcaoOrcamento } from '@/components/AcaoOrcamento'
import { lightTheme } from '@/theme/ni-doc-theme'
import { ApiError } from '@/services/api'
import type { OrcamentoStatus } from '@/types/api'

vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  }
})
const { api } = await import('@/services/api')

function renderAcao(status: OrcamentoStatus): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <FluentProvider theme={lightTheme}>
      <QueryClientProvider client={queryClient}>
        <AcaoOrcamento id="orc-1" numero="ORC-2025-0001" status={status} />
      </QueryClientProvider>
    </FluentProvider>
  )
}

describe('AcaoOrcamento — ações por status', () => {
  it.each<OrcamentoStatus>(['enviado', 'aprovado'])(
    'oferece "Cancelar orçamento" (e não "Reabrir") para %s',
    (status) => {
      render(renderAcao(status))
      expect(screen.getByRole('button', { name: /cancelar orçamento/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /reabrir orçamento/i })).not.toBeInTheDocument()
    },
  )

  it.each<OrcamentoStatus>(['reprovado', 'cancelado', 'expirado'])(
    'oferece "Reabrir orçamento" (e não "Cancelar") para %s',
    (status) => {
      render(renderAcao(status))
      expect(screen.getByRole('button', { name: /reabrir orçamento/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /cancelar orçamento/i })).not.toBeInTheDocument()
    },
  )

  it('não renderiza ação para rascunho', () => {
    const { container } = render(renderAcao('rascunho'))
    expect(container.querySelector('button')).toBeNull()
  })
})

describe('AcaoOrcamento — diálogo de confirmação', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function abrir(status: OrcamentoStatus, nomeGatilho: RegExp) {
    const usuario = userEvent.setup()
    render(renderAcao(status))
    const gatilho = screen.getByRole('button', { name: nomeGatilho })
    await usuario.click(gatilho)
    const dialogo = await screen.findByRole('dialog')
    return { usuario, gatilho, dialogo }
  }

  it('abre com campos Senha e Justificativa rotulados', async () => {
    await abrir('enviado', /cancelar orçamento/i)
    expect(screen.getByLabelText(/senha/i)).toHaveAttribute('type', 'password')
    expect(screen.getByLabelText(/justificativa/i)).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /cancelar orçamento/i })).toBeInTheDocument()
  })

  it('valida campos obrigatórios com aria-invalid e mensagem anunciada', async () => {
    const { usuario, dialogo } = await abrir('enviado', /cancelar orçamento/i)
    await usuario.click(screen.getByRole('button', { name: 'Cancelar orçamento' }))
    const senha = await screen.findByLabelText(/senha/i)
    await waitFor(() => expect(senha).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByLabelText(/justificativa/i)).toHaveAttribute('aria-invalid', 'true')
    expect(senha).toHaveAttribute('aria-describedby')
    expect(dialogo.querySelectorAll('[role="alert"], [aria-live]').length).toBeGreaterThan(0)
    expect(api.post).not.toHaveBeenCalled()
  })

  it('envia senha e justificativa para /cancelar e fecha o diálogo', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'orc-1', status: 'cancelado' })
    const { usuario } = await abrir('aprovado', /cancelar orçamento/i)
    await usuario.type(screen.getByLabelText(/senha/i), 'Segredo123')
    await usuario.type(screen.getByLabelText(/justificativa/i), 'Cliente desistiu')
    await usuario.click(screen.getByRole('button', { name: 'Cancelar orçamento' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orcamentos/orc-1/cancelar', {
        senha: 'Segredo123',
        justificativa: 'Cliente desistiu',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('envia para /reabrir quando o status é cancelado', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ id: 'orc-1', status: 'rascunho' })
    const { usuario } = await abrir('cancelado', /reabrir orçamento/i)
    await usuario.type(screen.getByLabelText(/senha/i), 'Segredo123')
    await usuario.type(screen.getByLabelText(/justificativa/i), 'Retomado')
    await usuario.click(screen.getByRole('button', { name: 'Reabrir orçamento' }))
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/orcamentos/orc-1/reabrir', {
        senha: 'Segredo123',
        justificativa: 'Retomado',
      }),
    )
  })

  it('mostra mensagem genérica para senha incorreta (403), sem detalhes do servidor', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(403, 'detalhe interno do servidor'))
    const { usuario } = await abrir('enviado', /cancelar orçamento/i)
    await usuario.type(screen.getByLabelText(/senha/i), 'errada')
    await usuario.type(screen.getByLabelText(/justificativa/i), 'Motivo')
    await usuario.click(screen.getByRole('button', { name: 'Cancelar orçamento' }))
    expect(await screen.findByText(/senha incorreta/i)).toBeInTheDocument()
    expect(screen.queryByText(/detalhe interno/i)).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toHaveValue('')
  })

  it('Esc fecha o diálogo e devolve o foco ao gatilho', async () => {
    const { usuario, gatilho } = await abrir('enviado', /cancelar orçamento/i)
    await usuario.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(gatilho).toHaveFocus())
    expect(api.post).not.toHaveBeenCalled()
  })

  it('botão "Voltar" fecha sem enviar', async () => {
    const { usuario } = await abrir('enviado', /cancelar orçamento/i)
    await usuario.click(screen.getByRole('button', { name: /voltar/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.post).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement, ReactNode } from 'react'
import { ItemOrcamentoRow, type ItemFormulario } from '@/components/ItemOrcamentoRow'

vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: { get: vi.fn().mockResolvedValue([]), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  }
})

const ITEM: ItemFormulario = {
  nome: 'Serviço de pintura',
  quantidade: 2,
  valorUnitario: 150,
  descontoTipo: '',
  descontoValor: 0,
  responsavelId: '',
  responsavelNome: '',
}

function wrapper(children: ReactNode): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('ItemOrcamentoRow', () => {
  it('agrupa os campos do item em um fieldset com legend', () => {
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={vi.fn()}
          aoRemover={vi.fn()}
          podeRemover
        />,
      ),
    )
    expect(screen.getByRole('group', { name: /item 1/i })).toBeInTheDocument()
  })

  it('tem campos rotulados para nome, quantidade e valor unitário', () => {
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={vi.fn()}
          aoRemover={vi.fn()}
          podeRemover
        />,
      ),
    )
    expect(screen.getByLabelText(/nome/i)).toHaveValue('Serviço de pintura')
    expect(screen.getByLabelText(/quantidade/i)).toHaveValue(2)
    expect(screen.getByLabelText(/valor unitário/i)).toHaveValue(150)
  })

  it('exibe o total do item calculado', () => {
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={vi.fn()}
          aoRemover={vi.fn()}
          podeRemover
        />,
      ),
    )
    // 2 * 150 = 300
    expect(screen.getByText(/R\$\s?300,00/)).toBeInTheDocument()
  })

  it('chama aoMudar ao editar a quantidade', async () => {
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={aoMudar}
          aoRemover={vi.fn()}
          podeRemover
        />,
      ),
    )
    const quantidade = screen.getByLabelText(/quantidade/i)
    await usuario.clear(quantidade)
    await usuario.type(quantidade, '5')
    expect(aoMudar).toHaveBeenCalled()
  })

  it('aciona aoRemover pelo botão rotulado', async () => {
    const aoRemover = vi.fn()
    const usuario = userEvent.setup()
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={vi.fn()}
          aoRemover={aoRemover}
          podeRemover
        />,
      ),
    )
    await usuario.click(screen.getByRole('button', { name: /remover item 1/i }))
    expect(aoRemover).toHaveBeenCalled()
  })

  it('desabilita a remoção quando não é permitido remover', () => {
    render(
      wrapper(
        <ItemOrcamentoRow
          indice={0}
          item={ITEM}
          aoMudar={vi.fn()}
          aoRemover={vi.fn()}
          podeRemover={false}
        />,
      ),
    )
    expect(screen.getByRole('button', { name: /remover item 1/i })).toBeDisabled()
  })
})

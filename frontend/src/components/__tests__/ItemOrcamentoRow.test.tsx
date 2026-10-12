import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FluentProvider, Table, TableBody } from '@fluentui/react-components'
import type { ReactElement, ReactNode } from 'react'
import { lightTheme } from '@/theme/ni-doc-theme'
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
  unidade: 'un',
  valorUnitario: 150,
  descontoTipo: '',
  descontoValor: 0,
  responsavelId: '',
  responsavelNome: '',
}

// Envolve a linha num contexto de tabela Fluent + tema, como no editor.
function renderRow(props: Partial<Parameters<typeof ItemOrcamentoRow>[0]> = {}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const children: ReactNode = (
    <ItemOrcamentoRow
      indice={0}
      item={ITEM}
      aoMudar={vi.fn()}
      aoRemover={vi.fn()}
      podeRemover
      {...props}
    />
  )
  const arvore: ReactElement = (
    <FluentProvider theme={lightTheme}>
      <QueryClientProvider client={queryClient}>
        <Table aria-label="Itens">
          <TableBody>{children}</TableBody>
        </Table>
      </QueryClientProvider>
    </FluentProvider>
  )
  render(arvore)
}

describe('ItemOrcamentoRow', () => {
  it('renderiza como uma linha de tabela', () => {
    renderRow()
    expect(screen.getByRole('row')).toBeInTheDocument()
  })

  it('tem campos rotulados para nome, quantidade e valor unitário', () => {
    renderRow()
    expect(screen.getByRole('textbox', { name: /nome do item 1/i })).toHaveValue(
      'Serviço de pintura',
    )
    expect(screen.getByRole('spinbutton', { name: /quantidade do item 1/i })).toHaveValue(2)
    expect(screen.getByRole('spinbutton', { name: /valor unitário do item 1/i })).toHaveValue(150)
  })

  it('exibe o total do item calculado', () => {
    renderRow()
    // 2 * 150 = 300
    expect(screen.getByText(/R\$\s?300,00/)).toBeInTheDocument()
  })

  it('chama aoMudar ao editar a quantidade', async () => {
    const aoMudar = vi.fn()
    const usuario = userEvent.setup()
    renderRow({ aoMudar })
    const quantidade = screen.getByRole('spinbutton', { name: /quantidade do item 1/i })
    await usuario.clear(quantidade)
    await usuario.type(quantidade, '5')
    expect(aoMudar).toHaveBeenCalled()
  })

  it('aciona aoRemover pelo menu de ações', async () => {
    const aoRemover = vi.fn()
    const usuario = userEvent.setup()
    renderRow({ aoRemover })
    await usuario.click(screen.getByRole('button', { name: /ações do item 1/i }))
    await usuario.click(await screen.findByRole('menuitem', { name: /remover item 1/i }))
    expect(aoRemover).toHaveBeenCalled()
  })

  it('desabilita a remoção quando não é permitido remover', async () => {
    const usuario = userEvent.setup()
    renderRow({ podeRemover: false })
    await usuario.click(screen.getByRole('button', { name: /ações do item 1/i }))
    expect(await screen.findByRole('menuitem', { name: /remover item 1/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })
})

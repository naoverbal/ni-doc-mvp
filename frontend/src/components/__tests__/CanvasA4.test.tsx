import { describe, it, expect, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { CanvasA4 } from '@/components/CanvasA4'
import type { ElementoTemplate } from '@/types/api'

function elementoTexto(over: Partial<ElementoTemplate> = {}): ElementoTemplate {
  return {
    id: 'el-1',
    tipo: 'texto',
    x: 50,
    y: 50,
    largura: 80,
    altura: 10,
    conteudo: '{cliente}',
    fonte: 'Inter',
    tamanho: 12,
    alinhamento: 'left',
    cor: '#000000',
    nivelTitulo: 0,
    ...(over as object),
  } as ElementoTemplate
}

// Wrapper controlado para refletir o movimento no re-render, como no editor.
function CanvasControlado({ inicial }: { inicial: ElementoTemplate }) {
  const [el, setEl] = useState(inicial)
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  return (
    <CanvasA4
      elementos={[el]}
      selecionadoId={selecionadoId}
      aoSelecionar={setSelecionadoId}
      aoMover={(id, x, y) => setEl((atual) => ({ ...atual, x, y }))}
    />
  )
}

describe('CanvasA4', () => {
  it('expõe o canvas como grupo nomeado e cada elemento como botão com nome acessível', () => {
    render(
      <CanvasA4
        elementos={[elementoTexto()]}
        selecionadoId={null}
        aoSelecionar={vi.fn()}
        aoMover={vi.fn()}
      />,
    )
    expect(screen.getByRole('group', { name: /canvas a4/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /texto: \{cliente\}/i })).toBeInTheDocument()
  })

  it('seleciona o elemento ao focar e marca aria-pressed', async () => {
    const usuario = userEvent.setup()
    render(<CanvasControlado inicial={elementoTexto()} />)
    const botao = screen.getByRole('button', { name: /texto: \{cliente\}/i })
    await usuario.tab()
    expect(botao).toHaveFocus()
    expect(botao).toHaveAttribute('aria-pressed', 'true')
  })

  it('move o elemento pelas setas do teclado (passo fino de 1mm)', async () => {
    const usuario = userEvent.setup()
    render(<CanvasControlado inicial={elementoTexto({ x: 50, y: 50 })} />)
    const botao = screen.getByRole('button', { name: /texto/i })
    act(() => botao.focus())

    await usuario.keyboard('{ArrowRight}')
    expect(screen.getByRole('button', { name: /posição 51 por 50/i })).toBeInTheDocument()

    await usuario.keyboard('{ArrowDown}')
    expect(screen.getByRole('button', { name: /posição 51 por 51/i })).toBeInTheDocument()
  })

  it('usa passo maior (10mm) com Shift', async () => {
    const usuario = userEvent.setup()
    render(<CanvasControlado inicial={elementoTexto({ x: 50, y: 50 })} />)
    act(() => screen.getByRole('button', { name: /texto/i }).focus())

    await usuario.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(screen.getByRole('button', { name: /posição 60 por 50/i })).toBeInTheDocument()
  })

  it('não deixa o elemento sair do canvas (limita em 0)', async () => {
    const usuario = userEvent.setup()
    render(<CanvasControlado inicial={elementoTexto({ x: 0, y: 0 })} />)
    act(() => screen.getByRole('button', { name: /texto/i }).focus())

    await usuario.keyboard('{ArrowLeft}{ArrowUp}')
    expect(screen.getByRole('button', { name: /posição 0 por 0/i })).toBeInTheDocument()
  })
})

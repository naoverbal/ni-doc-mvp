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

  // Preview em tempo real (correção do bug): o elemento de imagem deve
  // renderizar um <img> real a partir do data URL, não só uma caixa cinza.
  it('renderiza o <img> da imagem a partir do data URL (preview em tempo real)', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const imagem = {
      id: 'img-1',
      tipo: 'imagem',
      x: 10,
      y: 10,
      largura: 40,
      altura: 40,
      src: dataUrl,
      ajuste: 'contain',
      rotacao: 0,
      descricao: 'Logotipo da empresa',
    } as ElementoTemplate
    render(
      <CanvasA4
        elementos={[imagem]}
        selecionadoId={null}
        aoSelecionar={vi.fn()}
        aoMover={vi.fn()}
      />,
    )
    const img = screen.getByRole('img', { name: 'Logotipo da empresa' })
    expect(img).toHaveAttribute('src', dataUrl)
  })

  it('usa alt vazio (decorativa) quando a imagem não tem descrição', () => {
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
    const imagem = {
      id: 'img-2',
      tipo: 'imagem',
      x: 10,
      y: 10,
      largura: 40,
      altura: 40,
      src: dataUrl,
      ajuste: 'contain',
      rotacao: 0,
      descricao: '',
    } as ElementoTemplate
    const { container } = render(
      <CanvasA4
        elementos={[imagem]}
        selecionadoId={null}
        aoSelecionar={vi.fn()}
        aoMover={vi.fn()}
      />,
    )
    const img = container.querySelector('button img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('src', dataUrl)
  })

  it('renderiza o fundo de imagem (data URL) atrás dos elementos como <img> decorativo', () => {
    const fundo = 'data:image/png;base64,QUJD'
    const { container } = render(
      <CanvasA4
        elementos={[elementoTexto()]}
        selecionadoId={null}
        aoSelecionar={vi.fn()}
        aoMover={vi.fn()}
        fundo={fundo}
      />,
    )
    const canvas = screen.getByRole('group', { name: /canvas a4/i })
    // O fundo é o primeiro filho (atrás), decorativo (aria-hidden, alt vazio).
    const img = canvas.querySelector(':scope > img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', fundo)
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
    // Confirma que não vira name acessível: nenhuma img exposta por papel.
    expect(screen.queryByRole('img')).toBeNull()
    expect(container).toBeTruthy()
  })

  it('renderiza o fundo de PDF (data URL) via <embed> decorativo', () => {
    const fundo = 'data:application/pdf;base64,JVBERi0xLjQK'
    render(
      <CanvasA4
        elementos={[elementoTexto()]}
        selecionadoId={null}
        aoSelecionar={vi.fn()}
        aoMover={vi.fn()}
        fundo={fundo}
      />,
    )
    const canvas = screen.getByRole('group', { name: /canvas a4/i })
    const embed = canvas.querySelector('embed')
    expect(embed).not.toBeNull()
    expect(embed).toHaveAttribute('src', fundo)
    expect(embed).toHaveAttribute('type', 'application/pdf')
    expect(embed).toHaveAttribute('aria-hidden', 'true')
  })
})

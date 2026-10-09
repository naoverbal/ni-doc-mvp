import { useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from 'react'
import type { ElementoTemplate } from '@/types/api'

// Dimensões do canvas A4 em milímetros (RF-014.1).
export const LARGURA_A4_MM = 210
export const ALTURA_A4_MM = 297

// Escala de exibição: pixels por milímetro. O canvas é renderizado em
// LARGURA_A4_MM * ESCALA por ALTURA_A4_MM * ESCALA pixels.
const ESCALA = 2.5

// Passo (mm) de movimento por tecla de seta. Shift aplica o passo maior para
// ajuste grosso; o passo fino permite posicionamento preciso só pelo teclado.
const PASSO_FINO = 1
const PASSO_GROSSO = 10

export interface CanvasA4Props {
  elementos: ElementoTemplate[]
  // Id do elemento atualmente selecionado (destacado), ou null.
  selecionadoId: string | null
  aoSelecionar: (id: string | null) => void
  // Reposiciona um elemento (x/y em mm, já limitados ao canvas pelo pai).
  aoMover: (id: string, x: number, y: number) => void
}

// Rótulo acessível legível de um elemento, usado em aria-label e no texto
// visível de referência.
function rotuloElemento(el: ElementoTemplate): string {
  if (el.tipo === 'texto') return `Texto: ${el.conteudo || '(vazio)'}`
  if (el.tipo === 'imagem') return `Imagem: ${el.descricao || '(sem descrição)'}`
  return 'Área de itens'
}

// Limita um valor ao intervalo [min, max].
function limitar(valor: number, min: number, max: number): number {
  return Math.min(Math.max(valor, min), max)
}

/**
 * Canvas A4 do editor de template (RF-014). Renderiza os elementos posicionados
 * em milímetros e oferece DUAS formas de reposicionar, atendendo WCAG AA:
 *
 *  - Mouse/ponteiro: arrastar o elemento (pointer events);
 *  - Teclado: selecionar o elemento com Tab/Enter e movê-lo com as setas
 *    (Shift = passo maior). A alternativa por teclado é obrigatória: nenhuma
 *    ação depende exclusivamente do arrastar.
 *
 * Cada elemento é um botão focável com nome acessível próprio; o estado de
 * seleção é transmitido por `aria-pressed` e por rótulo textual (não só cor).
 */
export function CanvasA4({
  elementos,
  selecionadoId,
  aoSelecionar,
  aoMover,
}: CanvasA4Props): ReactElement {
  const canvasRef = useRef<HTMLDivElement>(null)
  // Estado do arraste em andamento (null quando não há arraste).
  const [arraste, setArraste] = useState<{
    id: string
    offsetX: number
    offsetY: number
  } | null>(null)

  const maxX = (el: ElementoTemplate): number => Math.max(0, LARGURA_A4_MM - el.largura)
  const maxY = (el: ElementoTemplate): number => Math.max(0, ALTURA_A4_MM - el.altura)

  function aoPressionar(evento: PointerEvent<HTMLButtonElement>, el: ElementoTemplate): void {
    aoSelecionar(el.id)
    const retangulo = canvasRef.current?.getBoundingClientRect()
    if (!retangulo) return
    // Deslocamento (mm) entre o ponto clicado e o canto do elemento.
    const ponteiroXmm = (evento.clientX - retangulo.left) / ESCALA
    const ponteiroYmm = (evento.clientY - retangulo.top) / ESCALA
    setArraste({ id: el.id, offsetX: ponteiroXmm - el.x, offsetY: ponteiroYmm - el.y })
    evento.currentTarget.setPointerCapture(evento.pointerId)
  }

  function aoMoverPonteiro(evento: PointerEvent<HTMLButtonElement>, el: ElementoTemplate): void {
    if (!arraste || arraste.id !== el.id) return
    const retangulo = canvasRef.current?.getBoundingClientRect()
    if (!retangulo) return
    const ponteiroXmm = (evento.clientX - retangulo.left) / ESCALA
    const ponteiroYmm = (evento.clientY - retangulo.top) / ESCALA
    const novoX = limitar(ponteiroXmm - arraste.offsetX, 0, maxX(el))
    const novoY = limitar(ponteiroYmm - arraste.offsetY, 0, maxY(el))
    aoMover(el.id, Math.round(novoX), Math.round(novoY))
  }

  function aoSoltar(evento: PointerEvent<HTMLButtonElement>): void {
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId)
    }
    setArraste(null)
  }

  // Movimento por teclado: setas movem; Shift aumenta o passo. Previne o scroll
  // da página quando o elemento está focado.
  function aoTeclar(evento: KeyboardEvent<HTMLButtonElement>, el: ElementoTemplate): void {
    const passo = evento.shiftKey ? PASSO_GROSSO : PASSO_FINO
    let dx = 0
    let dy = 0
    switch (evento.key) {
      case 'ArrowLeft':
        dx = -passo
        break
      case 'ArrowRight':
        dx = passo
        break
      case 'ArrowUp':
        dy = -passo
        break
      case 'ArrowDown':
        dy = passo
        break
      default:
        return
    }
    evento.preventDefault()
    aoSelecionar(el.id)
    aoMover(el.id, limitar(el.x + dx, 0, maxX(el)), limitar(el.y + dy, 0, maxY(el)))
  }

  return (
    <div
      ref={canvasRef}
      data-testid="canvas-a4"
      role="group"
      aria-label="Canvas A4 do template (210 por 297 milímetros)"
      style={{
        position: 'relative',
        width: `${LARGURA_A4_MM * ESCALA}px`,
        height: `${ALTURA_A4_MM * ESCALA}px`,
        border: '1px solid #333',
        background: '#fff',
      }}
    >
      {elementos.map((el) => {
        const selecionado = el.id === selecionadoId
        const rotulo = rotuloElemento(el)
        return (
          <button
            key={el.id}
            type="button"
            // Nome acessível que inclui tipo, conteúdo e posição atual, para o
            // movimento por teclado ser perceptível sem depender da visão.
            aria-label={`${rotulo}. Posição ${el.x} por ${el.y} milímetros. Use as setas para mover.`}
            aria-pressed={selecionado}
            onPointerDown={(e) => aoPressionar(e, el)}
            onPointerMove={(e) => aoMoverPonteiro(e, el)}
            onPointerUp={aoSoltar}
            onPointerCancel={aoSoltar}
            onKeyDown={(e) => aoTeclar(e, el)}
            onFocus={() => aoSelecionar(el.id)}
            style={{
              position: 'absolute',
              left: `${el.x * ESCALA}px`,
              top: `${el.y * ESCALA}px`,
              width: `${el.largura * ESCALA}px`,
              height: `${el.altura * ESCALA}px`,
              // Seleção sinalizada por borda contínua vs. tracejada E texto no
              // aria-label (não só por cor), conforme WCAG 1.4.1.
              border: selecionado ? '2px solid #1a4480' : '1px dashed #767676',
              background: el.tipo === 'imagem' ? '#f0f0f0' : 'transparent',
              textAlign: 'left',
              overflow: 'hidden',
              cursor: 'move',
              font: 'inherit',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 12, color: '#1a1a1a' }}>
              {el.tipo === 'texto' && el.conteudo}
              {el.tipo === 'imagem' && (el.descricao || 'Imagem')}
              {el.tipo === 'area-itens' && 'Área de itens'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

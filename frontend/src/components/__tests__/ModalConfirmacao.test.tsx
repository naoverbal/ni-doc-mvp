import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState, type ReactElement } from 'react'
import { ModalConfirmacao } from '@/components/ModalConfirmacao'

// Monta um host que controla o estado do modal e preserva o botão gatilho, para
// exercitar a gestão de foco (foco entra ao abrir, retorna ao gatilho ao fechar).
function Host(): ReactElement {
  const [aberto, setAberto] = useState(false)
  const gatilhoRef = useRef<HTMLButtonElement>(null)

  return (
    <div>
      <button ref={gatilhoRef} type="button" onClick={() => setAberto(true)}>
        Abrir
      </button>
      {aberto && (
        <ModalConfirmacao
          titulo="Enviar orçamento"
          descricao="Esta ação cria uma versão imutável."
          rotuloConfirmar="Enviar"
          rotuloCancelar="Cancelar"
          aoConfirmar={() => setAberto(false)}
          aoCancelar={() => setAberto(false)}
          elementoGatilho={gatilhoRef}
        />
      )}
      <button type="button">Fora</button>
    </div>
  )
}

describe('ModalConfirmacao', () => {
  it('renderiza um diálogo com role=dialog, aria-modal e nome acessível', async () => {
    const usuario = userEvent.setup()
    render(<Host />)
    await usuario.click(screen.getByRole('button', { name: /abrir/i }))

    const dialogo = screen.getByRole('dialog')
    expect(dialogo).toHaveAttribute('aria-modal', 'true')
    expect(dialogo).toHaveAccessibleName(/enviar orçamento/i)
  })

  it('move o foco para dentro do diálogo ao abrir', async () => {
    const usuario = userEvent.setup()
    render(<Host />)
    await usuario.click(screen.getByRole('button', { name: /abrir/i }))

    const dialogo = screen.getByRole('dialog')
    expect(dialogo.contains(document.activeElement)).toBe(true)
  })

  it('fecha com Esc e devolve o foco ao gatilho', async () => {
    const usuario = userEvent.setup()
    render(<Host />)
    const gatilho = screen.getByRole('button', { name: /abrir/i })
    await usuario.click(gatilho)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await usuario.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(document.activeElement).toBe(gatilho)
  })

  it('prende o foco dentro do diálogo com Tab (focus trap)', async () => {
    const usuario = userEvent.setup()
    render(<Host />)
    await usuario.click(screen.getByRole('button', { name: /abrir/i }))

    const confirmar = screen.getByRole('button', { name: 'Enviar' })
    const cancelar = screen.getByRole('button', { name: 'Cancelar' })

    // Com dois botões, Tab circula entre eles sem escapar para "Fora".
    await usuario.tab()
    expect([confirmar, cancelar]).toContain(document.activeElement)
    await usuario.tab()
    expect([confirmar, cancelar]).toContain(document.activeElement)
    await usuario.tab()
    expect([confirmar, cancelar]).toContain(document.activeElement)
    expect(screen.getByRole('button', { name: /fora/i })).not.toBe(document.activeElement)
  })

  it('chama aoConfirmar e aoCancelar nos respectivos botões', async () => {
    const usuario = userEvent.setup()
    const aoConfirmar = vi.fn()
    const aoCancelar = vi.fn()
    render(
      <ModalConfirmacao
        titulo="Confirmar"
        rotuloConfirmar="Sim"
        rotuloCancelar="Não"
        aoConfirmar={aoConfirmar}
        aoCancelar={aoCancelar}
      />,
    )

    await usuario.click(screen.getByRole('button', { name: 'Sim' }))
    expect(aoConfirmar).toHaveBeenCalledTimes(1)

    await usuario.click(screen.getByRole('button', { name: 'Não' }))
    expect(aoCancelar).toHaveBeenCalledTimes(1)
  })
})

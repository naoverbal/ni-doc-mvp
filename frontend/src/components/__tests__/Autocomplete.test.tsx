import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Autocomplete, type OpcaoAutocomplete } from '@/components/Autocomplete'

const OPCOES: OpcaoAutocomplete[] = [
  { id: '1', rotulo: 'Ana Silva' },
  { id: '2', rotulo: 'Bruno Costa' },
  { id: '3', rotulo: 'Carla Dias' },
]

// Harness controlado: filtra as opções pelo texto digitado, como faria a página
// com o resultado de uma query. Mantém o teste focado no comportamento do combobox.
function Harness({ aoSelecionar }: { aoSelecionar?: (op: OpcaoAutocomplete) => void }) {
  const [texto, setTexto] = useState('')
  const [selecionado, setSelecionado] = useState<OpcaoAutocomplete | null>(null)
  const opcoes = texto
    ? OPCOES.filter((o) => o.rotulo.toLowerCase().includes(texto.toLowerCase()))
    : []

  return (
    <Autocomplete
      id="resp"
      rotulo="Responsável"
      texto={texto}
      aoMudarTexto={setTexto}
      opcoes={opcoes}
      selecionado={selecionado}
      aoSelecionar={(op) => {
        setSelecionado(op)
        setTexto(op.rotulo)
        aoSelecionar?.(op)
      }}
    />
  )
}

describe('Autocomplete', () => {
  it('expõe um combobox com rótulo associado', () => {
    render(<Harness />)
    const campo = screen.getByRole('combobox', { name: /responsável/i })
    expect(campo).toHaveAttribute('aria-expanded', 'false')
  })

  it('abre a listbox e marca aria-expanded ao digitar resultados', async () => {
    const usuario = userEvent.setup()
    render(<Harness />)

    const campo = screen.getByRole('combobox', { name: /responsável/i })
    await usuario.type(campo, 'a')

    expect(campo).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0)
  })

  it('navega pelas opções com as setas e marca aria-activedescendant', async () => {
    const usuario = userEvent.setup()
    render(<Harness />)

    const campo = screen.getByRole('combobox', { name: /responsável/i })
    await usuario.type(campo, 'a')
    await usuario.keyboard('{ArrowDown}')

    const ativo = campo.getAttribute('aria-activedescendant')
    expect(ativo).toBeTruthy()
    const opcaoAtiva = document.getElementById(ativo as string)
    expect(opcaoAtiva).toHaveAttribute('aria-selected', 'true')
  })

  it('seleciona a opção destacada com Enter e anuncia a seleção', async () => {
    const aoSelecionar = vi.fn()
    const usuario = userEvent.setup()
    render(<Harness aoSelecionar={aoSelecionar} />)

    const campo = screen.getByRole('combobox', { name: /responsável/i })
    await usuario.type(campo, 'Bru')
    await usuario.keyboard('{ArrowDown}{Enter}')

    expect(aoSelecionar).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }))
    // A listbox fecha após a seleção.
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // Seleção anunciada por região aria-live.
    expect(screen.getByRole('status')).toHaveTextContent(/bruno costa/i)
  })

  it('fecha a listbox ao pressionar Escape', async () => {
    const usuario = userEvent.setup()
    render(<Harness />)

    const campo = screen.getByRole('combobox', { name: /responsável/i })
    await usuario.type(campo, 'a')
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    await usuario.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(campo).toHaveAttribute('aria-expanded', 'false')
  })

  it('seleciona uma opção ao clicar nela', async () => {
    const aoSelecionar = vi.fn()
    const usuario = userEvent.setup()
    render(<Harness aoSelecionar={aoSelecionar} />)

    const campo = screen.getByRole('combobox', { name: /responsável/i })
    await usuario.type(campo, 'Carla')
    await usuario.click(screen.getByRole('option', { name: /carla dias/i }))

    expect(aoSelecionar).toHaveBeenCalledWith(expect.objectContaining({ id: '3' }))
  })
})

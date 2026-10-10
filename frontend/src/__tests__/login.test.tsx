import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { lightTheme } from '@/theme/ni-doc-theme'
import { Login } from '@/pages/Login'

// Cobre o comportamento visual novo do redesign (toggle de senha e checkbox
// "Lembrar de mim"); o fluxo de submit/erro é coberto por pages/__tests__.
const mutateAsync = vi.fn().mockResolvedValue(undefined)

vi.mock('@/hooks/useAuth', () => ({
  useLogin: () => ({ mutateAsync, isPending: false, isError: false }),
}))

function renderLogin(): void {
  render(
    <FluentProvider theme={lightTheme}>
      <MemoryRouter initialEntries={['/login']}>
        <Login />
      </MemoryRouter>
    </FluentProvider>,
  )
}

describe('Login — redesign Fluent', () => {
  beforeEach(() => {
    mutateAsync.mockClear()
  })

  it('alterna a visibilidade da senha pelo botão de olho', async () => {
    const usuario = userEvent.setup()
    renderLogin()

    const senha = screen.getByLabelText('Senha')
    expect(senha).toHaveAttribute('type', 'password')

    await usuario.click(screen.getByRole('button', { name: 'Mostrar senha' }))
    expect(senha).toHaveAttribute('type', 'text')

    await usuario.click(screen.getByRole('button', { name: 'Ocultar senha' }))
    expect(senha).toHaveAttribute('type', 'password')
  })

  it('exibe o checkbox "Lembrar de mim" (apenas visual, fora do submit)', async () => {
    const usuario = userEvent.setup()
    renderLogin()

    const lembrar = screen.getByRole('checkbox', { name: 'Lembrar de mim' })
    expect(lembrar).toBeInTheDocument()

    await usuario.click(lembrar)
    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await usuario.type(screen.getByLabelText('Senha'), 'senha-forte-123')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    // "Lembrar de mim" não entra no payload do login.
    expect(mutateAsync).toHaveBeenCalledWith({
      email: 'ana@exemplo.com',
      senha: 'senha-forte-123',
    })
  })
})

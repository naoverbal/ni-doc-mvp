import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { FluentProvider } from '@fluentui/react-components'
import { Login } from '@/pages/Login'
import { lightTheme } from '@/theme/ni-doc-theme'
import { useAuthStore } from '@/stores/auth.store'
import { ApiError } from '@/services/api'

// Mocka o cliente HTTP para controlar as respostas de /auth/login nos testes.
vi.mock('@/services/api', async () => {
  const real = await vi.importActual<typeof import('@/services/api')>('@/services/api')
  return {
    ...real,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
  }
})

const { api } = await import('@/services/api')

function renderLogin(): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <FluentProvider theme={lightTheme}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/dashboard" element={<h1>Painel</h1>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </FluentProvider>
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAuthStore.getState().limpar()
  })

  it('renderiza os campos com rótulos associados e botão "Entrar"', () => {
    render(renderLogin())
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('exibe erros de validação vinculados ao campo (aria-invalid/aria-describedby)', async () => {
    const usuario = userEvent.setup()
    render(renderLogin())

    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    const campoEmail = screen.getByLabelText('E-mail')
    await waitFor(() => expect(campoEmail).toHaveAttribute('aria-invalid', 'true'))

    const descrito = campoEmail.getAttribute('aria-describedby')
    expect(descrito).toBeTruthy()
    expect(document.getElementById(descrito as string)).toHaveTextContent('Informe o e-mail')

    // Sem credenciais válidas, o login não é chamado.
    expect(api.post).not.toHaveBeenCalled()
  })

  it('faz login e redireciona para o destino em caso de sucesso', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      usuario: { id: 'u1', nome: 'Ana', papel: 'operador' },
    })
    const usuario = userEvent.setup()
    render(renderLogin())

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await usuario.type(screen.getByLabelText('Senha'), 'senha-forte-123')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Painel' })).toBeInTheDocument())
    expect(api.post).toHaveBeenCalledWith('/auth/login', {
      email: 'ana@exemplo.com',
      senha: 'senha-forte-123',
    })
    expect(useAuthStore.getState().autenticado).toBe(true)
  })

  it('anuncia mensagem genérica (role=alert, aria-live=assertive) em credenciais inválidas', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new ApiError(401, 'Credenciais inválidas'))
    const usuario = userEvent.setup()
    render(renderLogin())

    await usuario.type(screen.getByLabelText('E-mail'), 'ana@exemplo.com')
    await usuario.type(screen.getByLabelText('Senha'), 'senha-errada-123')
    await usuario.click(screen.getByRole('button', { name: 'Entrar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('E-mail ou senha inválidos')
    expect(alerta).toHaveAttribute('aria-live', 'assertive')
    expect(useAuthStore.getState().autenticado).toBe(false)
  })
})

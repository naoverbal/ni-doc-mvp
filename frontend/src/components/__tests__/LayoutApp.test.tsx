import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LayoutApp } from '@/components/LayoutApp'
import { useAuthStore } from '@/stores/auth.store'
import type { Usuario } from '@/types/api'

// Mocka o hook de logout para controlar sucesso/erro e inspecionar mutateAsync.
const mutateAsync = vi.fn<() => Promise<void>>()
let pendente = false

vi.mock('@/hooks/useAuth', () => ({
  useLogout: () => ({ mutateAsync, isPending: pendente }),
}))

const ADMIN: Usuario = { id: 'u-1', nome: 'Ana Admin', papel: 'admin' }
const OPERADOR: Usuario = { id: 'u-2', nome: 'Olavo Operador', papel: 'operador' }

// Renderiza o layout numa rota privada; a página de conteúdo expõe o alvo do
// skip link para espelhar o contrato real (<main id="conteudo">).
function renderLayout(rotaInicial = '/dashboard'): void {
  render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <Routes>
        <Route element={<LayoutApp />}>
          <Route path="/dashboard" element={<main id="conteudo">Dashboard</main>} />
          <Route path="/orcamentos" element={<main id="conteudo">Lista</main>} />
          <Route path="/orcamentos/:id" element={<main id="conteudo">Editor</main>} />
          <Route path="/template" element={<main id="conteudo">Template</main>} />
        </Route>
        <Route path="/login" element={<h1>Entrar</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LayoutApp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pendente = false
    mutateAsync.mockResolvedValue(undefined)
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
  })

  it('renderiza o skip link para #conteudo como primeiro elemento focável', async () => {
    renderLayout()
    const skip = screen.getByRole('link', { name: /pular para o conteúdo/i })
    expect(skip).toHaveAttribute('href', '#conteudo')

    const usuario = userEvent.setup()
    await usuario.tab()
    expect(skip).toHaveFocus()
  })

  it('renderiza exatamente um header e um nav "Principal" com os links de navegação', () => {
    renderLayout()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: /principal/i })
    expect(nav).toBeInTheDocument()
    expect(screen.getAllByRole('banner')).toHaveLength(1)
    expect(screen.getAllByRole('navigation', { name: /principal/i })).toHaveLength(1)

    expect(screen.getByRole('link', { name: /dashboard/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /orçamentos/i })).toBeInTheDocument()
  })

  it('exibe o nome do usuário autenticado', () => {
    renderLayout()
    expect(screen.getByText('Ana Admin')).toBeInTheDocument()
  })

  it('não quebra quando o usuário está momentaneamente nulo', () => {
    useAuthStore.setState({ usuario: null, autenticado: true })
    renderLayout()
    // Sem nome, mas o layout e o botão Sair continuam presentes.
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sair/i })).toBeInTheDocument()
  })

  it('exibe o acesso a Template para admin', () => {
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
    renderLayout()
    expect(screen.getByRole('link', { name: /template/i })).toBeInTheDocument()
  })

  it('oculta o acesso a Template para operador', () => {
    useAuthStore.setState({ usuario: OPERADOR, autenticado: true })
    renderLayout()
    expect(screen.queryByRole('link', { name: /template/i })).not.toBeInTheDocument()
  })

  it('marca o link da rota atual com aria-current="page"', () => {
    renderLayout('/dashboard')
    const atual = screen.getByRole('link', { name: /dashboard/i })
    expect(atual).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /orçamentos/i })).not.toHaveAttribute('aria-current')
  })

  it('mantém "Orçamentos" ativo nas subrotas', () => {
    renderLayout('/orcamentos/orc-1')
    const orcamentos = screen.getByRole('link', { name: /orçamentos/i })
    expect(orcamentos).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /dashboard/i })).not.toHaveAttribute('aria-current')
  })

  it('ao sair com sucesso: limpa o estado e navega para /login', async () => {
    const limpar = vi.spyOn(useAuthStore.getState(), 'limpar')
    const usuario = userEvent.setup()
    renderLayout()

    await usuario.click(screen.getByRole('button', { name: /sair/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument(),
    )
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(limpar).toHaveBeenCalledTimes(1)
  })

  it('ao sair com erro de rede: ainda limpa o estado e navega para /login', async () => {
    mutateAsync.mockRejectedValueOnce(new Error('rede'))
    const limpar = vi.spyOn(useAuthStore.getState(), 'limpar')
    const usuario = userEvent.setup()
    renderLayout()

    await usuario.click(screen.getByRole('button', { name: /sair/i }))

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /entrar/i })).toBeInTheDocument(),
    )
    expect(mutateAsync).toHaveBeenCalledTimes(1)
    expect(limpar).toHaveBeenCalledTimes(1)
  })

  it('desabilita o botão e troca o rótulo para "Saindo…" enquanto pendente', () => {
    pendente = true
    renderLayout()
    const botao = screen.getByRole('button', { name: /saindo/i })
    expect(botao).toBeDisabled()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Dashboard } from '@/pages/Dashboard'
import { useAuthStore } from '@/stores/auth.store'
import type { Usuario } from '@/types/api'

const ADMIN: Usuario = { id: 'u-1', nome: 'Ana Admin', papel: 'admin' }
const OPERADOR: Usuario = { id: 'u-2', nome: 'Olavo Operador', papel: 'operador' }

// Renderiza o Dashboard com rotas-alvo para verificar que os atalhos navegam.
function renderDashboard(): void {
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/orcamentos" element={<h1>Lista de orçamentos</h1>} />
        <Route path="/template" element={<h1>Editor de template</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => {
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
  })

  it('renderiza um <main id="conteudo"> como alvo do skip link', () => {
    renderDashboard()
    const principal = screen.getByRole('main')
    expect(principal).toHaveAttribute('id', 'conteudo')
  })

  it('renderiza um <h1> descritivo (não o placeholder "Dashboard")', () => {
    renderDashboard()
    const titulo = screen.getByRole('heading', { level: 1 })
    expect(titulo).toHaveTextContent(/início/i)
    expect(titulo).not.toHaveTextContent(/^dashboard$/i)
  })

  it('saúda o usuário autenticado pelo nome', () => {
    renderDashboard()
    expect(screen.getByText(/ana admin/i)).toBeInTheDocument()
  })

  it('não quebra quando o usuário está momentaneamente nulo', () => {
    useAuthStore.setState({ usuario: null, autenticado: true })
    renderDashboard()
    expect(screen.getByRole('heading', { level: 1, name: /início/i })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /atalhos/i })).toBeInTheDocument()
  })

  it('expõe os atalhos numa navegação rotulada "Atalhos"', () => {
    renderDashboard()
    const atalhos = screen.getByRole('navigation', { name: /atalhos/i })
    expect(atalhos).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /orçamentos/i })).toBeInTheDocument()
  })

  it('exibe o atalho de Template para admin', () => {
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
    renderDashboard()
    expect(screen.getByRole('link', { name: /template/i })).toBeInTheDocument()
  })

  it('oculta o atalho de Template para operador', () => {
    useAuthStore.setState({ usuario: OPERADOR, autenticado: true })
    renderDashboard()
    expect(screen.queryByRole('link', { name: /template/i })).not.toBeInTheDocument()
  })

  it('tem atalhos navegáveis: acionar "Orçamentos" leva à lista', async () => {
    const usuario = userEvent.setup()
    renderDashboard()
    await usuario.click(screen.getByRole('link', { name: /orçamentos/i }))
    expect(screen.getByRole('heading', { name: /lista de orçamentos/i })).toBeInTheDocument()
  })

  it('tem atalhos navegáveis: admin aciona "Template" e vai ao editor', async () => {
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
    const usuario = userEvent.setup()
    renderDashboard()
    await usuario.click(screen.getByRole('link', { name: /template/i }))
    expect(screen.getByRole('heading', { name: /editor de template/i })).toBeInTheDocument()
  })
})

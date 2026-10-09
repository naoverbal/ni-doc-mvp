import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PrivateRoute } from '@/routes/PrivateRoute'
import { LayoutApp } from '@/components/LayoutApp'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { NaoEncontrado } from '@/pages/NaoEncontrado'
import { useAuthStore } from '@/stores/auth.store'
import type { Usuario } from '@/types/api'

// Mocka os hooks de auth para isolar a estrutura de rotas da rede:
// - useSessao: sessão já resolvida (não carregando), para o PrivateRoute decidir
//   apenas pelo `autenticado` do store;
// - useLogin/useLogout: usados por Login/LayoutApp, sem efeito de rede.
vi.mock('@/hooks/useAuth', () => ({
  useSessao: () => ({ isLoading: false }),
  useLogin: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLogout: () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false }),
}))

const ADMIN: Usuario = { id: 'u-1', nome: 'Ana Admin', papel: 'admin' }

// Espelha a árvore de rotas de App.tsx: grupo privado sob PrivateRoute+LayoutApp,
// com /login, a raiz e o curinga fora do layout. Usa MemoryRouter para controlar
// a rota inicial no teste (App usa BrowserRouter em produção).
function renderRotas(rotaInicial: string): void {
  render(
    <MemoryRouter initialEntries={[rotaInicial]}>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <PrivateRoute>
              <LayoutApp />
            </PrivateRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
        </Route>
        <Route path="*" element={<NaoEncontrado />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Rotas com layout aninhado', () => {
  beforeEach(() => {
    useAuthStore.setState({ usuario: ADMIN, autenticado: true })
  })

  it('em /dashboard (autenticado) o header e a nav "Principal" do layout aparecem', () => {
    renderRotas('/dashboard')
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: /principal/i })).toBeInTheDocument()
    // Conteúdo da página também é renderizado (via <Outlet />).
    expect(screen.getByRole('heading', { level: 1, name: /início/i })).toBeInTheDocument()
  })

  it('em /login o layout da área logada NÃO aparece', () => {
    renderRotas('/login')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /principal/i })).not.toBeInTheDocument()
  })

  it('numa rota inexistente (NaoEncontrado) o layout NÃO aparece', () => {
    renderRotas('/rota-que-nao-existe')
    expect(screen.getByRole('heading', { name: /página não encontrada/i })).toBeInTheDocument()
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: /principal/i })).not.toBeInTheDocument()
  })
})

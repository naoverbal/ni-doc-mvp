import type { ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PrivateRoute } from '@/routes/PrivateRoute'
import { PublicRoute } from '@/routes/PublicRoute'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { OrcamentoLista } from '@/pages/OrcamentoLista'
import { OrcamentoEditor } from '@/pages/OrcamentoEditor'
import { PublicoOrcamento } from '@/pages/PublicoOrcamento'
import { NaoEncontrado } from '@/pages/NaoEncontrado'

export function App(): ReactElement {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/publico/orcamento/:token"
          element={
            <PublicRoute>
              <PublicoOrcamento />
            </PublicRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          }
        />
        <Route
          path="/orcamentos"
          element={
            <PrivateRoute>
              <OrcamentoLista />
            </PrivateRoute>
          }
        />
        <Route
          path="/orcamentos/novo"
          element={
            <PrivateRoute>
              <OrcamentoEditor />
            </PrivateRoute>
          }
        />
        <Route
          path="/orcamentos/:id"
          element={
            <PrivateRoute>
              <OrcamentoEditor />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<NaoEncontrado />} />
      </Routes>
    </BrowserRouter>
  )
}

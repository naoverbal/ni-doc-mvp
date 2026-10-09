import type { ReactElement } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { PrivateRoute } from '@/routes/PrivateRoute'
import { PublicRoute } from '@/routes/PublicRoute'
import { LayoutApp } from '@/components/LayoutApp'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { OrcamentoLista } from '@/pages/OrcamentoLista'
import { OrcamentoEditor } from '@/pages/OrcamentoEditor'
import { TemplateEditor } from '@/pages/TemplateEditor'
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
        {/* Grupo de rotas privadas sob a casca da área logada. PrivateRoute
            recebe children e os renderiza, então envolve o LayoutApp, que por
            sua vez renderiza o <Outlet /> das rotas filhas abaixo. */}
        <Route
          element={
            <PrivateRoute>
              <LayoutApp />
            </PrivateRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/orcamentos" element={<OrcamentoLista />} />
          <Route path="/orcamentos/novo" element={<OrcamentoEditor />} />
          <Route path="/orcamentos/:id" element={<OrcamentoEditor />} />
          <Route path="/template" element={<TemplateEditor />} />
        </Route>
        <Route path="*" element={<NaoEncontrado />} />
      </Routes>
    </BrowserRouter>
  )
}

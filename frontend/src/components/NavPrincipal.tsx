import type { ReactElement } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'

// Navegação principal da área logada. O NavLink do React Router aplica
// aria-current="page" ao link ativo por padrão (o reforço não-cromático — peso,
// sublinhado, borda — fica no CSS via o seletor [aria-current='page']).
//
// Matching de rota: Dashboard e Template usam `end` para casar apenas com a
// rota exata; "Orçamentos" NÃO usa `end`, então permanece ativo também nas
// subrotas (/orcamentos/novo, /orcamentos/:id).
export function NavPrincipal(): ReactElement {
  const usuario = useAuthStore((estado) => estado.usuario)
  const ehAdmin = usuario?.papel === 'admin'

  return (
    <nav className="app-nav" aria-label="Principal">
      <ul>
        <li>
          <NavLink to="/dashboard" end>
            Dashboard
          </NavLink>
        </li>
        <li>
          <NavLink to="/orcamentos">Orçamentos</NavLink>
        </li>
        {ehAdmin && (
          <li>
            <NavLink to="/template" end>
              Template
            </NavLink>
          </li>
        )}
      </ul>
    </nav>
  )
}

import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth.store'

// Tela inicial da área logada: hub de atalhos para as áreas do sistema
// (RF-L03). O acesso a Template depende do papel admin (RF-L04).
export function Dashboard(): ReactElement {
  const usuario = useAuthStore((estado) => estado.usuario)
  const ehAdmin = usuario?.papel === 'admin'

  return (
    <main id="conteudo">
      <h1>Início</h1>
      <p>Bem-vindo{usuario ? `, ${usuario.nome}` : ''}.</p>
      <nav aria-label="Atalhos">
        <ul>
          <li>
            <Link to="/orcamentos">Orçamentos</Link>
          </li>
          {ehAdmin && (
            <li>
              <Link to="/template">Template</Link>
            </li>
          )}
        </ul>
      </nav>
    </main>
  )
}

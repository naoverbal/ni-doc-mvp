import type { ReactElement } from 'react'

// Envoltório para rotas públicas (ex.: aprovação via token). Mantido simples no setup.
export function PublicRoute({ children }: { children: ReactElement }): ReactElement {
  return children
}

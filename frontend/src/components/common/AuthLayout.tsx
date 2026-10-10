import type { ReactElement, ReactNode } from 'react'
import { Card, Title2, makeStyles, tokens } from '@fluentui/react-components'

interface AuthLayoutProps {
  titulo: string
  children: ReactNode
}

const useStyles = makeStyles({
  pagina: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    padding: tokens.spacingVerticalXXXL,
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cartao: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    width: '100%',
    maxWidth: '360px',
    padding: tokens.spacingVerticalXL,
    boxShadow: tokens.shadow16,
  },
})

// Casca reutilizável para telas de autenticação: um card Fluent centralizado
// vertical e horizontalmente, com o título da página e o conteúdo (ex.: form).
export function AuthLayout({ titulo, children }: AuthLayoutProps): ReactElement {
  const estilos = useStyles()
  return (
    <main className={estilos.pagina}>
      <Card className={estilos.cartao}>
        <Title2 as="h1">{titulo}</Title2>
        {children}
      </Card>
    </main>
  )
}

import type { ReactElement, ReactNode } from 'react'
import { Card, Text, Title2, makeStyles, tokens } from '@fluentui/react-components'

interface AuthLayoutProps {
  // Título principal (heading nível 1). Opcional para telas que montam o
  // próprio cabeçalho via `topo`.
  titulo?: string
  // Subtítulo secundário exibido abaixo do título.
  subtitulo?: string
  // Conteúdo renderizado acima do título (ex.: logo + nome do produto).
  topo?: ReactNode
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
    maxWidth: '400px',
    padding: tokens.spacingVerticalXL,
    boxShadow: tokens.shadow16,
  },
  cabecalho: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
  },
  subtitulo: {
    color: tokens.colorNeutralForeground2,
  },
})

// Casca reutilizável para telas de autenticação: um card Fluent centralizado
// vertical e horizontalmente, com um topo opcional (logo), o título da página,
// um subtítulo opcional e o conteúdo (ex.: form).
export function AuthLayout({ titulo, subtitulo, topo, children }: AuthLayoutProps): ReactElement {
  const estilos = useStyles()
  return (
    <main className={estilos.pagina}>
      <Card className={estilos.cartao}>
        {topo}
        {(titulo || subtitulo) && (
          <div className={estilos.cabecalho}>
            {titulo && <Title2 as="h1">{titulo}</Title2>}
            {subtitulo && (
              <Text className={estilos.subtitulo} size={200}>
                {subtitulo}
              </Text>
            )}
          </div>
        )}
        {children}
      </Card>
    </main>
  )
}

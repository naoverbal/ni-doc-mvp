import type { ReactElement, ReactNode } from 'react'
import { Card, Text, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { useThemeStore } from '@/stores/theme.store'

interface AuthLayoutProps {
  // Título principal (heading nível 1). Opcional para telas que montam o
  // próprio cabeçalho via `topo`.
  titulo?: string
  // Subtítulo secundário exibido abaixo do título.
  subtitulo?: string
  // Conteúdo renderizado acima do título (ex.: logo + nome do produto).
  topo?: ReactNode
  // Nota exibida ao final do card (ex.: orientação para quem não tem conta).
  notaRodape?: string
  children: ReactNode
}

// Versão exibida no rodapé da tela.
const VERSAO_APP = 'v1.0'

const useStyles = makeStyles({
  pagina: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'center',
    // `main` global (global.css) limita a largura e define padding; aqui a
    // página de autenticação ocupa a viewport inteira.
    maxWidth: 'none',
    minHeight: '100vh',
    padding: tokens.spacingVerticalXXXL,
    // Reserva espaço para o rodapé da tela (64px) sobre o card em telas baixas.
    paddingBottom: '88px',
    position: 'relative',
    boxSizing: 'border-box',
  },
  // Claro: fundo da página = Background1 e card = Background2 (#faf9f8).
  paginaClara: {
    backgroundColor: tokens.colorNeutralBackground1,
  },
  // Escuro: a página fica mais escura que o card (Background2 / Background1).
  paginaEscura: {
    backgroundColor: tokens.colorNeutralBackground2,
  },
  cartao: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXL,
    width: '100%',
    maxWidth: '400px',
    padding: tokens.spacingVerticalXXXL,
    borderRadius: tokens.borderRadiusLarge,
    boxShadow: tokens.shadow16,
    boxSizing: 'border-box',
  },
  cartaoClaro: {
    backgroundColor: tokens.colorNeutralBackground2,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
  },
  cartaoEscuro: {
    backgroundColor: tokens.colorNeutralBackground1,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke3}`,
  },
  cabecalho: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    textAlign: 'center',
  },
  subtitulo: {
    color: tokens.colorNeutralForeground3,
  },
  nota: {
    textAlign: 'center',
    color: tokens.colorNeutralForeground3,
  },
  rodapeTela: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    justifyContent: 'center',
    paddingBlock: tokens.spacingVerticalXXL,
    color: tokens.colorNeutralForeground3,
  },
})

// Casca reutilizável para telas de autenticação: um card Fluent centralizado
// vertical e horizontalmente, com um topo opcional (logo), o título da página,
// um subtítulo opcional, o conteúdo (ex.: form), uma nota final opcional e o
// rodapé da tela (copyright + versão).
export function AuthLayout({
  titulo,
  subtitulo,
  topo,
  notaRodape,
  children,
}: AuthLayoutProps): ReactElement {
  const estilos = useStyles()
  const escuro = useThemeStore((estado) => estado.modo === 'escuro')
  return (
    <main
      className={mergeClasses(estilos.pagina, escuro ? estilos.paginaEscura : estilos.paginaClara)}
    >
      <Card
        className={mergeClasses(
          estilos.cartao,
          escuro ? estilos.cartaoEscuro : estilos.cartaoClaro,
        )}
      >
        {topo}
        {(titulo || subtitulo) && (
          <div className={estilos.cabecalho}>
            {titulo && (
              <Text as="h1" size={700} weight="bold">
                {titulo}
              </Text>
            )}
            {subtitulo && (
              <Text className={estilos.subtitulo} size={300}>
                {subtitulo}
              </Text>
            )}
          </div>
        )}
        {children}
        {notaRodape && (
          <Text className={estilos.nota} size={200}>
            {notaRodape}
          </Text>
        )}
      </Card>
      <footer className={estilos.rodapeTela}>
        <Text size={200}>
          © {new Date().getFullYear()} ni-doc · {VERSAO_APP}
        </Text>
      </footer>
    </main>
  )
}

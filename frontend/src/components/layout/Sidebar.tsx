import type { ReactElement } from 'react'
import { Avatar, Text, Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { Document24Regular } from '@fluentui/react-icons'
import { useAuthStore } from '@/stores/auth.store'
import { NavPrincipal } from '@/components/NavPrincipal'

const LARGURA_EXPANDIDA = '240px'
const LARGURA_COLAPSADA = '64px'

const useStyles = makeStyles({
  aside: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: tokens.colorNeutralBackground2,
    borderRight: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    // Transição de largura; respeita prefers-reduced-motion (ver global.css).
    transitionProperty: 'width',
    transitionDuration: tokens.durationSlow,
    transitionTimingFunction: tokens.curveEasyEase,
    width: LARGURA_EXPANDIDA,
    overflow: 'hidden',
    '@media (prefers-reduced-motion: reduce)': {
      transitionDuration: '0.01ms',
    },
  },
  colapsada: {
    width: LARGURA_COLAPSADA,
  },
  // Topo: marca "ni-doc" + legenda "Gestão comercial".
  marca: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    minHeight: '56px',
    paddingInline: tokens.spacingHorizontalM,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  marcaColapsada: {
    justifyContent: 'center',
    paddingInline: 0,
  },
  marcaLogo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    width: '32px',
    height: '32px',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  marcaTextos: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  marcaNome: {
    fontWeight: tokens.fontWeightSemibold,
    lineHeight: tokens.lineHeightBase300,
  },
  marcaLegenda: {
    color: tokens.colorNeutralForeground3,
  },
  // Rodapé: tenant/conta.
  rodape: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    minHeight: '56px',
    paddingInline: tokens.spacingHorizontalM,
    borderTop: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  rodapeColapsado: {
    justifyContent: 'center',
    paddingInline: 0,
  },
  rodapeTextos: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  rodapeNome: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  rodapeConta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
})

interface SidebarProps {
  colapsada: boolean
  // Chamado ao navegar (o Drawer mobile usa para fechar ao escolher um item).
  aoNavegar?: () => void
}

// Conteúdo da sidebar do app shell: marca no topo, navegação principal no meio
// e tenant/conta no rodapé. É reutilizada tanto na coluna fixa (desktop/tablet)
// quanto dentro do Drawer (mobile). A largura (240/64) é controlada pela prop
// `colapsada`; no Drawer o conteúdo sempre renderiza expandido.
export function Sidebar({ colapsada, aoNavegar }: SidebarProps): ReactElement {
  const estilos = useStyles()
  const usuario = useAuthStore((estado) => estado.usuario)

  const papelRotulo = usuario?.papel === 'admin' ? 'Administrador' : 'Operador'
  const legendaConta = usuario ? papelRotulo : 'Conta'

  return (
    <aside className={mergeClasses(estilos.aside, colapsada && estilos.colapsada)}>
      <div className={mergeClasses(estilos.marca, colapsada && estilos.marcaColapsada)}>
        {colapsada ? (
          <Tooltip content="ni-doc · Gestão comercial" relationship="label" withArrow positioning="after">
            <span className={estilos.marcaLogo} aria-label="ni-doc">
              <Document24Regular />
            </span>
          </Tooltip>
        ) : (
          <span className={estilos.marcaLogo} aria-hidden>
            <Document24Regular />
          </span>
        )}
        {!colapsada && (
          <span className={estilos.marcaTextos}>
            <Text className={estilos.marcaNome} size={400}>
              ni-doc
            </Text>
            <Text className={estilos.marcaLegenda} size={200}>
              Gestão comercial
            </Text>
          </span>
        )}
      </div>

      <NavPrincipal colapsada={colapsada} aoNavegar={aoNavegar} />

      <div className={mergeClasses(estilos.rodape, colapsada && estilos.rodapeColapsado)}>
        <Avatar
          name={usuario?.nome ?? 'Conta'}
          size={32}
          color="brand"
          aria-hidden={!colapsada}
          aria-label={colapsada ? `${usuario?.nome ?? 'Conta'}, ${legendaConta}` : undefined}
        />
        {!colapsada && (
          <span className={estilos.rodapeTextos}>
            <Text className={estilos.rodapeNome} size={300}>
              {usuario?.nome ?? 'Conta'}
            </Text>
            <Text className={estilos.rodapeConta} size={200}>
              {legendaConta}
            </Text>
          </span>
        )}
      </div>
    </aside>
  )
}

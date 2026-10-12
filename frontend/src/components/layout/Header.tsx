import type { ReactElement } from 'react'
import {
  Button,
  Switch,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  Navigation24Regular,
  PanelLeftContract24Regular,
  PanelLeftExpand24Regular,
  SignOut24Regular,
  WeatherMoon20Regular,
  WeatherSunny20Regular,
} from '@fluentui/react-icons'
import { useAuthStore } from '@/stores/auth.store'
import { useThemeStore } from '@/stores/theme.store'

const useStyles = makeStyles({
  header: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    height: '56px',
    flexShrink: 0,
    paddingInline: tokens.spacingHorizontalL,
    backgroundColor: tokens.colorNeutralBackground1,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    // Sticky no topo da coluna de conteúdo.
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  identidade: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  nome: {
    fontWeight: tokens.fontWeightSemibold,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  conta: {
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  // Empurra os controles da direita (tema, sair) para o fim.
  espacador: {
    flexGrow: 1,
  },
  acoes: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
  },
  tema: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
  },
})

interface HeaderProps {
  // Modo mobile: mostra o hambúrguer que abre o Drawer da sidebar.
  ehMobile: boolean
  // Estado atual da sidebar (desktop/tablet), para o aria-expanded do toggle.
  sidebarExpandida: boolean
  aoAlternarSidebar: () => void
  aoAbrirDrawer: () => void
  aoSair: () => void
  saindo: boolean
}

// Cabeçalho sticky (56px) do app shell: toggle de colapso da sidebar (ou
// hambúrguer do Drawer em mobile), identidade do usuário/conta, alternância de
// tema claro/escuro e logout. O logout em si (resiliente) vive no LayoutApp e
// chega via `aoSair`.
export function Header({
  ehMobile,
  sidebarExpandida,
  aoAlternarSidebar,
  aoAbrirDrawer,
  aoSair,
  saindo,
}: HeaderProps): ReactElement {
  const estilos = useStyles()
  const usuario = useAuthStore((estado) => estado.usuario)
  const modo = useThemeStore((estado) => estado.modo)
  const alternarTema = useThemeStore((estado) => estado.alternar)

  const ehEscuro = modo === 'escuro'
  const papelRotulo = usuario?.papel === 'admin' ? 'Administrador' : 'Operador'

  return (
    <header className={estilos.header}>
      {ehMobile ? (
        <Button
          appearance="subtle"
          icon={<Navigation24Regular />}
          aria-label="Abrir menu de navegação"
          onClick={aoAbrirDrawer}
        />
      ) : (
        <Tooltip
          content={sidebarExpandida ? 'Recolher menu' : 'Expandir menu'}
          relationship="label"
          withArrow
        >
          <Button
            appearance="subtle"
            icon={sidebarExpandida ? <PanelLeftContract24Regular /> : <PanelLeftExpand24Regular />}
            aria-label={sidebarExpandida ? 'Recolher menu' : 'Expandir menu'}
            aria-expanded={sidebarExpandida}
            onClick={aoAlternarSidebar}
          />
        </Tooltip>
      )}

      {usuario && (
        <span className={estilos.identidade}>
          <Text className={estilos.nome} size={300}>
            {usuario.nome}
          </Text>
          <Text className={estilos.conta} size={200}>
            {papelRotulo}
          </Text>
        </span>
      )}

      <span className={estilos.espacador} />

      <div className={estilos.acoes}>
        <div className={estilos.tema}>
          <span aria-hidden>{ehEscuro ? <WeatherMoon20Regular /> : <WeatherSunny20Regular />}</span>
          <Switch
            checked={ehEscuro}
            onChange={alternarTema}
            label={ehEscuro ? 'Tema escuro' : 'Tema claro'}
            aria-label="Alternar tema claro e escuro"
          />
        </div>

        <Button
          appearance="subtle"
          icon={<SignOut24Regular />}
          onClick={aoSair}
          disabled={saindo}
        >
          {saindo ? 'Saindo…' : 'Sair'}
        </Button>
      </div>
    </header>
  )
}

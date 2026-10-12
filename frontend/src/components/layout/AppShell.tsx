import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Outlet } from 'react-router-dom'
import {
  OverlayDrawer,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  Button,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { Dismiss24Regular } from '@fluentui/react-icons'
import { useLayoutStore } from '@/stores/layout.store'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { Sidebar } from '@/components/layout/Sidebar'
import { Header } from '@/components/layout/Header'

// Breakpoints do steering (seção 4): tablet < 1024px colapsa a sidebar; mobile
// < 640px troca a sidebar fixa por um Drawer acionado pelo hambúrguer do header.
const CONSULTA_TABLET = '(max-width: 1023px)'
const CONSULTA_MOBILE = '(max-width: 639px)'

const useStyles = makeStyles({
  shell: {
    display: 'flex',
    // Altura fixa da viewport + overflow escondido no shell: a sidebar fixa de
    // desktop/tablet fica presa à viewport (não rola com o conteúdo) e ocupa a
    // altura total da lateral. Só a coluna de conteúdo rola (overflowY abaixo).
    height: '100vh',
    overflow: 'hidden',
    backgroundColor: tokens.colorNeutralBackground3,
  },
  coluna: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    // A coluna é o container de rolagem vertical; o Header sticky gruda no topo
    // dela (não da janela), permanecendo visível enquanto o conteúdo rola.
    overflowY: 'auto',
  },
  // No mobile a Sidebar é hospedada por um DrawerBody, que aplica um padding
  // padrão do Fluent em volta do conteúdo. Como a Sidebar já tem paddings
  // internos próprios (marca/nav/rodapé), esse padding extra comprime o menu.
  // Zeramos o padding do DrawerBody e garantimos height:100% para a Sidebar
  // (que já usa height:100%) preencher toda a altura do Drawer, deixando o
  // conteúdo encostar nas bordas. Afeta só o Drawer mobile; a coluna fixa de
  // desktop/tablet não usa DrawerBody e permanece inalterada.
  corpoDrawer: {
    padding: 0,
    height: '100%',
  },
})

interface AppShellProps {
  // Logout resiliente, mantido no LayoutApp e repassado ao header.
  aoSair: () => void
  saindo: boolean
}

// Casca da área logada em Fluent: sidebar à esquerda + header sticky + conteúdo
// (via <Outlet />). Responsivo: colapsa automaticamente em tablet (< 1024px) e,
// em mobile (< 640px), substitui a sidebar fixa por um Drawer overlay acionado
// pelo hambúrguer do header.
//
// O skip link e o <main id="conteudo"> permanecem contrato das páginas; o shell
// expõe apenas banner (header) e navigation (sidebar) — NÃO renderiza <main>.
export function AppShell({ aoSair, saindo }: AppShellProps): ReactElement {
  const estilos = useStyles()

  const expandida = useLayoutStore((estado) => estado.sidebarExpandida)
  const alternarSidebar = useLayoutStore((estado) => estado.alternarSidebar)
  const definirExpandida = useLayoutStore((estado) => estado.definirSidebarExpandida)

  const ehTablet = useMediaQuery(CONSULTA_TABLET)
  const ehMobile = useMediaQuery(CONSULTA_MOBILE)

  const [drawerAberto, setDrawerAberto] = useState(false)
  // Elemento que detinha o foco ao abrir o Drawer (o hambúrguer do header),
  // para devolver o foco a ele ao fechar.
  const gatilhoDrawerRef = useRef<HTMLElement | null>(null)

  // Auto-colapso em tablet: ao entrar na faixa < 1024px, recolhe a sidebar.
  useEffect(() => {
    if (ehTablet) definirExpandida(false)
  }, [ehTablet, definirExpandida])

  // Ao sair do modo mobile, garante que o Drawer não fique "preso" aberto.
  useEffect(() => {
    if (!ehMobile) setDrawerAberto(false)
  }, [ehMobile])

  function abrirDrawer(): void {
    // Guarda o gatilho atual para devolver o foco ao fechar.
    const ativo = document.activeElement
    gatilhoDrawerRef.current = ativo instanceof HTMLElement ? ativo : null
    setDrawerAberto(true)
  }

  // Devolve o foco ao gatilho (hambúrguer) ao fechar o Drawer.
  function fecharDrawer(): void {
    setDrawerAberto(false)
    gatilhoDrawerRef.current?.focus()
  }

  // No modo mobile a sidebar fixa some; o conteúdo passa a largura inteira e a
  // navegação vive no Drawer. Fora do mobile, a sidebar fixa (240/64) aparece.
  return (
    <div className={estilos.shell}>
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>

      {!ehMobile && <Sidebar colapsada={expandida ? false : true} />}

      <div className={estilos.coluna}>
        <Header
          ehMobile={ehMobile}
          sidebarExpandida={expandida}
          aoAlternarSidebar={alternarSidebar}
          aoAbrirDrawer={abrirDrawer}
          aoSair={aoSair}
          saindo={saindo}
        />
        <Outlet />
      </div>

      {ehMobile && (
        <OverlayDrawer
          open={drawerAberto}
          onOpenChange={(_, { open }) => (open ? setDrawerAberto(true) : fecharDrawer())}
          position="start"
          // O Drawer do Fluent já aplica aria-modal, focus trap e fechamento por
          // Esc; o retorno de foco ao gatilho é garantido por fecharDrawer().
          size="small"
        >
          <DrawerHeader>
            <DrawerHeaderTitle
              action={
                <Button
                  appearance="subtle"
                  aria-label="Fechar menu de navegação"
                  icon={<Dismiss24Regular />}
                  onClick={fecharDrawer}
                />
              }
            >
              Navegação
            </DrawerHeaderTitle>
          </DrawerHeader>
          <DrawerBody className={estilos.corpoDrawer}>
            {/* No Drawer a sidebar sempre renderiza expandida (rótulos visíveis);
                ao escolher um item, fecha e devolve o foco ao gatilho. */}
            <Sidebar colapsada={false} aoNavegar={fecharDrawer} />
          </DrawerBody>
        </OverlayDrawer>
      )}
    </div>
  )
}

import { create } from 'zustand'

interface LayoutState {
  // Sidebar expandida (true, 240px) ou colapsada (false, 64px só ícones).
  sidebarExpandida: boolean
  alternarSidebar: () => void
  definirSidebarExpandida: (expandida: boolean) => void
}

// Estado de cliente para o app shell (área logada). Controla se a sidebar está
// expandida (240px) ou colapsada (64px, só ícones + tooltip). Segue o padrão do
// theme.store.ts (Zustand, sem persistência em storage no MVP; o estado vive na
// sessão da aba). Padrão inicial = expandida; o responsivo (auto-colapso em
// tablet, drawer em mobile) é decidido na camada de UI via useMediaQuery.
export const useLayoutStore = create<LayoutState>((set) => ({
  sidebarExpandida: true,
  alternarSidebar: () => set((estado) => ({ sidebarExpandida: !estado.sidebarExpandida })),
  definirSidebarExpandida: (expandida) => set({ sidebarExpandida: expandida }),
}))

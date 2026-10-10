import { create } from 'zustand'

export type ModoTema = 'claro' | 'escuro'

interface ThemeState {
  modo: ModoTema
  alternar: () => void
  definirModo: (modo: ModoTema) => void
}

// Modo inicial segue a preferência do sistema (prefers-color-scheme).
// Guard para ambientes sem window (SSR/jsdom sem matchMedia).
function modoInicial(): ModoTema {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro'
  }
  return 'claro'
}

// Estado de cliente para o tema da UI (claro/escuro). O FluentProvider em
// App.tsx seleciona lightTheme/darkTheme conforme o modo atual.
export const useThemeStore = create<ThemeState>((set) => ({
  modo: modoInicial(),
  alternar: () => set((estado) => ({ modo: estado.modo === 'escuro' ? 'claro' : 'escuro' })),
  definirModo: (modo) => set({ modo }),
}))

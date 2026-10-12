import { describe, it, expect, beforeEach } from 'vitest'
import { useLayoutStore } from '@/stores/layout.store'

describe('layout.store', () => {
  beforeEach(() => {
    // Restaura o padrão (expandida) entre os testes.
    useLayoutStore.setState({ sidebarExpandida: true })
  })

  it('inicia com a sidebar expandida', () => {
    expect(useLayoutStore.getState().sidebarExpandida).toBe(true)
  })

  it('alterna entre expandida e colapsada', () => {
    useLayoutStore.getState().alternarSidebar()
    expect(useLayoutStore.getState().sidebarExpandida).toBe(false)

    useLayoutStore.getState().alternarSidebar()
    expect(useLayoutStore.getState().sidebarExpandida).toBe(true)
  })

  it('definirSidebarExpandida força o estado informado', () => {
    useLayoutStore.getState().definirSidebarExpandida(false)
    expect(useLayoutStore.getState().sidebarExpandida).toBe(false)

    useLayoutStore.getState().definirSidebarExpandida(true)
    expect(useLayoutStore.getState().sidebarExpandida).toBe(true)
  })
})

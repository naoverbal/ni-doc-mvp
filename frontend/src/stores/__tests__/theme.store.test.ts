import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// jsdom não implementa matchMedia; cada teste mocka a preferência antes de
// importar o store (o modo inicial é calculado na criação do módulo).
function mockarPreferencia(prefereEscuro: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefereEscuro,
      media: '(prefers-color-scheme: dark)',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  )
}

describe('theme.store', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('inicia em "claro" quando o sistema não prefere escuro', async () => {
    mockarPreferencia(false)
    const { useThemeStore } = await import('@/stores/theme.store')
    expect(useThemeStore.getState().modo).toBe('claro')
  })

  it('inicia em "escuro" quando o sistema prefere escuro', async () => {
    mockarPreferencia(true)
    const { useThemeStore } = await import('@/stores/theme.store')
    expect(useThemeStore.getState().modo).toBe('escuro')
  })

  it('alterna entre claro e escuro', async () => {
    mockarPreferencia(false)
    const { useThemeStore } = await import('@/stores/theme.store')
    expect(useThemeStore.getState().modo).toBe('claro')

    useThemeStore.getState().alternar()
    expect(useThemeStore.getState().modo).toBe('escuro')

    useThemeStore.getState().alternar()
    expect(useThemeStore.getState().modo).toBe('claro')
  })

  it('definirModo força o modo informado', async () => {
    mockarPreferencia(false)
    const { useThemeStore } = await import('@/stores/theme.store')

    useThemeStore.getState().definirModo('escuro')
    expect(useThemeStore.getState().modo).toBe('escuro')
  })
})

import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom não implementa ResizeObserver nem matchMedia, que alguns componentes
// do Fluent (ex.: MessageBar) exigem ao montar. Polyfills mínimos para os
// testes de UI; não alteram o comportamento de produção.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// Limpa o DOM renderizado entre os testes para evitar vazamento de estado.
afterEach(() => {
  cleanup()
})

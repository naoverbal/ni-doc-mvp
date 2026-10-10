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

// jsdom não implementa a API de medição de texto SVG (getComputedTextLength /
// getBBox), que os gráficos do @fluentui/react-charts usam para quebrar rótulos.
// Stubs mínimos para os testes de UI; não afetam o comportamento de produção.
if (typeof SVGElement !== 'undefined') {
  const svgProto = SVGElement.prototype as unknown as {
    getComputedTextLength?: () => number
    getBBox?: () => { x: number; y: number; width: number; height: number }
    getBoundingClientRect?: () => DOMRect
  }
  if (typeof svgProto.getComputedTextLength !== 'function') {
    svgProto.getComputedTextLength = () => 0
  }
  if (typeof svgProto.getBBox !== 'function') {
    svgProto.getBBox = () => ({ x: 0, y: 0, width: 0, height: 0 })
  }
}

// jsdom não implementa canvas getContext (os gráficos medem largura de texto
// via canvas). Stub mínimo que devolve apenas measureText, suficiente para os
// testes; não afeta produção.
if (typeof HTMLCanvasElement !== 'undefined') {
  const canvasProto = HTMLCanvasElement.prototype as unknown as {
    getContext?: (tipo: string) => unknown
  }
  canvasProto.getContext = () => ({ measureText: () => ({ width: 0 }) })
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

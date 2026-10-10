import { useEffect, useState } from 'react'

// Verifica se uma media query CSS casa com o ambiente atual, reagindo a
// mudanças de viewport. Usado, por exemplo, para o gate de desktop do editor
// de template (bloqueio abaixo de ~1024px).
//
// Guarda para ambientes sem `matchMedia` (SSR/jsdom): devolve `false`. No jsdom
// o mock de `matchMedia` (ver src/__tests__/setup.ts) devolve `matches:false`
// fixo e não dispara `change`, então consultar `(max-width: 1023px)` resulta em
// `false` nos testes — ou seja, o caminho "desktop/editor completo" é o padrão.
export function useMediaQuery(query: string): boolean {
  const [corresponde, setCorresponde] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const lista = window.matchMedia(query)
    const aoMudar = (evento: MediaQueryListEvent): void => setCorresponde(evento.matches)
    // Sincroniza o estado caso a query tenha mudado entre render e efeito.
    setCorresponde(lista.matches)
    lista.addEventListener('change', aoMudar)
    return () => lista.removeEventListener('change', aoMudar)
  }, [query])

  return corresponde
}

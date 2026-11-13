import { useEffect, useState } from 'react'

// Devolve `valor` somente depois de `atrasoMs` sem mudanças. Usado nas buscas de
// autocomplete para disparar uma requisição por pausa na digitação, e não uma
// por tecla.
export function useDebouncedValue<T>(valor: T, atrasoMs = 300): T {
  const [debounced, setDebounced] = useState(valor)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(valor), atrasoMs)
    return () => clearTimeout(timer)
  }, [valor, atrasoMs])

  return debounced
}

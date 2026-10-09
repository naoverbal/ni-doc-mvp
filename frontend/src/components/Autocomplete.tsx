import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'

// Opção genérica do autocomplete: um id estável e o rótulo exibido/anunciado.
export interface OpcaoAutocomplete {
  id: string
  rotulo: string
}

export interface AutocompleteProps {
  // id base para associar label, combobox, listbox e opções (acessibilidade).
  id: string
  rotulo: string
  texto: string
  aoMudarTexto: (texto: string) => void
  opcoes: OpcaoAutocomplete[]
  selecionado: OpcaoAutocomplete | null
  aoSelecionar: (opcao: OpcaoAutocomplete) => void
  // Mensagem de carregamento opcional (anunciada na listbox via aria).
  carregando?: boolean
  // Estados de validação do formulário (RF-005): erro vinculado por aria.
  invalido?: boolean
  descritoPor?: string
  placeholder?: string
}

/**
 * Combobox acessível (WAI-ARIA Authoring Practices — padrão combobox com
 * listbox popup e edição livre). O input tem `role="combobox"`,
 * `aria-expanded`, `aria-controls` e `aria-activedescendant`; a listbox usa
 * `role="listbox"` e cada opção `role="option"` com `aria-selected`.
 *
 * Teclado:
 *  - ArrowDown/ArrowUp: move o destaque (abre a lista se fechada);
 *  - Enter: seleciona a opção destacada;
 *  - Escape: fecha a lista sem selecionar;
 *  - digitar: filtra (via `aoMudarTexto`) e reabre a lista.
 *
 * A seleção é anunciada por uma região `aria-live="polite"`.
 */
export function Autocomplete({
  id,
  rotulo,
  texto,
  aoMudarTexto,
  opcoes,
  selecionado,
  aoSelecionar,
  carregando = false,
  invalido = false,
  descritoPor,
  placeholder,
}: AutocompleteProps): ReactElement {
  const listboxId = `${id}-listbox`
  const anuncioId = useId()
  const containerRef = useRef<HTMLDivElement>(null)

  const [aberta, setAberta] = useState(false)
  const [indiceAtivo, setIndiceAtivo] = useState(-1)
  const [anuncio, setAnuncio] = useState('')

  const temOpcoes = opcoes.length > 0
  const expandida = aberta && (temOpcoes || carregando)

  // Reseta o destaque quando a lista de opções muda.
  useEffect(() => {
    setIndiceAtivo(-1)
  }, [opcoes])

  // Fecha a lista ao clicar fora do componente.
  useEffect(() => {
    function aoClicarFora(evento: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(evento.target as Node)) {
        setAberta(false)
      }
    }
    document.addEventListener('mousedown', aoClicarFora)
    return () => document.removeEventListener('mousedown', aoClicarFora)
  }, [])

  function selecionar(opcao: OpcaoAutocomplete): void {
    aoSelecionar(opcao)
    setAnuncio(`${opcao.rotulo} selecionado`)
    setAberta(false)
    setIndiceAtivo(-1)
  }

  function aoDigitar(valor: string): void {
    aoMudarTexto(valor)
    setAberta(true)
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>): void {
    switch (evento.key) {
      case 'ArrowDown': {
        evento.preventDefault()
        if (!aberta) {
          setAberta(true)
          return
        }
        if (!temOpcoes) return
        setIndiceAtivo((atual) => (atual + 1) % opcoes.length)
        break
      }
      case 'ArrowUp': {
        evento.preventDefault()
        if (!temOpcoes) return
        setAberta(true)
        setIndiceAtivo((atual) => (atual <= 0 ? opcoes.length - 1 : atual - 1))
        break
      }
      case 'Enter': {
        if (aberta && indiceAtivo >= 0 && opcoes[indiceAtivo]) {
          evento.preventDefault()
          selecionar(opcoes[indiceAtivo])
        }
        break
      }
      case 'Escape': {
        if (aberta) {
          evento.preventDefault()
          setAberta(false)
          setIndiceAtivo(-1)
        }
        break
      }
      default:
        break
    }
  }

  const opcaoAtivaId =
    expandida && indiceAtivo >= 0 && opcoes[indiceAtivo]
      ? `${id}-opcao-${opcoes[indiceAtivo].id}`
      : undefined

  return (
    <div ref={containerRef}>
      <label htmlFor={id}>{rotulo}</label>
      {/* O próprio input é o combobox (não um wrapper): aria-controls aponta
          para a listbox e aria-activedescendant para a opção destacada, mantendo
          o foco no input conforme o padrão combobox do WAI-ARIA. */}
      <input
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={expandida}
        aria-controls={listboxId}
        aria-activedescendant={opcaoAtivaId}
        aria-invalid={invalido ? true : undefined}
        aria-describedby={descritoPor}
        placeholder={placeholder}
        value={texto}
        onChange={(evento) => aoDigitar(evento.target.value)}
        onKeyDown={aoTeclar}
        onFocus={() => {
          if (temOpcoes) setAberta(true)
        }}
      />

      {expandida && (
        <ul id={listboxId} role="listbox" aria-label={rotulo}>
          {carregando && (
            <li role="option" aria-disabled="true" aria-selected={false}>
              Carregando…
            </li>
          )}
          {!carregando &&
            opcoes.map((opcao, indice) => {
              const ativa = indice === indiceAtivo
              const estaSelecionada = selecionado?.id === opcao.id
              return (
                <li
                  key={opcao.id}
                  id={`${id}-opcao-${opcao.id}`}
                  role="option"
                  aria-selected={ativa || estaSelecionada}
                  // onMouseDown (não onClick) para selecionar antes do blur do input.
                  onMouseDown={(evento) => {
                    evento.preventDefault()
                    selecionar(opcao)
                  }}
                  onMouseEnter={() => setIndiceAtivo(indice)}
                >
                  {opcao.rotulo}
                </li>
              )
            })}
        </ul>
      )}

      {/* Seleção anunciada por leitores de tela sem roubar o foco. */}
      <span id={anuncioId} role="status" aria-live="polite">
        {anuncio}
      </span>
    </div>
  )
}

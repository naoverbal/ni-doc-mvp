import { useEffect, useId, useRef, type ReactElement, type ReactNode, type RefObject } from 'react'

export interface ModalConfirmacaoProps {
  // Título do diálogo; vira o nome acessível via aria-labelledby.
  titulo: string
  // Descrição opcional; vinculada por aria-describedby quando presente.
  descricao?: ReactNode
  // Conteúdo extra opcional, renderizado entre a descrição e as ações.
  children?: ReactNode
  rotuloConfirmar: string
  rotuloCancelar: string
  aoConfirmar: () => void
  aoCancelar: () => void
  // Ação de confirmar em andamento: desabilita os botões e troca o rótulo.
  confirmando?: boolean
  // Referência ao elemento que abriu o diálogo; o foco retorna a ele ao fechar.
  elementoGatilho?: RefObject<HTMLElement | null>
}

// Seletor dos elementos focáveis usados pelo focus trap.
const FOCAVEIS =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'

/**
 * Diálogo de confirmação acessível (WAI-ARIA — modal dialog).
 *
 * - `role="dialog"` + `aria-modal="true"`, nomeado pelo título e descrito pela
 *   descrição (quando houver);
 * - ao montar, move o foco para dentro do diálogo;
 * - `Tab`/`Shift+Tab` ficam presos no diálogo (focus trap);
 * - `Esc` cancela;
 * - ao desmontar, devolve o foco ao elemento gatilho (quando informado).
 */
export function ModalConfirmacao({
  titulo,
  descricao,
  children,
  rotuloConfirmar,
  rotuloCancelar,
  aoConfirmar,
  aoCancelar,
  confirmando = false,
  elementoGatilho,
}: ModalConfirmacaoProps): ReactElement {
  const tituloId = useId()
  const descricaoId = useId()
  const dialogoRef = useRef<HTMLDivElement>(null)

  // Mantém aoCancelar em ref para o listener de teclado não re-assinar a cada
  // render (a identidade da função pode variar entre renders do pai).
  const aoCancelarRef = useRef(aoCancelar)
  aoCancelarRef.current = aoCancelar

  // Foco entra no diálogo ao abrir e retorna ao gatilho ao fechar.
  useEffect(() => {
    const gatilho = elementoGatilho?.current ?? null
    const dialogo = dialogoRef.current
    const primeiro = dialogo?.querySelector<HTMLElement>(FOCAVEIS)
    primeiro?.focus()

    return () => {
      gatilho?.focus()
    }
  }, [elementoGatilho])

  // Esc cancela e Tab fica preso no diálogo (focus trap). O listener fica no
  // document para que o diálogo (role não-interativo) não receba handlers.
  useEffect(() => {
    function aoTeclar(evento: globalThis.KeyboardEvent): void {
      if (evento.key === 'Escape') {
        evento.preventDefault()
        aoCancelarRef.current()
        return
      }
      if (evento.key !== 'Tab') return

      const dialogo = dialogoRef.current
      if (!dialogo) return
      const focaveis = Array.from(dialogo.querySelectorAll<HTMLElement>(FOCAVEIS))
      if (focaveis.length === 0) return

      const primeiro = focaveis[0]
      const ultimo = focaveis[focaveis.length - 1]
      const ativo = document.activeElement

      if (evento.shiftKey && ativo === primeiro) {
        evento.preventDefault()
        ultimo?.focus()
      } else if (!evento.shiftKey && ativo === ultimo) {
        evento.preventDefault()
        primeiro?.focus()
      }
    }

    document.addEventListener('keydown', aoTeclar)
    return () => document.removeEventListener('keydown', aoTeclar)
  }, [])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={tituloId}
      aria-describedby={descricao ? descricaoId : undefined}
      ref={dialogoRef}
    >
      <h2 id={tituloId}>{titulo}</h2>
      {descricao && <p id={descricaoId}>{descricao}</p>}
      {children}
      <div>
        <button type="button" onClick={aoConfirmar} disabled={confirmando}>
          {confirmando ? 'Enviando…' : rotuloConfirmar}
        </button>
        <button type="button" onClick={aoCancelar} disabled={confirmando}>
          {rotuloCancelar}
        </button>
      </div>
    </div>
  )
}

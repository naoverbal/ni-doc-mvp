import { useId, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { useExcluirOrcamento, useOrcamentos } from '@/hooks/useOrcamentos'
import type { OrcamentoStatus } from '@/types/api'

// Rótulos textuais dos status: o status NUNCA é transmitido só por cor
// (WCAG AA — informação perceptível). A cor é um reforço opcional via classe,
// mas o texto é a fonte de verdade acessível.
const ROTULO_STATUS: Record<OrcamentoStatus, string> = {
  rascunho: 'Rascunho',
  enviado: 'Enviado',
  aprovado: 'Aprovado',
  reprovado: 'Reprovado',
  expirado: 'Expirado',
  cancelado: 'Cancelado',
}

const OPCOES_STATUS: OrcamentoStatus[] = [
  'rascunho',
  'enviado',
  'aprovado',
  'reprovado',
  'expirado',
  'cancelado',
]

// Formata um valor em Real (pt-BR).
function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// '' representa "todos os status" (sem filtro).
type FiltroStatus = OrcamentoStatus | ''

export function OrcamentoLista(): ReactElement {
  const [status, setStatus] = useState<FiltroStatus>('')
  const filtroId = useId()

  const filtro = status === '' ? {} : { status }
  const { data, isLoading, isError } = useOrcamentos(filtro)
  const excluir = useExcluirOrcamento()

  const itens = data?.itens ?? []

  function aoExcluir(id: string, numero: string): void {
    const confirmado = window.confirm(
      `Excluir o orçamento ${numero}? Esta ação não pode ser desfeita.`,
    )
    if (confirmado) {
      excluir.mutate(id)
    }
  }

  return (
    <main id="conteudo">
      <h1>Orçamentos</h1>

      <div>
        <div>
          <label htmlFor={filtroId}>Filtrar por status</label>
          <select
            id={filtroId}
            value={status}
            onChange={(evento) => setStatus(evento.target.value as FiltroStatus)}
          >
            <option value="">Todos</option>
            {OPCOES_STATUS.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_STATUS[valor]}
              </option>
            ))}
          </select>
        </div>

        <Link to="/orcamentos/novo">Novo orçamento</Link>
      </div>

      {/* Carregamento e vazio são anunciados por leitores de tela (aria-live). */}
      {isLoading && (
        <p role="status" aria-live="polite">
          Carregando orçamentos…
        </p>
      )}
      {!isLoading && !isError && itens.length === 0 && (
        <p role="status" aria-live="polite">
          Nenhum orçamento encontrado.
        </p>
      )}

      {isError && <p role="alert">Não foi possível carregar os orçamentos. Tente novamente.</p>}

      {!isLoading && !isError && itens.length > 0 && (
        <table>
          <caption>Lista de orçamentos</caption>
          <thead>
            <tr>
              <th scope="col">Número</th>
              <th scope="col">Título</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
              <th scope="col">Ações</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((orcamento) => (
              <tr key={orcamento.id}>
                <th scope="row">{orcamento.numero}</th>
                <td>{orcamento.titulo}</td>
                <td>
                  <span data-status={orcamento.status}>{ROTULO_STATUS[orcamento.status]}</span>
                </td>
                <td>{formatarMoeda(orcamento.total)}</td>
                <td>
                  <Link
                    to={`/orcamentos/${orcamento.id}`}
                    aria-label={`Editar ${orcamento.numero}`}
                  >
                    <span aria-hidden="true">✎</span>
                  </Link>{' '}
                  <Link
                    to={`/orcamentos/${orcamento.id}?modo=visualizar`}
                    aria-label={`Visualizar ${orcamento.numero}`}
                  >
                    <span aria-hidden="true">👁</span>
                  </Link>{' '}
                  <button
                    type="button"
                    aria-label={`Excluir ${orcamento.numero}`}
                    onClick={() => aoExcluir(orcamento.id, orcamento.numero)}
                    disabled={excluir.isPending}
                  >
                    <span aria-hidden="true">🗑</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

import { useId, useState, type ReactElement } from 'react'
import type { DescontoTipo, ResponsavelResumo } from '@/types/api'
import { calcularTotalItem } from '@/lib/orcamento-calculo'
import { useBuscarResponsaveis } from '@/hooks/useReferencias'
import { Autocomplete, type OpcaoAutocomplete } from '@/components/Autocomplete'

// Forma de um item no estado do formulário. Mantém strings nos campos de
// seleção/entrada para espelhar os controles do DOM; a conversão para números
// acontece no cálculo e ao montar o payload de salvamento.
export interface ItemFormulario {
  nome: string
  quantidade: number
  valorUnitario: number
  descontoTipo: DescontoTipo | ''
  descontoValor: number
  responsavelId: string
  responsavelNome: string
}

export interface ItemOrcamentoRowProps {
  indice: number
  item: ItemFormulario
  aoMudar: (item: ItemFormulario) => void
  aoRemover: () => void
  podeRemover: boolean
  // Erro de validação do nome (RF-006.1), vinculado por aria-describedby.
  erroNome?: string
}

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

/**
 * Uma linha editável de item do orçamento (RF-006). Agrupa os campos em um
 * `<fieldset>` com `<legend>` ("Item N"); cada campo tem `<label>` associado.
 * O total do item é recalculado em tempo real e exibido. O responsável técnico
 * (opcional) é escolhido por um combobox acessível.
 */
export function ItemOrcamentoRow({
  indice,
  item,
  aoMudar,
  aoRemover,
  podeRemover,
  erroNome,
}: ItemOrcamentoRowProps): ReactElement {
  const nomeId = useId()
  const nomeErroId = useId()
  const quantidadeId = useId()
  const valorId = useId()
  const descontoTipoId = useId()
  const descontoValorId = useId()
  const respBaseId = useId()
  const numero = indice + 1

  const [termoResp, setTermoResp] = useState(item.responsavelNome)
  const { data: responsaveis = [], isLoading } = useBuscarResponsaveis(termoResp)

  const opcoes: OpcaoAutocomplete[] = responsaveis.map((r: ResponsavelResumo) => ({
    id: r.id,
    rotulo: r.registroProfissional ? `${r.nome} (${r.registroProfissional})` : r.nome,
  }))

  const selecionado: OpcaoAutocomplete | null = item.responsavelId
    ? { id: item.responsavelId, rotulo: item.responsavelNome }
    : null

  const total = calcularTotalItem({
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    descontoTipo: item.descontoTipo || undefined,
    descontoValor: item.descontoTipo ? item.descontoValor : undefined,
  })

  function atualizar<K extends keyof ItemFormulario>(campo: K, valor: ItemFormulario[K]): void {
    aoMudar({ ...item, [campo]: valor })
  }

  return (
    <fieldset>
      <legend>Item {numero}</legend>

      <div>
        <label htmlFor={nomeId}>Nome</label>
        <input
          id={nomeId}
          type="text"
          value={item.nome}
          aria-invalid={erroNome ? true : undefined}
          aria-describedby={erroNome ? nomeErroId : undefined}
          onChange={(evento) => atualizar('nome', evento.target.value)}
        />
        {erroNome && (
          <span id={nomeErroId} role="alert">
            {erroNome}
          </span>
        )}
      </div>

      <div>
        <label htmlFor={quantidadeId}>Quantidade</label>
        <input
          id={quantidadeId}
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(item.quantidade) ? item.quantidade : ''}
          onChange={(evento) => atualizar('quantidade', evento.target.valueAsNumber)}
        />
      </div>

      <div>
        <label htmlFor={valorId}>Valor unitário</label>
        <input
          id={valorId}
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(item.valorUnitario) ? item.valorUnitario : ''}
          onChange={(evento) => atualizar('valorUnitario', evento.target.valueAsNumber)}
        />
      </div>

      <div>
        <label htmlFor={descontoTipoId}>Tipo de desconto</label>
        <select
          id={descontoTipoId}
          value={item.descontoTipo}
          onChange={(evento) => atualizar('descontoTipo', evento.target.value as DescontoTipo | '')}
        >
          <option value="">Sem desconto</option>
          <option value="percentual">Percentual (%)</option>
          <option value="fixo">Fixo (R$)</option>
        </select>
      </div>

      <div>
        <label htmlFor={descontoValorId}>Valor do desconto</label>
        <input
          id={descontoValorId}
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(item.descontoValor) ? item.descontoValor : ''}
          disabled={item.descontoTipo === ''}
          onChange={(evento) => atualizar('descontoValor', evento.target.valueAsNumber)}
        />
      </div>

      <Autocomplete
        id={respBaseId}
        rotulo="Responsável técnico (opcional)"
        texto={termoResp}
        aoMudarTexto={(texto) => {
          setTermoResp(texto)
          // Limpar o texto desassocia o responsável selecionado.
          if (texto.trim() === '') {
            aoMudar({ ...item, responsavelId: '', responsavelNome: '' })
          }
        }}
        opcoes={opcoes}
        selecionado={selecionado}
        carregando={isLoading}
        aoSelecionar={(opcao) => {
          setTermoResp(opcao.rotulo)
          aoMudar({ ...item, responsavelId: opcao.id, responsavelNome: opcao.rotulo })
        }}
      />

      <p>
        Total do item: <strong>{formatarMoeda(total)}</strong>
      </p>

      <button
        type="button"
        aria-label={`Remover item ${numero}`}
        onClick={aoRemover}
        disabled={!podeRemover}
      >
        Remover
      </button>
    </fieldset>
  )
}

import { useEffect, useId, useMemo, useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import type {
  ClienteResumo,
  DescontoTipo,
  OrcamentoItemPayload,
  SalvarOrcamentoPayload,
} from '@/types/api'
import { calcularSubtotal, calcularTotal } from '@/lib/orcamento-calculo'
import { useAtualizarOrcamento, useCriarOrcamento, useOrcamento } from '@/hooks/useOrcamentos'
import { useBuscarClientes } from '@/hooks/useReferencias'
import { Autocomplete, type OpcaoAutocomplete } from '@/components/Autocomplete'
import { ItemOrcamentoRow, type ItemFormulario } from '@/components/ItemOrcamentoRow'

function formatarMoeda(valor: number): string {
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Item em branco para novos orçamentos / ao adicionar linhas.
function itemVazio(): ItemFormulario {
  return {
    nome: '',
    quantidade: 1,
    valorUnitario: 0,
    descontoTipo: '',
    descontoValor: 0,
    responsavelId: '',
    responsavelNome: '',
  }
}

// Validação de salvamento (RF-005.4): cliente, título e ao menos um item com
// nome. Espelha o shape aceito pelo backend; mensagens em pt-BR.
const itemSchema = z.object({
  nome: z.string().trim().min(1, 'Informe o nome do item'),
  quantidade: z.number().positive('Quantidade deve ser maior que zero'),
  valorUnitario: z.number().nonnegative('Valor unitário inválido'),
})

const orcamentoSchema = z.object({
  clienteId: z.string().uuid('Selecione um cliente').or(z.string().min(1, 'Selecione um cliente')),
  titulo: z.string().trim().min(1, 'Informe o título'),
  itens: z.array(itemSchema).min(1, 'Adicione ao menos um item'),
})

type ErrosFormulario = {
  clienteId?: string
  titulo?: string
  itens?: Record<number, string>
  geral?: string
}

export function OrcamentoEditor(): ReactElement {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const edicao = Boolean(id)

  const clienteBaseId = useId()
  const clienteErroId = useId()
  const tituloId = useId()
  const tituloErroId = useId()
  const descricaoId = useId()
  const descontoTipoId = useId()
  const descontoValorId = useId()

  // Estado do formulário.
  const [clienteId, setClienteId] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [termoCliente, setTermoCliente] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [descontoGlobalTipo, setDescontoGlobalTipo] = useState<DescontoTipo | ''>('')
  const [descontoGlobalValor, setDescontoGlobalValor] = useState(0)
  const [itens, setItens] = useState<ItemFormulario[]>([itemVazio()])
  const [erros, setErros] = useState<ErrosFormulario>({})

  const { data: clientes = [], isLoading: carregandoClientes } = useBuscarClientes(termoCliente)
  const { data: orcamento } = useOrcamento(id)
  const criar = useCriarOrcamento()
  const atualizar = useAtualizarOrcamento(id ?? '')

  // Pré-preenche o formulário em modo edição quando o orçamento carrega.
  useEffect(() => {
    if (!orcamento) return
    setClienteId(orcamento.clienteId)
    setTitulo(orcamento.titulo)
    setDescricao(orcamento.descricao ?? '')
    setDescontoGlobalTipo(orcamento.descontoGlobalTipo ?? '')
    setDescontoGlobalValor(orcamento.descontoGlobalValor ?? 0)
    setItens(
      orcamento.itens.map((it) => ({
        nome: it.nome,
        quantidade: it.quantidade,
        valorUnitario: it.valorUnitario,
        descontoTipo: it.descontoTipo ?? '',
        descontoValor: it.descontoValor ?? 0,
        responsavelId: it.responsavelId ?? '',
        responsavelNome: '',
      })),
    )
  }, [orcamento])

  const opcoesCliente: OpcaoAutocomplete[] = clientes.map((c: ClienteResumo) => ({
    id: c.id,
    rotulo: `${c.nome} — ${c.documento}`,
  }))

  const clienteSelecionado: OpcaoAutocomplete | null = clienteId
    ? { id: clienteId, rotulo: clienteNome || termoCliente }
    : null

  // Totais recalculados em tempo real (RF-007.4).
  const { subtotal, total } = useMemo(() => {
    const itensCalculo = itens.map((it) => ({
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      descontoTipo: it.descontoTipo || undefined,
      descontoValor: it.descontoTipo ? it.descontoValor : undefined,
    }))
    const sub = calcularSubtotal(itensCalculo)
    const tot = calcularTotal(
      sub,
      descontoGlobalTipo ? { tipo: descontoGlobalTipo, valor: descontoGlobalValor } : undefined,
    )
    return { subtotal: sub, total: tot }
  }, [itens, descontoGlobalTipo, descontoGlobalValor])

  function alterarItem(indice: number, item: ItemFormulario): void {
    setItens((atual) => atual.map((it, i) => (i === indice ? item : it)))
  }

  function removerItem(indice: number): void {
    setItens((atual) => atual.filter((_, i) => i !== indice))
  }

  function adicionarItem(): void {
    setItens((atual) => [...atual, itemVazio()])
  }

  function montarPayload(): SalvarOrcamentoPayload {
    const itensPayload: OrcamentoItemPayload[] = itens.map((it) => ({
      nome: it.nome.trim(),
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      ...(it.descontoTipo
        ? { descontoTipo: it.descontoTipo, descontoValor: it.descontoValor }
        : {}),
      ...(it.responsavelId ? { responsavelId: it.responsavelId } : {}),
    }))

    return {
      clienteId,
      titulo: titulo.trim(),
      ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
      ...(descontoGlobalTipo ? { descontoGlobalTipo, descontoGlobalValor } : {}),
      itens: itensPayload,
    }
  }

  function validar(): ErrosFormulario | null {
    const resultado = orcamentoSchema.safeParse({ clienteId, titulo, itens })
    if (resultado.success) return null

    const novosErros: ErrosFormulario = {}
    const errosItens: Record<number, string> = {}
    for (const issue of resultado.error.issues) {
      const [campo, indice] = issue.path
      if (campo === 'clienteId' && novosErros.clienteId === undefined) {
        novosErros.clienteId = issue.message
      } else if (campo === 'titulo' && novosErros.titulo === undefined) {
        novosErros.titulo = issue.message
      } else if (campo === 'itens' && typeof indice === 'number') {
        if (errosItens[indice] === undefined) errosItens[indice] = issue.message
      } else if (campo === 'itens') {
        novosErros.geral = issue.message
      }
    }
    if (Object.keys(errosItens).length > 0) novosErros.itens = errosItens
    return novosErros
  }

  async function aoSubmeter(evento: React.FormEvent): Promise<void> {
    evento.preventDefault()
    const problemas = validar()
    if (problemas) {
      setErros(problemas)
      return
    }
    setErros({})

    const payload = montarPayload()
    try {
      if (edicao) {
        await atualizar.mutateAsync(payload)
      } else {
        await criar.mutateAsync(payload)
      }
      navigate('/orcamentos')
    } catch {
      setErros({ geral: 'Não foi possível salvar o orçamento. Tente novamente.' })
    }
  }

  const salvando = criar.isPending || atualizar.isPending

  return (
    <main>
      <h1>{edicao ? 'Editar orçamento' : 'Novo orçamento'}</h1>

      <form onSubmit={aoSubmeter} noValidate>
        {erros.geral && (
          <p role="alert" aria-live="assertive">
            {erros.geral}
          </p>
        )}

        <fieldset>
          <legend>Dados gerais</legend>

          <Autocomplete
            id={clienteBaseId}
            rotulo="Cliente"
            texto={termoCliente}
            aoMudarTexto={(texto) => {
              setTermoCliente(texto)
              if (texto.trim() === '') {
                setClienteId('')
                setClienteNome('')
              }
            }}
            opcoes={opcoesCliente}
            selecionado={clienteSelecionado}
            carregando={carregandoClientes}
            invalido={Boolean(erros.clienteId)}
            descritoPor={erros.clienteId ? clienteErroId : undefined}
            aoSelecionar={(opcao) => {
              setClienteId(opcao.id)
              setClienteNome(opcao.rotulo)
              setTermoCliente(opcao.rotulo)
            }}
          />
          {erros.clienteId && (
            <span id={clienteErroId} role="alert">
              {erros.clienteId}
            </span>
          )}

          <div>
            <label htmlFor={tituloId}>Título</label>
            <input
              id={tituloId}
              type="text"
              value={titulo}
              aria-invalid={erros.titulo ? true : undefined}
              aria-describedby={erros.titulo ? tituloErroId : undefined}
              onChange={(evento) => setTitulo(evento.target.value)}
            />
            {erros.titulo && (
              <span id={tituloErroId} role="alert">
                {erros.titulo}
              </span>
            )}
          </div>

          <div>
            <label htmlFor={descricaoId}>Descrição</label>
            <textarea
              id={descricaoId}
              value={descricao}
              onChange={(evento) => setDescricao(evento.target.value)}
            />
          </div>
        </fieldset>

        <fieldset>
          <legend>Itens</legend>

          {itens.map((item, indice) => (
            <ItemOrcamentoRow
              key={indice}
              indice={indice}
              item={item}
              aoMudar={(novo) => alterarItem(indice, novo)}
              aoRemover={() => removerItem(indice)}
              podeRemover={itens.length > 1}
              erroNome={erros.itens?.[indice]}
            />
          ))}

          <button type="button" onClick={adicionarItem}>
            Adicionar item
          </button>
        </fieldset>

        <fieldset>
          <legend>Desconto global</legend>

          <div>
            <label htmlFor={descontoTipoId}>Tipo de desconto global</label>
            <select
              id={descontoTipoId}
              value={descontoGlobalTipo}
              onChange={(evento) => setDescontoGlobalTipo(evento.target.value as DescontoTipo | '')}
            >
              <option value="">Sem desconto</option>
              <option value="percentual">Percentual (%)</option>
              <option value="fixo">Fixo (R$)</option>
            </select>
          </div>

          <div>
            <label htmlFor={descontoValorId}>Valor do desconto global</label>
            <input
              id={descontoValorId}
              type="number"
              min={0}
              step="any"
              value={Number.isFinite(descontoGlobalValor) ? descontoGlobalValor : ''}
              disabled={descontoGlobalTipo === ''}
              onChange={(evento) => setDescontoGlobalValor(evento.target.valueAsNumber)}
            />
          </div>
        </fieldset>

        {/* Totais recalculados em tempo real, anunciados por leitores de tela. */}
        <section aria-label="Totais do orçamento">
          <p>Subtotal: {formatarMoeda(subtotal)}</p>
          <p role="status" aria-live="polite" aria-label="Total do orçamento">
            Total: <strong>{formatarMoeda(total)}</strong>
          </p>
        </section>

        <button type="submit" disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar rascunho'}
        </button>
      </form>
    </main>
  )
}

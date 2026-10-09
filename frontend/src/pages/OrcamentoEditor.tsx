import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import type {
  ClienteResumo,
  DescontoTipo,
  OrcamentoItemPayload,
  SalvarOrcamentoPayload,
  VersaoEnviada,
} from '@/types/api'
import { calcularSubtotal, calcularTotal } from '@/lib/orcamento-calculo'
import {
  useAtualizarOrcamento,
  useCriarOrcamento,
  useEnviarOrcamento,
  useOrcamento,
} from '@/hooks/useOrcamentos'
import { useBuscarClientes } from '@/hooks/useReferencias'
import { Autocomplete, type OpcaoAutocomplete } from '@/components/Autocomplete'
import { ItemOrcamentoRow, type ItemFormulario } from '@/components/ItemOrcamentoRow'
import { ModalConfirmacao } from '@/components/ModalConfirmacao'

// Monta a URL pública absoluta de aceite a partir do token da versão. A rota
// pública da SPA é /publico/orcamento/:token (ver App.tsx).
function urlPublica(token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/publico/orcamento/${token}`
}

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

  // Estado de envio/versionamento (RF-008). As versões enviadas na sessão são
  // acumuladas para listagem; a confirmação é anunciada via aria-live.
  const [modalEnvioAberto, setModalEnvioAberto] = useState(false)
  const [versoes, setVersoes] = useState<VersaoEnviada[]>([])
  const [mensagemEnvio, setMensagemEnvio] = useState('')
  const [erroEnvio, setErroEnvio] = useState('')
  const [linkCopiado, setLinkCopiado] = useState(false)
  const botaoEnviarRef = useRef<HTMLButtonElement>(null)

  const { data: clientes = [], isLoading: carregandoClientes } = useBuscarClientes(termoCliente)
  const { data: orcamento } = useOrcamento(id)
  const criar = useCriarOrcamento()
  const atualizar = useAtualizarOrcamento(id ?? '')
  const enviar = useEnviarOrcamento(id ?? '')

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

  // Envia o orçamento (POST /orcamentos/:id/enviar). Em sucesso, fecha o modal,
  // acumula a versão criada, anuncia a confirmação e devolve o foco ao gatilho.
  async function confirmarEnvio(): Promise<void> {
    setErroEnvio('')
    try {
      const versao = await enviar.mutateAsync()
      setVersoes((atual) => [...atual, versao])
      setMensagemEnvio(`Orçamento enviado. Versão ${versao.versao} criada.`)
      setLinkCopiado(false)
      setModalEnvioAberto(false)
    } catch {
      setErroEnvio('Não foi possível enviar o orçamento. Tente novamente.')
      setModalEnvioAberto(false)
    }
  }

  // Copia o link público para a área de transferência, quando disponível.
  async function copiarLink(token: string): Promise<void> {
    try {
      await navigator.clipboard?.writeText(urlPublica(token))
      setLinkCopiado(true)
    } catch {
      setLinkCopiado(false)
    }
  }

  // O botão Enviar só faz sentido para um rascunho já persistido (modo edição).
  const podeEnviar = edicao && orcamento?.status === 'rascunho'
  const ultimaVersao = versoes.at(-1)

  return (
    <main id="conteudo">
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

        {podeEnviar && (
          <button
            type="button"
            ref={botaoEnviarRef}
            onClick={() => {
              setErroEnvio('')
              setModalEnvioAberto(true)
            }}
          >
            Enviar
          </button>
        )}
      </form>

      {/* Erro de envio: anunciado imediatamente por leitores de tela. */}
      {erroEnvio && (
        <p role="alert" aria-live="assertive">
          {erroEnvio}
        </p>
      )}

      {/* Confirmação de envio anunciada sem roubar o foco. */}
      <p role="status" aria-live="polite" aria-label="Status do envio">
        {mensagemEnvio}
      </p>

      {modalEnvioAberto && (
        <ModalConfirmacao
          titulo="Enviar orçamento"
          descricao="Ao enviar, uma versão imutável é criada e o orçamento não poderá mais ser editado. Deseja continuar?"
          rotuloConfirmar="Enviar"
          rotuloCancelar="Cancelar"
          confirmando={enviar.isPending}
          elementoGatilho={botaoEnviarRef}
          aoConfirmar={() => void confirmarEnvio()}
          aoCancelar={() => setModalEnvioAberto(false)}
        />
      )}

      {/* Link público da última versão enviada e lista de versões da sessão. */}
      {ultimaVersao && (
        <section aria-label="Orçamento enviado">
          <h2>Link público de aceite</h2>
          <p>
            <a href={urlPublica(ultimaVersao.tokenPublico)}>
              Abrir orçamento {ultimaVersao.versao > 0 ? `(versão ${ultimaVersao.versao})` : ''}{' '}
              para aceite
            </a>
          </p>
          <button
            type="button"
            aria-label="Copiar link público do orçamento"
            onClick={() => void copiarLink(ultimaVersao.tokenPublico)}
          >
            Copiar link
          </button>
          <span role="status" aria-live="polite">
            {linkCopiado ? 'Link copiado para a área de transferência.' : ''}
          </span>

          <h2 id="titulo-versoes">Versões</h2>
          <ul aria-labelledby="titulo-versoes">
            {versoes.map((versao) => (
              <li key={versao.id}>
                Versão {versao.versao} — enviada em{' '}
                {new Date(versao.enviadoEm).toLocaleString('pt-BR')}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

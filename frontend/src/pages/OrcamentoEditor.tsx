import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import {
  Badge,
  Body1,
  Button,
  Caption1,
  Card,
  Divider,
  Dropdown,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Option,
  Table,
  TableBody,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Textarea,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  Add20Regular,
  Alert20Regular,
  ArrowLeft20Regular,
  Calculator20Regular,
  CheckmarkCircle20Filled,
  ChevronUp20Regular,
  ClipboardTaskListLtr20Regular,
  Delete20Regular,
  DocumentText20Regular,
  Payment20Regular,
  Save20Regular,
  Send20Regular,
} from '@fluentui/react-icons'
import type {
  ClienteResumo,
  CondicaoPagamentoPayload,
  DescontoTipo,
  OrcamentoItemPayload,
  SalvarOrcamentoPayload,
  VersaoEnviada,
} from '@/types/api'
import { calcularSubtotal, calcularTotal } from '@/lib/orcamento-calculo'
import { formatarMoeda } from '@/lib/formato'
import { ROTULO_STATUS } from '@/lib/orcamento-status'
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
import './OrcamentoEditor.css'

// Formas de pagamento oferecidas nas condições estruturadas (RF-005/RF-007).
const FORMAS_PAGAMENTO = ['PIX', 'Boleto', 'Cartão', 'Transferência'] as const

const useStyles = makeStyles({
  manipulador: {
    color: tokens.colorNeutralForeground3,
    alignSelf: 'center',
  },
  mensagem: {
    marginBottom: tokens.spacingVerticalM,
  },
  erroCampo: {
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
})

// Monta a URL pública absoluta de aceite a partir do token da versão. A rota
// pública da SPA é /publico/orcamento/:token (ver App.tsx).
function urlPublica(token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : ''
  return `${base}/publico/orcamento/${token}`
}

// Item em branco para novos orçamentos / ao adicionar linhas.
function itemVazio(): ItemFormulario {
  return {
    nome: '',
    quantidade: 1,
    unidade: 'un',
    valorUnitario: 0,
    descontoTipo: '',
    descontoValor: 0,
    responsavelId: '',
    responsavelNome: '',
  }
}

// Condição de pagamento no estado do formulário. `chave` é um id de UI estável
// para servir de `key` e isolar edições/remoções (não vai para o payload).
interface CondicaoFormulario {
  chave: string
  descricao: string
  percentual: number
  marco: string
  formaPagamento: string
}

let contadorCondicao = 0
function condicaoVazia(): CondicaoFormulario {
  contadorCondicao += 1
  return {
    chave: `cond-${contadorCondicao}`,
    descricao: '',
    percentual: 0,
    marco: '',
    formaPagamento: 'PIX',
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
  condicoes?: string
  geral?: string
}

// Converte texto de input numérico em número (vazio vira 0).
function paraNumero(texto: string): number {
  if (texto === '') return 0
  const n = Number(texto)
  return Number.isFinite(n) ? n : 0
}

export function OrcamentoEditor(): ReactElement {
  const estilos = useStyles()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const edicao = Boolean(id)

  const clienteBaseId = useId()
  const clienteErroId = useId()
  const condicoesErroId = useId()

  // Estado do formulário.
  const [clienteId, setClienteId] = useState('')
  const [clienteNome, setClienteNome] = useState('')
  const [termoCliente, setTermoCliente] = useState('')
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [dataEmissao, setDataEmissao] = useState('')
  const [validadeDias, setValidadeDias] = useState('30')
  const [prazoEntregaDias, setPrazoEntregaDias] = useState('')
  const [descontoGlobalTipo, setDescontoGlobalTipo] = useState<DescontoTipo>('percentual')
  const [descontoGlobalValor, setDescontoGlobalValor] = useState(0)
  const [itens, setItens] = useState<ItemFormulario[]>([itemVazio()])
  const [condicoes, setCondicoes] = useState<CondicaoFormulario[]>([])
  const [dadosExpandido, setDadosExpandido] = useState(true)
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
    setDataEmissao(orcamento.dataEmissao ? orcamento.dataEmissao.slice(0, 10) : '')
    setValidadeDias(String(orcamento.validadeDias ?? 30))
    setPrazoEntregaDias(
      orcamento.prazoEntregaDias != null ? String(orcamento.prazoEntregaDias) : '',
    )
    setDescontoGlobalTipo(orcamento.descontoGlobalTipo ?? 'percentual')
    setDescontoGlobalValor(orcamento.descontoGlobalValor ?? 0)
    setItens(
      orcamento.itens.map((it) => ({
        nome: it.nome,
        quantidade: it.quantidade,
        unidade: it.unidade ?? 'un',
        valorUnitario: it.valorUnitario,
        descontoTipo: it.descontoTipo ?? '',
        descontoValor: it.descontoValor ?? 0,
        responsavelId: it.responsavelId ?? '',
        responsavelNome: '',
      })),
    )
    contadorCondicao += 1
    setCondicoes(
      orcamento.condicoesPagamento.map((c, i) => ({
        chave: `cond-existente-${c.id ?? i}`,
        descricao: c.descricao,
        percentual: c.percentual,
        marco: c.marco ?? '',
        formaPagamento: c.formaPagamento,
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
  const { subtotal, descontoGlobalCalculado, total } = useMemo(() => {
    const itensCalculo = itens.map((it) => ({
      quantidade: it.quantidade,
      valorUnitario: it.valorUnitario,
      descontoTipo: it.descontoTipo || undefined,
      descontoValor: it.descontoTipo ? it.descontoValor : undefined,
    }))
    const sub = calcularSubtotal(itensCalculo)
    const descontoAtivo = descontoGlobalValor > 0
    const tot = calcularTotal(
      sub,
      descontoAtivo ? { tipo: descontoGlobalTipo, valor: descontoGlobalValor } : undefined,
    )
    return { subtotal: sub, descontoGlobalCalculado: sub - tot, total: tot }
  }, [itens, descontoGlobalTipo, descontoGlobalValor])

  // Soma dos percentuais das condições (RF-005/RF-007), anunciada via aria-live.
  const somaPercentuais = useMemo(
    () => condicoes.reduce((acc, c) => acc + (Number.isFinite(c.percentual) ? c.percentual : 0), 0),
    [condicoes],
  )
  const somaOk = Math.abs(somaPercentuais - 100) < 0.01

  function alterarItem(indice: number, item: ItemFormulario): void {
    setItens((atual) => atual.map((it, i) => (i === indice ? item : it)))
  }

  function removerItem(indice: number): void {
    setItens((atual) => atual.filter((_, i) => i !== indice))
  }

  function adicionarItem(): void {
    setItens((atual) => [...atual, itemVazio()])
  }

  function alterarCondicao(chave: string, campo: keyof CondicaoFormulario, valor: string): void {
    setCondicoes((atual) =>
      atual.map((c) =>
        c.chave === chave
          ? { ...c, [campo]: campo === 'percentual' ? paraNumero(valor) : valor }
          : c,
      ),
    )
  }

  function adicionarCondicao(): void {
    setCondicoes((atual) => [...atual, condicaoVazia()])
  }

  function removerCondicao(chave: string): void {
    setCondicoes((atual) => atual.filter((c) => c.chave !== chave))
  }

  function montarPayload(): SalvarOrcamentoPayload {
    const itensPayload: OrcamentoItemPayload[] = itens.map((it) => ({
      nome: it.nome.trim(),
      quantidade: it.quantidade,
      unidade: it.unidade,
      valorUnitario: it.valorUnitario,
      ...(it.descontoTipo
        ? { descontoTipo: it.descontoTipo, descontoValor: it.descontoValor }
        : {}),
      ...(it.responsavelId ? { responsavelId: it.responsavelId } : {}),
    }))

    const condicoesPayload: CondicaoPagamentoPayload[] = condicoes.map((c) => ({
      descricao: c.descricao.trim(),
      percentual: c.percentual,
      ...(c.marco.trim() ? { marco: c.marco.trim() } : {}),
      formaPagamento: c.formaPagamento,
    }))

    const validade = paraNumero(validadeDias)
    const prazo = paraNumero(prazoEntregaDias)

    return {
      clienteId,
      titulo: titulo.trim(),
      ...(descricao.trim() ? { descricao: descricao.trim() } : {}),
      ...(validade > 0 ? { validadeDias: validade } : {}),
      ...(prazo > 0 ? { prazoEntregaDias: prazo } : {}),
      ...(descontoGlobalValor > 0 ? { descontoGlobalTipo, descontoGlobalValor } : {}),
      ...(condicoesPayload.length > 0 ? { condicoesPagamento: condicoesPayload } : {}),
      itens: itensPayload,
    }
  }

  function validar(): ErrosFormulario | null {
    const resultado = orcamentoSchema.safeParse({ clienteId, titulo, itens })
    const novosErros: ErrosFormulario = {}

    if (!resultado.success) {
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
    }

    // Soma dos percentuais = 100 quando há condições (RF-005/RF-007).
    if (condicoes.length > 0 && !somaOk) {
      novosErros.condicoes = 'A soma dos percentuais das condições de pagamento deve ser 100'
    }

    return Object.keys(novosErros).length > 0 ? novosErros : null
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
  const numero = orcamento?.numero ?? 'Novo orçamento'
  const statusAtual = orcamento?.status ?? 'rascunho'
  const corStatus =
    statusAtual === 'aprovado'
      ? 'success'
      : statusAtual === 'reprovado' || statusAtual === 'cancelado'
        ? 'danger'
        : statusAtual === 'rascunho'
          ? 'warning'
          : 'informative'

  function voltar(): void {
    navigate('/orcamentos')
  }

  return (
    <main id="conteudo" className="orcamento-editor">
      <form onSubmit={aoSubmeter} noValidate>
        {/* Barra de ações fixa (RF-005/RF-008). */}
        <div className="orcamento-editor__action-bar">
          <Button appearance="subtle" icon={<ArrowLeft20Regular />} onClick={voltar}>
            Voltar
          </Button>
          <Divider vertical />
          <div className="orcamento-editor__identidade">
            <Text weight="semibold">{numero}</Text>
            {orcamento && orcamento.versaoAtual > 0 && (
              <Badge appearance="tint" color="informative" size="small">
                v{orcamento.versaoAtual}
              </Badge>
            )}
            {/* Status com rótulo textual (não só cor) — WCAG AA. */}
            <Badge appearance="tint" color={corStatus} size="small">
              {ROTULO_STATUS[statusAtual]}
            </Badge>
          </div>
          <div className="orcamento-editor__acoes">
            <Button
              type="submit"
              appearance="outline"
              icon={<Save20Regular />}
              disabled={salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
            {podeEnviar && (
              <Button
                type="button"
                appearance="primary"
                icon={<Send20Regular />}
                ref={botaoEnviarRef}
                onClick={() => {
                  setErroEnvio('')
                  setModalEnvioAberto(true)
                }}
              >
                Enviar
              </Button>
            )}
          </div>
        </div>

        <div className="orcamento-editor__container">
          <h1 className="sr-only">{edicao ? `Editar orçamento ${numero}` : 'Novo orçamento'}</h1>

          {erros.geral && (
            <MessageBar intent="error" className={estilos.mensagem}>
              <MessageBarBody role="alert" aria-live="assertive">
                {erros.geral}
              </MessageBarBody>
            </MessageBar>
          )}

          {/* Card: Dados do Orçamento (colapsável). */}
          <section className="orcamento-editor__secao" aria-labelledby="secao-dados">
            <div className="orcamento-editor__titulo-secao">
              <div className="orcamento-editor__titulo-secao-rotulo">
                <DocumentText20Regular aria-hidden />
                <Text as="h2" id="secao-dados" size={500} weight="semibold">
                  Dados do Orçamento
                </Text>
              </div>
              <Button
                appearance="subtle"
                aria-expanded={dadosExpandido}
                aria-label={
                  dadosExpandido ? 'Recolher dados do orçamento' : 'Expandir dados do orçamento'
                }
                icon={
                  <ChevronUp20Regular className={dadosExpandido ? '' : 'chevron--recolhido'} />
                }
                onClick={() => setDadosExpandido((atual) => !atual)}
              />
            </div>

            {dadosExpandido && (
              <Card appearance="outline">
                <div className="orcamento-editor__dados">
                  <Field
                    className="orcamento-editor__campo-cliente"
                    label="Cliente"
                    required
                    validationState={erros.clienteId ? 'error' : 'none'}
                    validationMessage={erros.clienteId}
                    validationMessageIcon={null}
                  >
                    <Autocomplete
                      id={clienteBaseId}
                      rotulo="Cliente"
                      rotuloOculto
                      texto={termoCliente}
                      placeholder="Buscar cliente por nome ou CNPJ..."
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
                  </Field>

                  <Field
                    className="orcamento-editor__campo-titulo"
                    label="Título"
                    required
                    validationState={erros.titulo ? 'error' : 'none'}
                    validationMessage={erros.titulo}
                    validationMessageIcon={null}
                  >
                    <Input
                      value={titulo}
                      placeholder="Ex: Proposta Comercial — Projeto X"
                      onChange={(_, dados) => setTitulo(dados.value)}
                    />
                  </Field>

                  <Field className="orcamento-editor__campo-largo" label="Descrição">
                    <Textarea
                      value={descricao}
                      resize="vertical"
                      rows={3}
                      placeholder="Descreva brevemente o escopo do orçamento..."
                      onChange={(_, dados) => setDescricao(dados.value)}
                    />
                  </Field>

                  <Field label="Data de emissão">
                    <Input
                      type="date"
                      value={dataEmissao}
                      onChange={(_, dados) => setDataEmissao(dados.value)}
                    />
                  </Field>

                  <Field label="Validade">
                    <Input
                      type="number"
                      min={1}
                      value={validadeDias}
                      contentAfter={<Caption1>dias</Caption1>}
                      onChange={(_, dados) => setValidadeDias(dados.value)}
                    />
                  </Field>

                  <Field label="Prazo de entrega" hint="Após a aprovação">
                    <Input
                      type="number"
                      min={1}
                      value={prazoEntregaDias}
                      contentAfter={<Caption1>dias</Caption1>}
                      onChange={(_, dados) => setPrazoEntregaDias(dados.value)}
                    />
                  </Field>
                </div>
              </Card>
            )}
          </section>

          <Divider />

          {/* Card: Itens. */}
          <section className="orcamento-editor__secao" aria-labelledby="secao-itens">
            <div className="orcamento-editor__titulo-secao">
              <div className="orcamento-editor__titulo-secao-rotulo">
                <ClipboardTaskListLtr20Regular aria-hidden />
                <Text as="h2" id="secao-itens" size={500} weight="semibold">
                  Itens do Orçamento
                </Text>
              </div>
              <Button appearance="subtle" icon={<Add20Regular />} onClick={adicionarItem}>
                Adicionar item
              </Button>
            </div>

            <Card appearance="outline" className="orcamento-editor__itens-card">
              <Table
                aria-label="Itens do orçamento"
                size="small"
                className="orcamento-editor__itens-tabela"
              >
                <TableHeader>
                  <TableRow>
                    <TableHeaderCell className="col-handle" />
                    <TableHeaderCell>Nome do item</TableHeaderCell>
                    <TableHeaderCell>Qtd</TableHeaderCell>
                    <TableHeaderCell>Un</TableHeaderCell>
                    <TableHeaderCell>Valor unitário</TableHeaderCell>
                    <TableHeaderCell className="col-total">Total</TableHeaderCell>
                    <TableHeaderCell className="col-actions" />
                  </TableRow>
                </TableHeader>
                <TableBody>
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
                </TableBody>
              </Table>
              <div className="orcamento-editor__totais-tabela">
                <div>
                  <Caption1>Subtotal dos itens</Caption1>
                  <Text className="orcamento-editor__moeda" weight="semibold">
                    {formatarMoeda(subtotal)}
                  </Text>
                </div>
              </div>
            </Card>
          </section>

          <Divider />

          {/* Card: Condições de Pagamento. */}
          <section className="orcamento-editor__secao" aria-labelledby="secao-condicoes">
            <div className="orcamento-editor__titulo-secao">
              <div className="orcamento-editor__titulo-secao-rotulo">
                <Payment20Regular aria-hidden />
                <Text as="h2" id="secao-condicoes" size={500} weight="semibold">
                  Condições de Pagamento
                </Text>
              </div>
              <Button appearance="subtle" icon={<Add20Regular />} onClick={adicionarCondicao}>
                Adicionar condição
              </Button>
            </div>

            {/* Soma dos percentuais anunciada via aria-live (RF-005/RF-007). */}
            <div role="status" aria-live="polite" aria-label="Soma dos percentuais">
              {condicoes.length > 0 && (
                <Badge
                  appearance="tint"
                  color={somaOk ? 'success' : 'warning'}
                  icon={somaOk ? <CheckmarkCircle20Filled /> : <Alert20Regular />}
                >
                  {somaOk
                    ? 'Soma dos percentuais: 100%'
                    : `Soma dos percentuais: ${somaPercentuais}% — faltam ${100 - somaPercentuais}%`}
                </Badge>
              )}
            </div>

            {erros.condicoes && (
              <Text id={condicoesErroId} role="alert" className={estilos.erroCampo}>
                {erros.condicoes}
              </Text>
            )}

            {condicoes.length === 0 ? (
              <Body1>Nenhuma condição de pagamento. Use “Adicionar condição”.</Body1>
            ) : (
              <ol className="orcamento-editor__condicoes" aria-label="Condições de pagamento">
                {condicoes.map((condicao, indice) => (
                  <li key={condicao.chave}>
                    <Card appearance="filled-alternative" className="orcamento-editor__condicao">
                      <Badge appearance="filled" shape="circular">
                        {indice + 1}
                      </Badge>
                      <Field label={`Descrição da condição ${indice + 1}`}>
                        <Input
                          value={condicao.descricao}
                          onChange={(_, dados) =>
                            alterarCondicao(condicao.chave, 'descricao', dados.value)
                          }
                        />
                      </Field>
                      <Field label={`Percentual da condição ${indice + 1}`}>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          contentAfter={<Caption1>%</Caption1>}
                          value={String(condicao.percentual)}
                          onChange={(_, dados) =>
                            alterarCondicao(condicao.chave, 'percentual', dados.value)
                          }
                        />
                      </Field>
                      <Field label={`Marco da condição ${indice + 1}`}>
                        <Input
                          value={condicao.marco}
                          placeholder="Ex: na aprovação"
                          onChange={(_, dados) =>
                            alterarCondicao(condicao.chave, 'marco', dados.value)
                          }
                        />
                      </Field>
                      <Field label={`Forma de pagamento da condição ${indice + 1}`}>
                        <Dropdown
                          value={condicao.formaPagamento}
                          selectedOptions={[condicao.formaPagamento]}
                          onOptionSelect={(_, dados) =>
                            alterarCondicao(
                              condicao.chave,
                              'formaPagamento',
                              dados.optionValue ?? 'PIX',
                            )
                          }
                        >
                          {FORMAS_PAGAMENTO.map((forma) => (
                            <Option key={forma}>{forma}</Option>
                          ))}
                        </Dropdown>
                      </Field>
                      <Tooltip content={`Excluir condição ${indice + 1}`} relationship="label">
                        <Button
                          appearance="subtle"
                          aria-label={`Excluir condição ${indice + 1}`}
                          icon={<Delete20Regular />}
                          onClick={() => removerCondicao(condicao.chave)}
                        />
                      </Tooltip>
                    </Card>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <Divider />

          {/* Card: Resumo Financeiro. */}
          <section className="orcamento-editor__secao" aria-labelledby="secao-resumo">
            <div className="orcamento-editor__titulo-secao">
              <div className="orcamento-editor__titulo-secao-rotulo">
                <Calculator20Regular aria-hidden />
                <Text as="h2" id="secao-resumo" size={500} weight="semibold">
                  Resumo Financeiro
                </Text>
              </div>
            </div>

            <Card appearance="filled-alternative" className="orcamento-editor__resumo-card">
              <div className="orcamento-editor__resumo-linha">
                <Body1>Subtotal</Body1>
                <Text className="orcamento-editor__moeda" size={400} weight="semibold">
                  {formatarMoeda(subtotal)}
                </Text>
              </div>

              <div className="orcamento-editor__resumo-linha">
                <div>
                  <Body1>Desconto global</Body1>
                  <div className="orcamento-editor__controles-desconto">
                    <Dropdown
                      aria-label="Tipo de desconto global"
                      size="small"
                      value={descontoGlobalTipo === 'percentual' ? '%' : 'R$'}
                      selectedOptions={[descontoGlobalTipo]}
                      onOptionSelect={(_, dados) =>
                        setDescontoGlobalTipo((dados.optionValue as DescontoTipo) ?? 'percentual')
                      }
                    >
                      <Option value="percentual">%</Option>
                      <Option value="fixo">R$</Option>
                    </Dropdown>
                    <Input
                      aria-label="Valor do desconto global"
                      type="number"
                      min={0}
                      step="any"
                      size="small"
                      value={Number.isFinite(descontoGlobalValor) ? String(descontoGlobalValor) : ''}
                      onChange={(_, dados) => setDescontoGlobalValor(paraNumero(dados.value))}
                    />
                  </div>
                </div>
                <Text className="orcamento-editor__moeda" size={400}>
                  −{formatarMoeda(descontoGlobalCalculado)}
                </Text>
              </div>

              <Divider />

              <div className="orcamento-editor__resumo-linha orcamento-editor__resumo-linha--total">
                <Text size={400} weight="semibold">
                  TOTAL
                </Text>
                {/* Total recalculado em tempo real, anunciado via aria-live. */}
                <Text
                  as="span"
                  role="status"
                  aria-live="polite"
                  aria-label="Total do orçamento"
                  className="orcamento-editor__total-destaque"
                  weight="bold"
                >
                  {formatarMoeda(total)}
                </Text>
              </div>
            </Card>
          </section>

          {/* Erro de envio: anunciado imediatamente por leitores de tela. */}
          {erroEnvio && (
            <MessageBar intent="error">
              <MessageBarBody role="alert" aria-live="assertive">
                {erroEnvio}
              </MessageBarBody>
            </MessageBar>
          )}

          {/* Confirmação de envio anunciada sem roubar o foco. */}
          <Text as="p" role="status" aria-live="polite" aria-label="Status do envio">
            {mensagemEnvio}
          </Text>

          {/* Link público da última versão enviada e lista de versões da sessão. */}
          {ultimaVersao && (
            <section aria-label="Orçamento enviado" className="orcamento-editor__secao">
              <Text as="h2" size={500} weight="semibold">
                Link público de aceite
              </Text>
              <Body1>
                <a href={urlPublica(ultimaVersao.tokenPublico)}>
                  Abrir orçamento{' '}
                  {ultimaVersao.versao > 0 ? `(versão ${ultimaVersao.versao})` : ''} para aceite
                </a>
              </Body1>
              <div>
                <Button
                  appearance="outline"
                  aria-label="Copiar link público do orçamento"
                  onClick={() => void copiarLink(ultimaVersao.tokenPublico)}
                >
                  Copiar link
                </Button>
              </div>
              <span role="status" aria-live="polite">
                {linkCopiado ? 'Link copiado para a área de transferência.' : ''}
              </span>

              <Text as="h2" id="titulo-versoes" size={500} weight="semibold">
                Versões
              </Text>
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

          {/* Ações finais, repetidas com Cancelar. */}
          <div className="orcamento-editor__acoes-finais">
            <Button type="button" onClick={voltar}>
              Cancelar
            </Button>
            <Button
              type="submit"
              appearance="outline"
              icon={<Save20Regular />}
              disabled={salvando}
            >
              {salvando ? 'Salvando…' : 'Salvar rascunho'}
            </Button>
            {podeEnviar && (
              <Button
                type="button"
                appearance="primary"
                icon={<Send20Regular />}
                onClick={() => {
                  setErroEnvio('')
                  setModalEnvioAberto(true)
                }}
              >
                Enviar
              </Button>
            )}
          </div>
        </div>
      </form>

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
    </main>
  )
}

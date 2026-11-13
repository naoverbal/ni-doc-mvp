import { useId, useState, type ReactElement } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Button,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Spinner,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  TabList,
  Text,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import {
  CheckmarkCircle24Regular,
  Clock24Regular,
  DataTrending24Regular,
  DismissCircle24Regular,
  DocumentAdd24Regular,
  DocumentMultiple24Regular,
  Money24Regular,
  Send24Regular,
} from '@fluentui/react-icons'
import { DonutChart, VerticalBarChart } from '@fluentui/react-charts'
import { CardKpi } from '@/components/dashboard/CardKpi'
import { useDashboard, useDashboardSerie } from '@/hooks/useDashboard'
import { DIAS_VENCIMENTO } from '@/lib/dashboard-config'
import { formatarDias, formatarMoeda, formatarPercentual } from '@/lib/formato'
import { ROTULO_STATUS } from '@/lib/orcamento-status'
import type {
  GranularidadeDashboard,
  OrcamentoDashboard,
  OrcamentoStatus,
  PontoCriados,
  PontoSerieStatus,
  ResumoDashboard,
  TempoDecisao,
  TipoSerieDashboard,
} from '@/types/api'

const TITULO_SERIE: Record<TipoSerieDashboard, string> = {
  criados: 'Orçamentos criados',
  enviados: 'Orçamentos enviados',
  aprovados: 'Orçamentos aprovados',
}

const DESCRICAO_SERIE: Record<TipoSerieDashboard, string> = {
  criados: 'Agrupados pela data de criação.',
  enviados:
    'Agrupados pela data do envio. Cancelamentos e expirações posteriores aparecem no período do envio.',
  aprovados:
    'Agrupados pela data da aprovação. Cancelamentos posteriores aparecem no período da aprovação.',
}

// Distingue pontos com valor e detalhamento por status dos pontos só de contagem.
function temDetalhePorStatus(ponto: PontoCriados | PontoSerieStatus): ponto is PontoSerieStatus {
  return 'porStatus' in ponto
}

// Ordem fixa dos status na distribuição (donut e legenda).
const ORDEM_STATUS: OrcamentoStatus[] = [
  'rascunho',
  'enviado',
  'aprovado',
  'reprovado',
  'expirado',
  'cancelado',
]

const useStyles = makeStyles({
  pagina: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXL,
    padding: tokens.spacingVerticalXXL,
    maxWidth: '1440px',
  },
  secao: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
  },
  gridCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },
  grafico: {
    maxWidth: '640px',
  },
  listas: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
    gap: tokens.spacingHorizontalXXL,
  },
  lista: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalS,
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  itemLista: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
    paddingBlock: tokens.spacingVerticalS,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  itemLinha: {
    display: 'flex',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalM,
  },
  // Link de item estilizado com tokens Fluent (sem cor hard-coded). Usa o
  // RouterLink nativo para navegação client-side, como na lista de orçamentos.
  link: {
    color: tokens.colorBrandForegroundLink,
    textDecorationLine: 'none',
    ':hover': {
      color: tokens.colorBrandForegroundLinkHover,
      textDecorationLine: 'underline',
    },
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
    },
  },
  itemMeta: {
    display: 'flex',
    columnGap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
  },
  vazio: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalM,
    paddingBlock: tokens.spacingVerticalXXXL,
    textAlign: 'center',
  },
  // Texto secundário (descrições, estados vazios) com cor de token Fluent,
  // seguindo o padrão de makeStyles das demais telas (sem inline style).
  textoSecundario: {
    color: tokens.colorNeutralForeground2,
  },
  carregando: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXL,
    padding: tokens.spacingVerticalXXL,
  },
  skeletonCards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: tokens.spacingHorizontalL,
  },
  skeletonCard: {
    height: '96px',
  },
})

// Fatias do donut: só os status com quantidade > 0, com rótulo textual (o status
// nunca é comunicado só por cor).
function fatiasDeStatus(resumo: ResumoDashboard): Array<{ legend: string; data: number }> {
  return ORDEM_STATUS.filter((status) => resumo.porStatus[status].quantidade > 0).map((status) => ({
    legend: ROTULO_STATUS[status],
    data: resumo.porStatus[status].quantidade,
  }))
}

function totalDeOrcamentos(resumo: ResumoDashboard): number {
  return ORDEM_STATUS.reduce((soma, status) => soma + resumo.porStatus[status].quantidade, 0)
}

function textoDiasAguardando(dias: number): string {
  if (dias === 0) return 'Enviado hoje'
  return dias === 1 ? 'Aguardando há 1 dia' : `Aguardando há ${dias} dias`
}

function textoDiasParaVencer(dias: number): string {
  return dias === 1 ? 'Vence em 1 dia' : `Vence em ${dias} dias`
}

// Descrição do card de tempo até a decisão: média geral e quebra por resultado.
function descricaoTempoDecisao(tempo: TempoDecisao): string {
  if (tempo.geral.quantidade === 0) return 'Sem decisões registradas'
  return (
    `Média ${formatarDias(tempo.geral.mediaDias)} em ${tempo.geral.quantidade} decisões. ` +
    `Aprovados: ${formatarDias(tempo.aprovados.medianaDias)}. ` +
    `Reprovados: ${formatarDias(tempo.reprovados.medianaDias)}.`
  )
}

// Item acionável de lista: número, título, cliente, status (rótulo + cor) e
// total, com link para o detalhe. O status leva rótulo textual, nunca só cor.
function ItemOrcamento({
  orcamento,
  detalhe,
}: {
  orcamento: Pick<
    OrcamentoDashboard,
    'id' | 'numero' | 'titulo' | 'status' | 'clienteNome' | 'total'
  >
  // Texto extra da linha de metadados (ex.: "Aguardando há 3 dias").
  detalhe?: string
}): ReactElement {
  const estilos = useStyles()
  return (
    <li className={estilos.itemLista}>
      <div className={estilos.itemLinha}>
        <RouterLink className={estilos.link} to={`/orcamentos/${orcamento.id}`}>
          {orcamento.numero} — {orcamento.titulo}
        </RouterLink>
        <Text weight="semibold">{formatarMoeda(orcamento.total)}</Text>
      </div>
      <div className={estilos.itemMeta}>
        <Text size={200}>{orcamento.clienteNome}</Text>
        <Text size={200} data-status={orcamento.status}>
          {ROTULO_STATUS[orcamento.status]}
        </Text>
        {detalhe !== undefined ? <Text size={200}>{detalhe}</Text> : null}
      </div>
    </li>
  )
}

// Detalhamento por período das séries de envio e aprovação: quantidade, valor e
// o impacto de cancelamentos (e expirações) no período de origem. Também serve
// de alternativa textual ao gráfico.
function TabelaSerie({
  titulo,
  pontos,
  mostrarExpirados,
}: {
  titulo: string
  pontos: PontoSerieStatus[]
  mostrarExpirados: boolean
}): ReactElement {
  return (
    <Table aria-label={`${titulo}: detalhamento por período`} size="small">
      <TableHeader>
        <TableRow>
          <TableHeaderCell>Período</TableHeaderCell>
          <TableHeaderCell>Orçamentos</TableHeaderCell>
          <TableHeaderCell>Valor</TableHeaderCell>
          <TableHeaderCell>Cancelados depois</TableHeaderCell>
          {mostrarExpirados ? <TableHeaderCell>Expirados</TableHeaderCell> : null}
        </TableRow>
      </TableHeader>
      <TableBody>
        {pontos.map((ponto) => (
          <TableRow key={ponto.chave}>
            <TableCell>{ponto.rotulo}</TableCell>
            <TableCell>{ponto.quantidade}</TableCell>
            <TableCell>{formatarMoeda(ponto.valor)}</TableCell>
            <TableCell>{ponto.porStatus.cancelado.quantidade}</TableCell>
            {mostrarExpirados ? <TableCell>{ponto.porStatus.expirado.quantidade}</TableCell> : null}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export function Dashboard(): ReactElement {
  const estilos = useStyles()
  const [granularidade, setGranularidade] = useState<GranularidadeDashboard>('mes')
  const [tipoSerie, setTipoSerie] = useState<TipoSerieDashboard>('criados')
  const serieId = useId()

  const { data, isLoading, isError } = useDashboard()
  const serie = useDashboardSerie(tipoSerie, granularidade)

  function aoSelecionarGranularidade(_evento: SelectTabEvent, dados: SelectTabData): void {
    setGranularidade(dados.value as GranularidadeDashboard)
  }

  function aoSelecionarSerie(_evento: SelectTabEvent, dados: SelectTabData): void {
    setTipoSerie(dados.value as TipoSerieDashboard)
  }

  if (isLoading) {
    return (
      <main id="conteudo">
        <h1>Painel de orçamentos</h1>
        <div className={estilos.carregando} role="status" aria-live="polite">
          <Spinner label="Carregando panorama…" />
          <Skeleton aria-label="Carregando indicadores" className={estilos.skeletonCards}>
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonItem key={i} className={estilos.skeletonCard} />
            ))}
          </Skeleton>
        </div>
      </main>
    )
  }

  if (isError || !data) {
    return (
      <main id="conteudo">
        <h1>Painel de orçamentos</h1>
        <div role="alert" aria-live="assertive">
          <MessageBar intent="error">
            <MessageBarBody>
              Não foi possível carregar o panorama. Tente novamente.
            </MessageBarBody>
          </MessageBar>
        </div>
      </main>
    )
  }

  const { resumo, recentes, pendentes, vencendo, tempoDecisao } = data
  const total = totalDeOrcamentos(resumo)

  if (total === 0) {
    return (
      <main id="conteudo">
        <h1>Painel de orçamentos</h1>
        <div className={estilos.vazio}>
          <DocumentAdd24Regular aria-hidden fontSize={48} />
          <Text size={500} weight="semibold">
            Nenhum orçamento ainda
          </Text>
          <Text size={300} className={estilos.textoSecundario}>
            Crie seu primeiro orçamento para acompanhar o panorama por aqui.
          </Text>
          <Button as="a" href="/orcamentos/novo" appearance="primary" icon={<DocumentAdd24Regular />}>
            Novo orçamento
          </Button>
        </div>
      </main>
    )
  }

  const fatiasDonut = fatiasDeStatus(resumo)

  const pontos = serie.data ?? []
  const pontosSerie = pontos.map((ponto) => ({ x: ponto.rotulo, y: ponto.quantidade }))
  const pontosDetalhados = pontos.filter(temDetalhePorStatus)

  return (
    <main id="conteudo" className={estilos.pagina}>
      <h1>Painel de orçamentos</h1>

      <section className={estilos.secao} aria-labelledby="secao-indicadores">
        <h2 id="secao-indicadores">Indicadores</h2>
        <div className={estilos.gridCards}>
          <CardKpi
            rotulo="Aguardando"
            valor={String(resumo.porStatus.enviado.quantidade)}
            descricao="Enviados sem decisão"
            icone={<Send24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Aprovados"
            valor={String(resumo.porStatus.aprovado.quantidade)}
            icone={<CheckmarkCircle24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Reprovados"
            valor={String(resumo.porStatus.reprovado.quantidade)}
            icone={<DismissCircle24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Rascunhos"
            valor={String(resumo.porStatus.rascunho.quantidade)}
            icone={<DocumentMultiple24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Total de orçamentos"
            valor={String(total)}
            icone={<DocumentMultiple24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Valor em aberto"
            valor={formatarMoeda(resumo.valorEmAberto)}
            descricao="Soma dos enviados aguardando decisão"
            icone={<Money24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Valor total enviado"
            valor={formatarMoeda(resumo.valorEnviado)}
            descricao="Enviados + aprovados + reprovados"
            icone={<Money24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Taxa de conversão"
            valor={formatarPercentual(resumo.taxaConversao)}
            descricao="Aprovados sobre enviados, aprovados e reprovados"
            icone={<DataTrending24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Tempo mediano até a decisão"
            valor={formatarDias(tempoDecisao.geral.medianaDias)}
            descricao={descricaoTempoDecisao(tempoDecisao)}
            icone={<Clock24Regular aria-hidden />}
          />
        </div>
      </section>

      <section className={estilos.secao} aria-labelledby="secao-distribuicao">
        <h2 id="secao-distribuicao">Distribuição por status</h2>
        <div className={estilos.grafico}>
          <DonutChart
            data={{
              chartTitle: 'Distribuição de orçamentos por status',
              chartData: fatiasDonut,
              chartTitleAccessibilityData: {
                ariaLabel: 'Distribuição de orçamentos por status',
              },
            }}
            hideLegend={false}
          />
        </div>
      </section>

      <section className={estilos.secao} aria-labelledby="secao-serie">
        <h2 id="secao-serie">{TITULO_SERIE[tipoSerie]}</h2>
        <Text size={200} className={estilos.textoSecundario}>
          {DESCRICAO_SERIE[tipoSerie]}
        </Text>
        <TabList
          selectedValue={tipoSerie}
          onTabSelect={aoSelecionarSerie}
          aria-label="Série do gráfico"
        >
          <Tab value="criados">Criação</Tab>
          <Tab value="enviados">Envio</Tab>
          <Tab value="aprovados">Aprovação</Tab>
        </TabList>
        <TabList
          selectedValue={granularidade}
          onTabSelect={aoSelecionarGranularidade}
          aria-label="Granularidade da série"
        >
          <Tab value="semana">Semana</Tab>
          <Tab value="mes">Mês</Tab>
          <Tab value="ano">Ano</Tab>
        </TabList>
        <div className={estilos.grafico} id={serieId}>
          {serie.isError ? (
            <div role="alert" aria-live="assertive">
              <MessageBar intent="error">
                <MessageBarBody>Não foi possível carregar a série. Tente novamente.</MessageBarBody>
              </MessageBar>
            </div>
          ) : pontosSerie.length > 0 ? (
            <VerticalBarChart
              data={pontosSerie}
              chartTitle={`${TITULO_SERIE[tipoSerie]} por período`}
              hideLegend
            />
          ) : (
            <Text role="status" aria-live="polite">
              Sem orçamentos no período para exibir.
            </Text>
          )}
        </div>
        {!serie.isError && pontosDetalhados.length > 0 ? (
          <TabelaSerie
            titulo={TITULO_SERIE[tipoSerie]}
            pontos={pontosDetalhados}
            mostrarExpirados={tipoSerie === 'enviados'}
          />
        ) : null}
      </section>

      <section className={estilos.listas} aria-label="Listas de orçamentos">
        <div className={estilos.secao}>
          <h2 id="secao-recentes">Orçamentos recentes</h2>
          <ul className={estilos.lista} aria-labelledby="secao-recentes">
            {recentes.map((orcamento) => (
              <ItemOrcamento key={orcamento.id} orcamento={orcamento} />
            ))}
          </ul>
        </div>

        <div className={estilos.secao}>
          <h2 id="secao-aguardando">Aguardando há mais tempo</h2>
          {pendentes.length > 0 ? (
            <ul className={estilos.lista} aria-labelledby="secao-aguardando">
              {pendentes.map((orcamento) => (
                <ItemOrcamento
                  key={orcamento.id}
                  orcamento={orcamento}
                  detalhe={
                    orcamento.diasAguardando === null
                      ? undefined
                      : textoDiasAguardando(orcamento.diasAguardando)
                  }
                />
              ))}
            </ul>
          ) : (
            <Text className={estilos.textoSecundario}>
              Nenhum orçamento aguardando decisão.
            </Text>
          )}
        </div>

        <div className={estilos.secao}>
          <h2 id="secao-vencendo">{`Vencendo nos próximos ${DIAS_VENCIMENTO} dias`}</h2>
          {vencendo.length > 0 ? (
            <ul className={estilos.lista} aria-labelledby="secao-vencendo">
              {vencendo.map((orcamento) => (
                <ItemOrcamento
                  key={orcamento.id}
                  orcamento={orcamento}
                  detalhe={textoDiasParaVencer(orcamento.diasParaVencer)}
                />
              ))}
            </ul>
          ) : (
            <Text className={estilos.textoSecundario}>
              Nenhum orçamento vence nesse período.
            </Text>
          )}
        </div>
      </section>
    </main>
  )
}

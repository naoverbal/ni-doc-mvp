import { useId, useMemo, useState, type ReactElement } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Button,
  MessageBar,
  MessageBarBody,
  Skeleton,
  SkeletonItem,
  Spinner,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
  type SelectTabData,
  type SelectTabEvent,
} from '@fluentui/react-components'
import {
  CheckmarkCircle24Regular,
  DataTrending24Regular,
  DismissCircle24Regular,
  DocumentAdd24Regular,
  DocumentMultiple24Regular,
  Money24Regular,
  Send24Regular,
} from '@fluentui/react-icons'
import { DonutChart, VerticalBarChart } from '@fluentui/react-charts'
import { CardKpi } from '@/components/dashboard/CardKpi'
import { useDashboardOrcamentos } from '@/hooks/useDashboardOrcamentos'
import {
  aguardandoHaMaisTempo,
  agruparCriadosPorPeriodo,
  contarPorStatus,
  distribuicaoPorStatus,
  recentes,
  taxaConversao,
  valorEmAberto,
  valorEnviado,
  type Granularidade,
} from '@/lib/dashboard-metricas'
import { formatarMoeda, formatarPercentual } from '@/lib/formato'
import { ROTULO_STATUS } from '@/lib/orcamento-status'
import type { OrcamentoResumo } from '@/types/api'

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

// Métricas derivadas das funções puras; memoizadas por lista de orçamentos.
function useMetricas(orcamentos: OrcamentoResumo[]) {
  return useMemo(() => {
    const contagem = contarPorStatus(orcamentos)
    return {
      contagem,
      total: orcamentos.length,
      emAberto: valorEmAberto(orcamentos),
      enviado: valorEnviado(orcamentos),
      taxa: taxaConversao(orcamentos),
      distribuicao: distribuicaoPorStatus(orcamentos),
      maisRecentes: recentes(orcamentos),
      aguardando: aguardandoHaMaisTempo(orcamentos),
    }
  }, [orcamentos])
}

// Item acionável de lista: número, título, status (rótulo + cor) e total, com
// link para o detalhe. O status leva rótulo textual, nunca só cor.
function ItemOrcamento({ orcamento }: { orcamento: OrcamentoResumo }): ReactElement {
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
        <Text size={200} data-status={orcamento.status}>
          {ROTULO_STATUS[orcamento.status]}
        </Text>
      </div>
    </li>
  )
}

export function Dashboard(): ReactElement {
  const estilos = useStyles()
  const [granularidade, setGranularidade] = useState<Granularidade>('mes')
  const serieId = useId()

  const { data, isLoading, isError } = useDashboardOrcamentos()
  const orcamentos = useMemo(() => data ?? [], [data])
  const metricas = useMetricas(orcamentos)

  const serie = useMemo(
    () => agruparCriadosPorPeriodo(orcamentos, granularidade),
    [orcamentos, granularidade],
  )

  function aoSelecionarGranularidade(_evento: SelectTabEvent, dados: SelectTabData): void {
    setGranularidade(dados.value as Granularidade)
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

  if (isError) {
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

  if (orcamentos.length === 0) {
    return (
      <main id="conteudo">
        <h1>Painel de orçamentos</h1>
        <div className={estilos.vazio}>
          <DocumentAdd24Regular aria-hidden fontSize={48} />
          <Text size={500} weight="semibold">
            Nenhum orçamento ainda
          </Text>
          <Text size={300} style={{ color: tokens.colorNeutralForeground2 }}>
            Crie seu primeiro orçamento para acompanhar o panorama por aqui.
          </Text>
          <Button as="a" href="/orcamentos/novo" appearance="primary" icon={<DocumentAdd24Regular />}>
            Novo orçamento
          </Button>
        </div>
      </main>
    )
  }

  const fatiasDonut = metricas.distribuicao.map((fatia) => ({
    legend: fatia.legenda,
    data: fatia.valor,
  }))

  const pontosSerie = serie.map((ponto) => ({ x: ponto.rotulo, y: ponto.quantidade }))

  return (
    <main id="conteudo" className={estilos.pagina}>
      <h1>Painel de orçamentos</h1>

      <section className={estilos.secao} aria-labelledby="secao-indicadores">
        <h2 id="secao-indicadores">Indicadores</h2>
        <div className={estilos.gridCards}>
          <CardKpi
            rotulo="Aguardando"
            valor={String(metricas.contagem.enviado)}
            descricao="Enviados sem decisão"
            icone={<Send24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Aprovados"
            valor={String(metricas.contagem.aprovado)}
            icone={<CheckmarkCircle24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Reprovados"
            valor={String(metricas.contagem.reprovado)}
            icone={<DismissCircle24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Rascunhos"
            valor={String(metricas.contagem.rascunho)}
            icone={<DocumentMultiple24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Total de orçamentos"
            valor={String(metricas.total)}
            icone={<DocumentMultiple24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Valor em aberto"
            valor={formatarMoeda(metricas.emAberto)}
            descricao="Soma dos enviados aguardando decisão"
            icone={<Money24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Valor total enviado"
            valor={formatarMoeda(metricas.enviado)}
            descricao="Enviados + aprovados + reprovados"
            icone={<Money24Regular aria-hidden />}
          />
          <CardKpi
            rotulo="Taxa de conversão"
            valor={formatarPercentual(metricas.taxa)}
            descricao="Aprovados sobre os que saíram de rascunho"
            icone={<DataTrending24Regular aria-hidden />}
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
        <h2 id="secao-serie">Orçamentos criados</h2>
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
          {pontosSerie.length > 0 ? (
            <VerticalBarChart
              data={pontosSerie}
              chartTitle="Orçamentos criados por período"
              hideLegend
            />
          ) : (
            <Text role="status" aria-live="polite">
              Sem orçamentos no período para exibir.
            </Text>
          )}
        </div>
      </section>

      <section className={estilos.listas} aria-label="Listas de orçamentos">
        <div className={estilos.secao}>
          <h2 id="secao-recentes">Orçamentos recentes</h2>
          <ul className={estilos.lista} aria-labelledby="secao-recentes">
            {metricas.maisRecentes.map((orcamento) => (
              <ItemOrcamento key={orcamento.id} orcamento={orcamento} />
            ))}
          </ul>
        </div>

        <div className={estilos.secao}>
          <h2 id="secao-aguardando">Aguardando há mais tempo</h2>
          {metricas.aguardando.length > 0 ? (
            <ul className={estilos.lista} aria-labelledby="secao-aguardando">
              {metricas.aguardando.map((orcamento) => (
                <ItemOrcamento key={orcamento.id} orcamento={orcamento} />
              ))}
            </ul>
          ) : (
            <Text style={{ color: tokens.colorNeutralForeground2 }}>
              Nenhum orçamento aguardando decisão.
            </Text>
          )}
        </div>
      </section>
    </main>
  )
}

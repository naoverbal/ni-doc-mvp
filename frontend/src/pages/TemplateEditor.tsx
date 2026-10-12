import { useEffect, useId, useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Button,
  Divider,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  ArrowLeft20Regular,
  CheckmarkCircle16Filled,
  Image24Regular,
  Layer24Regular,
  Save20Regular,
  TextT24Regular,
} from '@fluentui/react-icons'
import type {
  ElementoAreaItens,
  ElementoImagem,
  ElementoTemplate,
  ElementoTexto,
  FonteTemplate,
  LayoutTemplate,
} from '@/types/api'
import { useSalvarTemplate, useTemplateAtual } from '@/hooks/useTemplate'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { CanvasA4, ALTURA_A4_MM, LARGURA_A4_MM } from '@/components/CanvasA4'

// Placeholders de dados disponíveis para inserir no template (RF-014.7).
const PLACEHOLDERS = [
  '{cliente}',
  '{numero}',
  '{titulo}',
  '{data_emissao}',
  '{valor_total}',
  '{responsavel}',
] as const

// Formatos aceitos por tipo de upload (RF-014.2/3/5).
const ACEITA_IMAGEM = 'image/png,image/jpeg,image/svg+xml'
const ACEITA_FUNDO = 'application/pdf,image/png,image/jpeg'
const ACEITA_FONTE = '.ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2'

// Breakpoint de gate do editor: abaixo do Large/XLarge do Fluent (1024px) a
// tela é pequena demais para a ferramenta e o editor fica indisponível.
const CONSULTA_MOBILE = '(max-width: 1023px)'

// Layout inicial de um template vazio (uma página A4 em branco).
function layoutInicial(): LayoutTemplate {
  return {
    versao: 1,
    paginas: [{ fundo: null, largura: LARGURA_A4_MM, altura: ALTURA_A4_MM, elementos: [] }],
    fontes: [],
  }
}

// Gera um id estável para novos elementos sem depender de libs externas.
function novoId(prefixo: string): string {
  const aleatorio =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `${prefixo}-${aleatorio}`
}

// Lê um arquivo como data URL (base64) para embutir no JSON do template.
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(String(leitor.result))
    leitor.onerror = () => rejeitar(leitor.error)
    leitor.readAsDataURL(arquivo)
  })
}

// Deriva o formato da fonte a partir do nome do arquivo.
function formatoFonte(nome: string): FonteTemplate['formato'] {
  const ext = nome.split('.').pop()?.toLowerCase()
  if (ext === 'otf') return 'otf'
  if (ext === 'woff') return 'woff'
  if (ext === 'woff2') return 'woff2'
  return 'ttf'
}

// Rótulo humano do tipo de elemento, usado no painel contextual (comunica a
// seleção por texto, não só por cor/forma).
function rotuloTipo(tipo: ElementoTemplate['tipo']): string {
  if (tipo === 'texto') return 'Texto'
  if (tipo === 'imagem') return 'Imagem'
  return 'Área de itens'
}

const useStyles = makeStyles({
  // Página ocupa a altura disponível; o scroll fica interno (canvas/painel),
  // não na página — desktop sem scroll (RF/plano item 2).
  pagina: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
  },
  // Barra de ações da página: volta, indicador de salvo e botão primário.
  barraAcoes: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalL,
    paddingInline: tokens.spacingHorizontalXXL,
    paddingBlock: tokens.spacingVerticalM,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  acoesEsquerda: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalL,
  },
  acoesDireita: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
  },
  voltar: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorBrandForegroundLink,
    textDecorationLine: 'none',
    ':hover': {
      color: tokens.colorBrandForegroundLinkHover,
      textDecorationLine: 'underline',
    },
    ':focus-visible': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
      borderRadius: tokens.borderRadiusMedium,
    },
  },
  salvo: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    color: tokens.colorStatusSuccessForeground1,
  },
  // Faixa de título: eyebrow + título à esquerda, texto auxiliar à direita.
  faixaTitulo: {
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: tokens.spacingHorizontalXXL,
    paddingInline: tokens.spacingHorizontalXXL,
    paddingBlock: tokens.spacingVerticalL,
    borderBottom: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
  },
  eyebrow: {
    display: 'block',
    marginBottom: tokens.spacingVerticalXXS,
    color: tokens.colorBrandForeground1,
    textTransform: 'uppercase',
    letterSpacing: '0.12em',
    fontWeight: tokens.fontWeightSemibold,
  },
  auxiliar: {
    maxWidth: '28rem',
    textAlign: 'right',
    color: tokens.colorNeutralForeground2,
  },
  erroBarra: {
    paddingInline: tokens.spacingHorizontalXXL,
    paddingTop: tokens.spacingVerticalM,
  },
  // Grid 2 colunas: canvas flexível + painel de ~360px (23rem).
  grade: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 23rem',
    flex: 1,
    minHeight: 0,
  },
  // Área do canvas: fundo neutro pontilhado, folha A4 centralizada.
  areaCanvas: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'auto',
    padding: tokens.spacingVerticalXXL,
    backgroundColor: tokens.colorNeutralBackground3,
    backgroundImage: `radial-gradient(${tokens.colorNeutralStroke2} 1px, transparent 1px)`,
    backgroundSize: '20px 20px',
  },
  folha: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalM,
  },
  canvasMoldura: {
    boxShadow: tokens.shadow16,
  },
  badge: {
    position: 'absolute',
    left: tokens.spacingHorizontalL,
    bottom: tokens.spacingVerticalL,
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalXS,
    paddingInline: tokens.spacingHorizontalM,
    paddingBlock: tokens.spacingVerticalXS,
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow4,
    color: tokens.colorNeutralForeground2,
  },
  pontoVivo: {
    width: '8px',
    height: '8px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorStatusSuccessForeground1,
  },
  // Painel direito com rolagem própria.
  painel: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXL,
    padding: tokens.spacingHorizontalXL,
    overflowY: 'auto',
    minHeight: 0,
    borderLeft: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
  },
  secao: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
  },
  secaoCabecalho: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
  },
  heading: {
    margin: 0,
    fontSize: tokens.fontSizeBase400,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground1,
  },
  // Três ferramentas de construção em grade.
  gridFerramentas: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: tokens.spacingHorizontalS,
  },
  // Botão/upload de ferramenta: ícone em cima, rótulo embaixo.
  ferramenta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    rowGap: tokens.spacingVerticalS,
    minHeight: '5rem',
    height: 'auto',
    padding: tokens.spacingHorizontalM,
    textAlign: 'left',
  },
  // Upload estilizado como ferramenta: um <label> que embrulha um input file
  // escondido (acessível, com nome via texto visível).
  uploadFerramenta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    rowGap: tokens.spacingVerticalS,
    minHeight: '5rem',
    padding: tokens.spacingHorizontalM,
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke1Hover}`,
    },
    ':focus-within': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  // Upload em bloco largo (carregar arquivo base / fonte): borda tracejada.
  uploadBloco: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    minHeight: '3.5rem',
    padding: tokens.spacingHorizontalM,
    cursor: 'pointer',
    borderRadius: tokens.borderRadiusMedium,
    border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    color: tokens.colorNeutralForeground1,
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground2Hover,
      border: `${tokens.strokeWidthThin} dashed ${tokens.colorNeutralStroke1Hover}`,
    },
    ':focus-within': {
      outline: `${tokens.strokeWidthThick} solid ${tokens.colorStrokeFocus2}`,
      outlineOffset: '2px',
    },
  },
  iconeFerramenta: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '2rem',
    height: '2rem',
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground2,
  },
  // Esconde visualmente o input file preservando acessibilidade.
  inputArquivo: {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: 0,
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
  listaFontes: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    margin: 0,
    paddingLeft: tokens.spacingHorizontalL,
    color: tokens.colorNeutralForeground2,
  },
  status: {
    color: tokens.colorNeutralForeground2,
  },
  // Painel contextual do elemento selecionado, ancorado abaixo da folha.
  contexto: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    width: '100%',
    maxWidth: '32rem',
    padding: tokens.spacingHorizontalL,
    borderRadius: tokens.borderRadiusLarge,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    backgroundColor: tokens.colorNeutralBackground1,
    boxShadow: tokens.shadow8,
  },
  fieldset: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalM,
    margin: 0,
    padding: tokens.spacingHorizontalM,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  legend: {
    paddingInline: tokens.spacingHorizontalXS,
    fontSize: tokens.fontSizeBase200,
    fontWeight: tokens.fontWeightSemibold,
    color: tokens.colorNeutralForeground2,
  },
  linhaPosicao: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: tokens.spacingHorizontalM,
  },
  placeholders: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: tokens.spacingHorizontalXS,
    margin: 0,
    padding: tokens.spacingHorizontalM,
    border: `${tokens.strokeWidthThin} solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
  },
  // Gate de mobile: mensagem centralizada.
  gate: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: tokens.spacingVerticalL,
    minHeight: '60vh',
    padding: tokens.spacingVerticalXXXL,
    textAlign: 'center',
  },
  carregando: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
    padding: tokens.spacingVerticalXXXL,
    alignItems: 'center',
  },
})

export function TemplateEditor(): ReactElement {
  const estilos = useStyles()
  const { data: template, isLoading } = useTemplateAtual()
  const salvar = useSalvarTemplate()

  // Gate de desktop: abaixo de ~1024px o editor fica indisponível. No jsdom o
  // mock de matchMedia devolve matches:false, então os testes caem no editor.
  const ehMobile = useMediaQuery(CONSULTA_MOBILE)

  const [layout, setLayout] = useState<LayoutTemplate>(layoutInicial)
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')
  const [familiaFonte, setFamiliaFonte] = useState('')

  const imagemId = useId()
  const fundoId = useId()
  const fonteId = useId()
  const familiaId = useId()
  const posXId = useId()
  const posYId = useId()
  const conteudoId = useId()

  // Pré-carrega o layout da versão ativa quando o template chega.
  useEffect(() => {
    if (template?.layoutJson?.paginas) {
      setLayout(template.layoutJson)
    }
  }, [template])

  const pagina = layout.paginas[0]
  const elementos = useMemo(() => pagina?.elementos ?? [], [pagina])
  const selecionado = elementos.find((el) => el.id === selecionadoId) ?? null

  // Atualiza os elementos da primeira página de forma imutável.
  function atualizarElementos(
    atualizador: (atual: ElementoTemplate[]) => ElementoTemplate[],
  ): void {
    setLayout((atual) => {
      const primeira = atual.paginas[0]
      if (!primeira) return atual
      const novasPaginas = [...atual.paginas]
      novasPaginas[0] = { ...primeira, elementos: atualizador(primeira.elementos) }
      return { ...atual, paginas: novasPaginas }
    })
  }

  function moverElemento(id: string, x: number, y: number): void {
    atualizarElementos((atual) => atual.map((el) => (el.id === id ? { ...el, x, y } : el)))
  }

  function adicionarTexto(): void {
    const el: ElementoTexto = {
      id: novoId('texto'),
      tipo: 'texto',
      x: 20,
      y: 20,
      largura: 80,
      altura: 10,
      conteudo: 'Novo texto',
      fonte: 'Inter',
      tamanho: 12,
      alinhamento: 'left',
      cor: '#000000',
      nivelTitulo: 0,
    }
    atualizarElementos((atual) => [...atual, el])
    setSelecionadoId(el.id)
  }

  function adicionarAreaItens(): void {
    const el: ElementoAreaItens = {
      id: novoId('area'),
      tipo: 'area-itens',
      x: 20,
      y: 120,
      largura: 170,
      altura: 120,
      alturaMaxima: 120,
      quebraPagina: true,
    }
    atualizarElementos((atual) => [...atual, el])
    setSelecionadoId(el.id)
  }

  async function aoEnviarImagem(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    setErro('')
    try {
      const src = await lerComoDataUrl(arquivo)
      const el: ElementoImagem = {
        id: novoId('imagem'),
        tipo: 'imagem',
        x: 20,
        y: 20,
        largura: 40,
        altura: 40,
        src,
        ajuste: 'contain',
        rotacao: 0,
        descricao: arquivo.name,
      }
      atualizarElementos((atual) => [...atual, el])
      setSelecionadoId(el.id)
    } catch {
      setErro('Não foi possível ler a imagem selecionada.')
    } finally {
      evento.target.value = ''
    }
  }

  async function aoEnviarFundo(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    setErro('')
    try {
      const fundo = await lerComoDataUrl(arquivo)
      setLayout((atual) => {
        const primeira = atual.paginas[0]
        if (!primeira) return atual
        const novasPaginas = [...atual.paginas]
        novasPaginas[0] = { ...primeira, fundo }
        return { ...atual, paginas: novasPaginas }
      })
    } catch {
      setErro('Não foi possível ler o arquivo de fundo selecionado.')
    } finally {
      evento.target.value = ''
    }
  }

  async function aoEnviarFonte(evento: ChangeEvent<HTMLInputElement>): Promise<void> {
    const arquivo = evento.target.files?.[0]
    if (!arquivo) return
    setErro('')
    const familia = familiaFonte.trim() || arquivo.name.replace(/\.[^.]+$/, '')
    try {
      const src = await lerComoDataUrl(arquivo)
      const fonte: FonteTemplate = { familia, src, formato: formatoFonte(arquivo.name) }
      // Agrupa por família: mantém uma entrada por família (RF-014.6).
      setLayout((atual) => ({
        ...atual,
        fontes: [...atual.fontes.filter((f) => f.familia !== familia), fonte],
      }))
    } catch {
      setErro('Não foi possível ler a fonte selecionada.')
    } finally {
      evento.target.value = ''
    }
  }

  function inserirPlaceholder(placeholder: string): void {
    if (!selecionado || selecionado.tipo !== 'texto') return
    atualizarElementos((atual) =>
      atual.map((el) =>
        el.id === selecionado.id && el.tipo === 'texto'
          ? { ...el, conteudo: `${el.conteudo}${placeholder}` }
          : el,
      ),
    )
  }

  function alterarConteudo(valor: string): void {
    if (!selecionado || selecionado.tipo !== 'texto') return
    atualizarElementos((atual) =>
      atual.map((el) =>
        el.id === selecionado.id && el.tipo === 'texto' ? { ...el, conteudo: valor } : el,
      ),
    )
  }

  // Reposicionamento preciso por campos numéricos: alternativa de teclado ao
  // arrastar, garantindo operação sem mouse (WCAG 2.1.1).
  function alterarPosicao(eixo: 'x' | 'y', valor: number): void {
    if (!selecionado || Number.isNaN(valor)) return
    const limite =
      eixo === 'x' ? LARGURA_A4_MM - selecionado.largura : ALTURA_A4_MM - selecionado.altura
    const seguro = Math.min(Math.max(valor, 0), Math.max(0, limite))
    moverElemento(
      selecionado.id,
      eixo === 'x' ? seguro : selecionado.x,
      eixo === 'y' ? seguro : selecionado.y,
    )
  }

  async function aoSalvar(): Promise<void> {
    setErro('')
    setMensagem('')
    try {
      const salvo = await salvar.mutateAsync({ layoutJson: layout })
      setMensagem(`Alterações salvas. Versão ${salvo.versao} criada.`)
    } catch {
      setErro('Não foi possível salvar o template. Verifique suas permissões e tente novamente.')
    }
  }

  // Gate de mobile: a ferramenta é complexa demais para telas pequenas.
  if (ehMobile) {
    return (
      <main id="conteudo" className={estilos.gate}>
        <Title2 as="h1">Editor de template</Title2>
        <MessageBar intent="info">
          <MessageBarBody>
            O editor de template requer uma tela maior (desktop).
          </MessageBarBody>
        </MessageBar>
      </main>
    )
  }

  if (isLoading) {
    return (
      <main id="conteudo" className={estilos.carregando}>
        <Title2 as="h1">Editor de template</Title2>
        <Spinner label="Carregando template…" role="status" aria-live="polite" />
      </main>
    )
  }

  return (
    <main id="conteudo" className={estilos.pagina}>
      {/* Barra de ações: voltar, indicador de salvo e salvar (único primary). */}
      <div className={estilos.barraAcoes}>
        <div className={estilos.acoesEsquerda}>
          <RouterLink to="/dashboard" className={estilos.voltar}>
            <ArrowLeft20Regular aria-hidden />
            Templates
          </RouterLink>
        </div>
        <div className={estilos.acoesDireita}>
          <Text
            as="span"
            size={200}
            role="status"
            aria-live="polite"
            aria-label="Status do salvamento"
            className={estilos.salvo}
          >
            {mensagem && (
              <>
                <CheckmarkCircle16Filled aria-hidden />
                {mensagem}
              </>
            )}
          </Text>
          <Button
            appearance="primary"
            icon={salvar.isPending ? <Spinner size="tiny" /> : <Save20Regular />}
            disabled={salvar.isPending}
            onClick={() => void aoSalvar()}
          >
            {salvar.isPending ? 'Salvando…' : 'Salvar template'}
          </Button>
        </div>
      </div>

      {/* Faixa de título. */}
      <div className={estilos.faixaTitulo}>
        <div>
          <Text as="span" size={200} className={estilos.eyebrow}>
            Templates
          </Text>
          <Title2 as="h1">Editor de template</Title2>
        </div>
        <Text as="p" size={200} className={estilos.auxiliar}>
          Adicione elementos pelo painel e visualize as alterações em tempo real.
        </Text>
      </div>

      {erro && (
        <div className={estilos.erroBarra} role="alert" aria-live="assertive">
          <MessageBar intent="error">
            <MessageBarBody>{erro}</MessageBarBody>
          </MessageBar>
        </div>
      )}

      <div className={estilos.grade}>
        {/* Coluna esquerda: canvas com fundo pontilhado e folha A4. */}
        <section className={estilos.areaCanvas} aria-label="Área de edição do template">
          <div className={estilos.folha}>
            <div className={estilos.canvasMoldura}>
              <CanvasA4
                elementos={elementos}
                selecionadoId={selecionadoId}
                aoSelecionar={setSelecionadoId}
                aoMover={moverElemento}
                fundo={pagina?.fundo}
              />
            </div>

            {/* Painel contextual: aparece só quando há elemento selecionado. */}
            {selecionado && (
              <div className={estilos.contexto} aria-label="Propriedades do elemento selecionado">
                <Text as="p" size={300} role="status" aria-live="polite">
                  Selecionado: {rotuloTipo(selecionado.tipo)} na posição {selecionado.x} por{' '}
                  {selecionado.y} milímetros.
                </Text>

                <fieldset className={estilos.fieldset}>
                  <legend className={estilos.legend}>Posição (milímetros)</legend>
                  <div className={estilos.linhaPosicao}>
                    <Field label="Posição horizontal (X)">
                      <Input
                        id={posXId}
                        type="number"
                        min={0}
                        max={LARGURA_A4_MM}
                        value={String(selecionado.x)}
                        onChange={(_e, dados) => alterarPosicao('x', Number(dados.value))}
                      />
                    </Field>
                    <Field label="Posição vertical (Y)">
                      <Input
                        id={posYId}
                        type="number"
                        min={0}
                        max={ALTURA_A4_MM}
                        value={String(selecionado.y)}
                        onChange={(_e, dados) => alterarPosicao('y', Number(dados.value))}
                      />
                    </Field>
                  </div>
                </fieldset>

                {selecionado.tipo === 'texto' && (
                  <>
                    <Field label="Conteúdo">
                      <Input
                        id={conteudoId}
                        type="text"
                        value={selecionado.conteudo}
                        onChange={(_e, dados) => alterarConteudo(dados.value)}
                      />
                    </Field>
                    <fieldset className={estilos.placeholders}>
                      <legend className={estilos.legend}>Inserir placeholder</legend>
                      {PLACEHOLDERS.map((p) => (
                        <Button
                          key={p}
                          size="small"
                          appearance="outline"
                          aria-label={`Inserir placeholder ${p}`}
                          onClick={() => inserirPlaceholder(p)}
                        >
                          {p}
                        </Button>
                      ))}
                    </fieldset>
                  </>
                )}
              </div>
            )}
          </div>

          <div className={estilos.badge} aria-hidden="true">
            <span className={estilos.pontoVivo} />
            <Text size={200}>Visualização em tempo real</Text>
          </div>
        </section>

        {/* Coluna direita: painel de controles com rolagem própria. */}
        <aside className={estilos.painel} aria-label="Controles do template">
          <section className={estilos.secao} aria-labelledby="secao-elementos">
            <div className={estilos.secaoCabecalho}>
              <Text as="span" size={200} className={estilos.eyebrow}>
                Construção
              </Text>
              <h2 id="secao-elementos" className={estilos.heading}>
                Elementos
              </h2>
            </div>
            <div className={estilos.gridFerramentas}>
              <Button className={estilos.ferramenta} appearance="secondary" onClick={adicionarTexto}>
                <span className={estilos.iconeFerramenta} aria-hidden>
                  <TextT24Regular />
                </span>
                Adicionar texto
              </Button>
              <Button
                className={estilos.ferramenta}
                appearance="secondary"
                onClick={adicionarAreaItens}
              >
                <span className={estilos.iconeFerramenta} aria-hidden>
                  <Layer24Regular />
                </span>
                Desenhar área de itens
              </Button>
              <label className={estilos.uploadFerramenta} htmlFor={imagemId}>
                <span className={estilos.iconeFerramenta} aria-hidden>
                  <Image24Regular />
                </span>
                <Text size={200} weight="semibold">
                  Adicionar imagem
                </Text>
                <input
                  id={imagemId}
                  className={estilos.inputArquivo}
                  type="file"
                  accept={ACEITA_IMAGEM}
                  onChange={(e) => void aoEnviarImagem(e)}
                />
              </label>
            </div>
          </section>

          <Divider />

          <section className={estilos.secao} aria-labelledby="secao-aparencia">
            <div className={estilos.secaoCabecalho}>
              <Text as="span" size={200} className={estilos.eyebrow}>
                Aparência
              </Text>
              <h2 id="secao-aparencia" className={estilos.heading}>
                Fundos e fontes
              </h2>
            </div>

            <div className={estilos.secao}>
              <label className={estilos.uploadBloco} htmlFor={fundoId}>
                <span className={estilos.iconeFerramenta} aria-hidden>
                  <Image24Regular />
                </span>
                <Text size={300} weight="semibold">
                  Carregar arquivo base (PDF)
                </Text>
                <input
                  id={fundoId}
                  className={estilos.inputArquivo}
                  type="file"
                  accept={ACEITA_FUNDO}
                  onChange={(e) => void aoEnviarFundo(e)}
                />
              </label>
              <Text size={200} role="status" aria-live="polite" className={estilos.status}>
                {pagina?.fundo ? 'Arquivo de fundo carregado.' : ''}
              </Text>
            </div>

            <Field label="Fonte do documento">
              <Input
                id={familiaId}
                type="text"
                value={familiaFonte}
                placeholder="Ex.: Inter"
                onChange={(_e, dados) => setFamiliaFonte(dados.value)}
              />
            </Field>

            <div className={estilos.secao}>
              <label className={estilos.uploadBloco} htmlFor={fonteId}>
                <span className={estilos.iconeFerramenta} aria-hidden>
                  <TextT24Regular />
                </span>
                <Text size={300} weight="semibold">
                  Enviar fonte customizada
                </Text>
                <input
                  id={fonteId}
                  className={estilos.inputArquivo}
                  type="file"
                  accept={ACEITA_FONTE}
                  onChange={(e) => void aoEnviarFonte(e)}
                />
              </label>
              {layout.fontes.length > 0 && (
                <ul className={estilos.listaFontes} aria-label="Fontes carregadas">
                  {layout.fontes.map((f) => (
                    <li key={f.familia}>
                      {f.familia} ({f.formato})
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </aside>
      </div>
    </main>
  )
}

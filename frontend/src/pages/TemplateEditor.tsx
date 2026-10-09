import { useEffect, useId, useMemo, useState, type ChangeEvent, type ReactElement } from 'react'
import type {
  ElementoAreaItens,
  ElementoImagem,
  ElementoTemplate,
  ElementoTexto,
  FonteTemplate,
  LayoutTemplate,
} from '@/types/api'
import { useSalvarTemplate, useTemplateAtual } from '@/hooks/useTemplate'
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

export function TemplateEditor(): ReactElement {
  const { data: template, isLoading } = useTemplateAtual()
  const salvar = useSalvarTemplate()

  const [layout, setLayout] = useState<LayoutTemplate>(layoutInicial)
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [mensagem, setMensagem] = useState('')
  const [erro, setErro] = useState('')

  const fundoId = useId()
  const imagemId = useId()
  const fonteId = useId()
  const familiaId = useId()
  const posXId = useId()
  const posYId = useId()
  const conteudoId = useId()

  const [familiaFonte, setFamiliaFonte] = useState('')

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
      setErro('Não foi possível ler o PDF de fundo selecionado.')
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
      setMensagem(`Template salvo. Versão ${salvo.versao} criada.`)
    } catch {
      setErro('Não foi possível salvar o template. Verifique suas permissões e tente novamente.')
    }
  }

  if (isLoading) {
    return (
      <main id="conteudo">
        <h1>Editor de template</h1>
        <p role="status" aria-live="polite">
          Carregando template…
        </p>
      </main>
    )
  }

  return (
    <main id="conteudo">
      <h1>Editor de template</h1>
      <p>
        Monte o template arrastando os elementos no canvas ou, sem mouse, selecione um elemento e
        use as setas do teclado para posicioná-lo (Shift move em passos maiores).
      </p>

      {erro && (
        <p role="alert" aria-live="assertive">
          {erro}
        </p>
      )}

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <section aria-label="Área de edição do template">
          <CanvasA4
            elementos={elementos}
            selecionadoId={selecionadoId}
            aoSelecionar={setSelecionadoId}
            aoMover={moverElemento}
          />
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 280 }}>
          <section aria-label="Adicionar elementos">
            <h2>Elementos</h2>
            <button type="button" onClick={adicionarTexto}>
              Adicionar texto
            </button>
            <button type="button" onClick={adicionarAreaItens}>
              Adicionar área de itens
            </button>

            <div>
              <label htmlFor={imagemId}>Enviar imagem (PNG, JPG ou SVG)</label>
              <input
                id={imagemId}
                type="file"
                accept={ACEITA_IMAGEM}
                onChange={(e) => void aoEnviarImagem(e)}
              />
            </div>
          </section>

          <section aria-label="Uploads do template">
            <h2>Fundo e fontes</h2>

            <div>
              <label htmlFor={fundoId}>Enviar PDF de fundo (design base)</label>
              <input
                id={fundoId}
                type="file"
                accept={ACEITA_FUNDO}
                onChange={(e) => void aoEnviarFundo(e)}
              />
              <span role="status" aria-live="polite">
                {pagina?.fundo ? 'PDF de fundo carregado.' : ''}
              </span>
            </div>

            <div>
              <label htmlFor={familiaId}>Família da fonte</label>
              <input
                id={familiaId}
                type="text"
                value={familiaFonte}
                onChange={(e) => setFamiliaFonte(e.target.value)}
                placeholder="Ex.: Inter"
              />
            </div>
            <div>
              <label htmlFor={fonteId}>Enviar fonte (TTF, OTF, WOFF ou WOFF2)</label>
              <input
                id={fonteId}
                type="file"
                accept={ACEITA_FONTE}
                onChange={(e) => void aoEnviarFonte(e)}
              />
            </div>
            {layout.fontes.length > 0 && (
              <ul aria-label="Fontes carregadas">
                {layout.fontes.map((f) => (
                  <li key={f.familia}>
                    {f.familia} ({f.formato})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Propriedades do elemento selecionado">
            <h2>Elemento selecionado</h2>
            {!selecionado && <p>Selecione um elemento no canvas para editar suas propriedades.</p>}

            {selecionado && (
              <>
                <p role="status" aria-live="polite">
                  Selecionado: {selecionado.tipo} na posição {selecionado.x} por {selecionado.y}{' '}
                  milímetros.
                </p>

                <fieldset>
                  <legend>Posição (milímetros)</legend>
                  <div>
                    <label htmlFor={posXId}>Posição horizontal (X)</label>
                    <input
                      id={posXId}
                      type="number"
                      min={0}
                      max={LARGURA_A4_MM}
                      value={selecionado.x}
                      onChange={(e) => alterarPosicao('x', e.target.valueAsNumber)}
                    />
                  </div>
                  <div>
                    <label htmlFor={posYId}>Posição vertical (Y)</label>
                    <input
                      id={posYId}
                      type="number"
                      min={0}
                      max={ALTURA_A4_MM}
                      value={selecionado.y}
                      onChange={(e) => alterarPosicao('y', e.target.valueAsNumber)}
                    />
                  </div>
                </fieldset>

                {selecionado.tipo === 'texto' && (
                  <fieldset>
                    <legend>Texto</legend>
                    <div>
                      <label htmlFor={conteudoId}>Conteúdo</label>
                      <input
                        id={conteudoId}
                        type="text"
                        value={selecionado.conteudo}
                        onChange={(e) => alterarConteudo(e.target.value)}
                      />
                    </div>
                    <fieldset>
                      <legend>Inserir placeholder</legend>
                      {PLACEHOLDERS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-label={`Inserir placeholder ${p}`}
                          onClick={() => inserirPlaceholder(p)}
                        >
                          {p}
                        </button>
                      ))}
                    </fieldset>
                  </fieldset>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <div>
        <button type="button" onClick={() => void aoSalvar()} disabled={salvar.isPending}>
          {salvar.isPending ? 'Salvando…' : 'Salvar template'}
        </button>
        <p role="status" aria-live="polite" aria-label="Status do salvamento">
          {mensagem}
        </p>
      </div>
    </main>
  )
}

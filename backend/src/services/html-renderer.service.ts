import type { OrcamentoSnapshot, SnapshotItem } from './snapshot.service.js'
import type { LayoutTemplate } from '../repositories/template.repository.js'
import { AppError } from '../errors/app-error.js'

// -----------------------------------------------------------------------------
// Serviço PURO e determinístico de renderização de HTML (RF-016, critérios 4 e
// 5). Recebe o layout do template + o snapshot do orçamento (mais `numero` e
// `versao`, que não vivem no snapshot) e devolve uma string HTML completa.
//
// SEM banco, SEM rede, SEM Puppeteer. A geração de PDF (Tarefa 38), paginação
// (37), QR Code (39) e a integração envio→PDF (40) estão fora deste escopo.
//
// O shape detalhado do `layout_json` é definido pelo editor visual (Tarefa 49)
// e aqui trafega como `LayoutTemplate = Record<string, unknown>`. Lemos campos
// opcionais bem-conhecidos de forma defensiva (narrowing manual por causa de
// `strict` + `noUncheckedIndexedAccess`), com fallback seguro quando ausentes.
// -----------------------------------------------------------------------------

export interface RenderizarHtmlInput {
  // Layout do template (genérico; lido defensivamente).
  layout: LayoutTemplate
  snapshot: OrcamentoSnapshot
  // Número do orçamento (ex.: 'ORC-2026-0001') — não vem no snapshot.
  numero: string
  // Número da versão (ex.: 1) — não vem no snapshot.
  versao: number
  // URL pública de aceite (ex.: '/publico/orcamento/<token>'). Quando informada,
  // é impressa como TEXTO no documento, como alternativa equivalente ao QR Code
  // (acessibilidade — RF-018; diretriz de documentos renderizados). Também fica
  // disponível como placeholder `{url_publica}` no corpo/CSS do template.
  urlPublica?: string
}

export interface HtmlRendererService {
  renderizar(input: RenderizarHtmlInput): string
}

// Representação normalizada de uma imagem embutida como data URL.
interface ImagemEmbutida {
  nome: string
  dataUrl: string
}

// CSS mínimo de fallback quando o template não traz `css`.
//
// Contraste (WCAG 2.1 AA — documentado para revisão, Tarefa 57): o fallback usa
// texto preto (#000000) sobre o fundo branco padrão do papel (#ffffff), razão de
// contraste 21:1 — acima do mínimo 4.5:1 para texto normal e 3:1 para texto
// grande. O template do tenant (`layout.css`) é conteúdo do operador: a
// conformidade de contraste das cores que ele definir deve ser validada no
// editor de template (Tarefa 49) e por revisão/teste manual, pois não é
// verificável de forma estática aqui. Nenhuma informação deste renderer depende
// exclusivamente de cor — seções e colunas têm rótulos textuais (h1/h2,
// <caption>, <th scope>), e o QR tem alternativa textual (URL + alt).
const CSS_MINIMO = 'body { font-family: sans-serif; color: #000000; background: #ffffff }'

// Marcador usado internamente para posicionar a tabela de itens no corpo.
const PLACEHOLDER_ITENS = '{itens}'

function ehString(valor: unknown): valor is string {
  return typeof valor === 'string'
}

// Escapa os caracteres com significado em HTML, produzindo marcação válida e
// evitando que dados do snapshot quebrem a estrutura do documento.
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Formata um valor monetário em BRL de forma determinística, sem depender do
// locale do processo (ex.: 6840 -> 'R$ 6.840,00').
function formatarMoeda(valor: number): string {
  const negativo = valor < 0
  const centavos = Math.round(Math.abs(valor) * 100)
  const inteiros = Math.floor(centavos / 100)
  const resto = centavos % 100
  const inteirosStr = String(inteiros).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const centavosStr = String(resto).padStart(2, '0')
  return `${negativo ? '-' : ''}R$ ${inteirosStr},${centavosStr}`
}

// Monta o mapa chave → valor (já escapado) para substituição de placeholders
// `{chave}`. Deriva do snapshot + numero/versao.
function montarMapaPlaceholders(input: RenderizarHtmlInput): Record<string, string> {
  const { snapshot, numero, versao, urlPublica } = input
  const { cliente, empresa_cliente } = snapshot

  return {
    numero: escaparHtml(numero),
    versao: escaparHtml(String(versao)),
    url_publica: escaparHtml(urlPublica ?? ''),
    cliente: escaparHtml(cliente.nome),
    cliente_documento: escaparHtml(cliente.documento),
    cliente_email: escaparHtml(cliente.email ?? ''),
    cliente_telefone: escaparHtml(cliente.telefone ?? ''),
    cliente_endereco: escaparHtml(cliente.endereco ?? ''),
    empresa: escaparHtml(empresa_cliente?.razao_social ?? ''),
    subtotal: escaparHtml(formatarMoeda(snapshot.subtotal)),
    total: escaparHtml(formatarMoeda(snapshot.total)),
    valor_total: escaparHtml(formatarMoeda(snapshot.total)),
    data_emissao: escaparHtml(snapshot.data_emissao),
    validade_dias: escaparHtml(String(snapshot.validade_dias)),
    condicoes_pagamento: escaparHtml(snapshot.condicoes_pagamento ?? ''),
    observacoes: escaparHtml(snapshot.observacoes ?? ''),
  }
}

// Substitui placeholders `{chave}` pelos valores do mapa. Placeholders sem valor
// correspondente viram string vazia (não deixa a sintaxe crua vazar no HTML).
// Ignora `{img:...}`, tratado separadamente em `embutirImagens`.
function substituirPlaceholders(texto: string, mapa: Record<string, string>): string {
  return texto.replace(/\{(\w+)\}/g, (_match, chave: string) => mapa[chave] ?? '')
}

// Normaliza `layout.imagens` nas duas formas suportadas: mapa `{ nome: dataUrl }`
// ou array `[{ nome, dataUrl }]`. Formas desconhecidas são ignoradas.
function coletarImagens(layout: LayoutTemplate): ImagemEmbutida[] {
  const bruto = layout['imagens']
  if (bruto === undefined || bruto === null) return []

  if (Array.isArray(bruto)) {
    const imagens: ImagemEmbutida[] = []
    for (const entrada of bruto) {
      if (entrada !== null && typeof entrada === 'object') {
        const nome = (entrada as Record<string, unknown>)['nome']
        const dataUrl = (entrada as Record<string, unknown>)['dataUrl']
        if (ehString(nome) && ehString(dataUrl)) {
          imagens.push({ nome, dataUrl })
        }
      }
    }
    return imagens
  }

  if (typeof bruto === 'object') {
    const imagens: ImagemEmbutida[] = []
    for (const [nome, dataUrl] of Object.entries(bruto as Record<string, unknown>)) {
      if (ehString(dataUrl)) {
        imagens.push({ nome, dataUrl })
      }
    }
    return imagens
  }

  return []
}

// Nome do placeholder de imagem reservado ao QR Code de acesso público.
const NOME_IMAGEM_QRCODE = 'qrcode'

// Texto alternativo descritivo para cada imagem embutida. O QR Code recebe um
// `alt` que comunica sua função (acessibilidade — RF-018); demais imagens usam
// o próprio nome como alternativa textual mínima.
function altDaImagem(nome: string): string {
  if (nome === NOME_IMAGEM_QRCODE) {
    return 'QR Code para acessar e aprovar o orçamento online'
  }
  return nome
}

// Substitui os placeholders `{img:nome}` pela tag <img> com o data URL. Os data
// URLs são markup/estrutura (não dados do usuário) e não são escapados. Todo
// `<img>` recebe um `alt` descritivo e não-vazio (acessibilidade).
function embutirImagens(texto: string, imagens: ImagemEmbutida[]): string {
  return texto.replace(/\{img:(\w+)\}/g, (_match, nome: string) => {
    const imagem = imagens.find((img) => img.nome === nome)
    if (imagem === undefined) return ''
    return `<img src="${imagem.dataUrl}" alt="${escaparHtml(altDaImagem(nome))}" />`
  })
}

// Renderiza a tabela de itens do orçamento, preservando a ordem declarada.
function renderizarItens(itens: SnapshotItem[]): string {
  const ordenados = [...itens].sort((a, b) => a.ordem - b.ordem)

  const linhas = ordenados
    .map((item) => {
      const descricao = item.descricao !== null ? escaparHtml(item.descricao) : ''
      const responsavel =
        item.responsavel !== null
          ? `${escaparHtml(item.responsavel.nome)}${
              item.responsavel.registro_profissional !== null
                ? ` (${escaparHtml(item.responsavel.registro_profissional)})`
                : ''
            }`
          : ''
      return [
        '<tr>',
        `<td>${escaparHtml(item.nome)}</td>`,
        `<td>${descricao}</td>`,
        `<td>${escaparHtml(String(item.quantidade))}</td>`,
        `<td>${escaparHtml(item.unidade)}</td>`,
        `<td>${escaparHtml(formatarMoeda(item.valor_unitario))}</td>`,
        `<td>${escaparHtml(formatarMoeda(item.total))}</td>`,
        `<td>${responsavel}</td>`,
        '</tr>',
      ].join('')
    })
    .join('')

  return [
    '<table class="itens">',
    '<caption>Itens do orçamento</caption>',
    '<thead><tr>',
    '<th scope="col">Item</th><th scope="col">Descrição</th>',
    '<th scope="col">Qtd</th><th scope="col">Unidade</th>',
    '<th scope="col">Valor unitário</th><th scope="col">Total</th>',
    '<th scope="col">Responsável</th>',
    '</tr></thead>',
    `<tbody>${linhas}</tbody>`,
    '</table>',
  ].join('')
}

// Monta o bloco <style>, usando o CSS do template quando presente (string) e o
// CSS mínimo de fallback caso contrário. O CSS é markup e não é escapado.
function montarCss(layout: LayoutTemplate, mapa: Record<string, string>): string {
  const cssTemplate = layout['css']
  // O CSS do template também pode conter placeholders `{chave}`; substituímos
  // para não vazar a sintaxe crua no documento final (D3).
  const css = ehString(cssTemplate) ? substituirPlaceholders(cssTemplate, mapa) : CSS_MINIMO
  const formato = ehString(layout['formato']) ? layout['formato'] : 'A4'
  const orientacao = ehString(layout['orientacao']) ? layout['orientacao'] : 'retrato'
  const paisagem = orientacao === 'paisagem' ? ' landscape' : ''
  return `@page { size: ${formato}${paisagem} } ${css}`
}

// Rebaixa títulos do corpo do template (conteúdo do operador) em um nível, de
// h1→h2 até h5→h6, preservando atributos e conteúdo. Garante um único <h1> de
// documento (emitido pelo renderer) e uma hierarquia coerente, sem saltos de
// nível (WCAG — estrutura de títulos). h6 permanece h6 (teto do HTML).
function rebaixarTitulosDoCorpo(corpo: string): string {
  // Troca a tag de abertura e de fechamento de cada nível, do mais profundo
  // para o mais raso, para não rebaixar o mesmo título duas vezes.
  let resultado = corpo
  for (let nivel = 5; nivel >= 1; nivel--) {
    const abertura = new RegExp(`<h${nivel}(\\s[^>]*)?>`, 'g')
    const fechamento = new RegExp(`</h${nivel}>`, 'g')
    resultado = resultado
      .replace(abertura, (_m, attrs: string | undefined) => `<h${nivel + 1}${attrs ?? ''}>`)
      .replace(fechamento, `</h${nivel + 1}>`)
  }
  return resultado
}

// Monta o bloco "Acesso online": rótulo textual (<h2>), o QR Code (quando
// embutido pelo template via `{img:qrcode}`) e, sobretudo, a URL pública como
// TEXTO — alternativa equivalente ao QR para quem não pode escaneá-lo (WCAG;
// RF-018). Só é anexado quando o template não referencia explicitamente a URL
// (placeholder `{url_publica}`), evitando duplicar o endereço no documento.
function montarBlocoAcessoOnline(urlPublica: string | undefined, urlJaNoCorpo: boolean): string {
  if (urlPublica === undefined || urlPublica === '') return ''
  if (urlJaNoCorpo) return ''
  const url = escaparHtml(urlPublica)
  return [
    '<section class="acesso-online">',
    '<h2>Acesso online</h2>',
    '<p>Para visualizar e aprovar este orçamento online, escaneie o QR Code ou acesse o endereço abaixo:</p>',
    `<p class="url-publica"><a href="${url}">${url}</a></p>`,
    '</section>',
  ].join('')
}

// Monta o documento HTML completo a partir das partes já renderizadas. O
// conteúdo fica dentro de um <main> com um único <h1> de documento (o número do
// orçamento), estabelecendo a raiz da hierarquia de títulos (WCAG — estrutura
// semântica e títulos). `lang="pt-BR"` declara o idioma do documento.
function montarDocumento(css: string, h1Titulo: string, corpo: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8" />',
    `<style>${css}</style>`,
    '</head>',
    '<body>',
    '<main>',
    `<h1 class="documento-titulo">${h1Titulo}</h1>`,
    corpo,
    '</main>',
    '</body>',
    '</html>',
  ].join('')
}

export function criarHtmlRendererService(): HtmlRendererService {
  return {
    renderizar(input: RenderizarHtmlInput): string {
      const { layout, snapshot } = input

      // Serviço de montagem puro: a única validação é a consistência mínima da
      // entrada. Um orçamento sem itens não pode ser renderizado.
      if (snapshot.itens.length === 0) {
        throw new AppError(422, 'Orçamento sem itens não pode ser renderizado')
      }

      const mapa = montarMapaPlaceholders(input)
      const imagens = coletarImagens(layout)
      const tabelaItens = renderizarItens(snapshot.itens)

      // Corpo do template (opcional): quando ausente, usa um corpo padrão.
      const corpoBruto = ehString(layout['corpo']) ? layout['corpo'] : ''

      // Detecta se o template já referencia a URL pública antes da substituição
      // (o placeholder some depois de substituído). Evita duplicar a URL quando
      // o operador já a posicionou no layout.
      const urlPublicaNoCorpo = corpoBruto.includes('{url_publica}')

      // 1) placeholders de dados; 2) placeholders de imagem.
      let corpo = substituirPlaceholders(corpoBruto, mapa)
      corpo = embutirImagens(corpo, imagens)

      // Rebaixa títulos do corpo do operador para manter um único <h1> de
      // documento e uma hierarquia coerente (WCAG — estrutura de títulos).
      corpo = rebaixarTitulosDoCorpo(corpo)

      // Insere a tabela de itens no lugar de {itens}; se o template não tiver
      // esse marcador, anexa a tabela ao final do corpo (os itens nunca somem).
      if (corpo.includes(PLACEHOLDER_ITENS)) {
        corpo = corpo.split(PLACEHOLDER_ITENS).join(tabelaItens)
      } else {
        corpo = `${corpo}${tabelaItens}`
      }

      // Bloco "Acesso online": alternativa textual à URL/QR (acessibilidade).
      corpo = `${corpo}${montarBlocoAcessoOnline(input.urlPublica, urlPublicaNoCorpo)}`

      const css = montarCss(layout, mapa)
      // Título de documento (<h1>): o número do orçamento com a versão.
      const h1Titulo = `Orçamento ${escaparHtml(input.numero)} — versão ${escaparHtml(String(input.versao))}`
      return montarDocumento(css, h1Titulo, corpo)
    },
  }
}

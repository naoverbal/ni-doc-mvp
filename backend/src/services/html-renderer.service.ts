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
const CSS_MINIMO = 'body { font-family: sans-serif; color: #000 }'

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
  const { snapshot, numero, versao } = input
  const { cliente, empresa_cliente } = snapshot

  return {
    numero: escaparHtml(numero),
    versao: escaparHtml(String(versao)),
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

// Substitui os placeholders `{img:nome}` pela tag <img> com o data URL. Os data
// URLs são markup/estrutura (não dados do usuário) e não são escapados.
function embutirImagens(texto: string, imagens: ImagemEmbutida[]): string {
  return texto.replace(/\{img:(\w+)\}/g, (_match, nome: string) => {
    const imagem = imagens.find((img) => img.nome === nome)
    if (imagem === undefined) return ''
    return `<img src="${imagem.dataUrl}" alt="${escaparHtml(nome)}" />`
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
    '<thead><tr>',
    '<th>Item</th><th>Descrição</th><th>Qtd</th><th>Unidade</th>',
    '<th>Valor unitário</th><th>Total</th><th>Responsável</th>',
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

// Monta o documento HTML completo a partir das partes já renderizadas.
function montarDocumento(css: string, corpo: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8" />',
    `<style>${css}</style>`,
    '</head>',
    `<body>${corpo}</body>`,
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

      // 1) placeholders de dados; 2) placeholders de imagem.
      let corpo = substituirPlaceholders(corpoBruto, mapa)
      corpo = embutirImagens(corpo, imagens)

      // Insere a tabela de itens no lugar de {itens}; se o template não tiver
      // esse marcador, anexa a tabela ao final do corpo (os itens nunca somem).
      if (corpo.includes(PLACEHOLDER_ITENS)) {
        corpo = corpo.split(PLACEHOLDER_ITENS).join(tabelaItens)
      } else {
        corpo = `${corpo}${tabelaItens}`
      }

      const css = montarCss(layout, mapa)
      return montarDocumento(css, corpo)
    },
  }
}

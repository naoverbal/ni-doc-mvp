import { describe, it, expect, beforeEach } from 'vitest'
import { criarHtmlRendererService } from '../html-renderer.service.js'
import type { HtmlRendererService, RenderizarHtmlInput } from '../html-renderer.service.js'
import { AppError } from '../../errors/app-error.js'
import type { OrcamentoSnapshot } from '../snapshot.service.js'
import type { LayoutTemplate } from '../../repositories/template.repository.js'

// -----------------------------------------------------------------------------
// Fixtures montados no próprio teste (serviço puro: sem banco, sem rede, sem
// Puppeteer). Reutilizam os tipos reais `OrcamentoSnapshot` e `LayoutTemplate`.
// -----------------------------------------------------------------------------
function snapshotMock(overrides: Partial<OrcamentoSnapshot> = {}): OrcamentoSnapshot {
  return {
    cliente: {
      id: 'cliente-1',
      nome: 'Acme Ltda',
      tipo_pessoa: 'PJ',
      documento: '12345678000190',
      email: 'contato@acme.com',
      telefone: '11999990000',
      endereco: 'Rua A, 100',
    },
    empresa_cliente: {
      id: 'empresa-1',
      razao_social: 'Acme Comércio Ltda',
      nome_fantasia: 'Acme',
      cnpj: '12345678000190',
      endereco: 'Av. B, 200',
    },
    itens: [
      {
        ordem: 1,
        nome: 'Desenvolvimento de API',
        descricao: 'Backend em Node.js',
        quantidade: 40,
        unidade: 'h',
        valor_unitario: 200,
        desconto_tipo: 'percentual',
        desconto_valor: 10,
        total: 7200,
        responsavel: {
          id: 'resp-1',
          nome: 'Eng. Ana Beatriz Lima',
          registro_profissional: 'CREA 123456',
        },
      },
    ],
    desconto_global: { tipo: 'percentual', valor: 5 },
    subtotal: 7200,
    total: 6840,
    condicoes_pagamento: '50% na aprovação, 50% na entrega',
    observacoes: 'Observações gerais',
    data_emissao: '2026-10-01',
    validade_dias: 30,
    ...overrides,
  }
}

function layoutMock(overrides: LayoutTemplate = {}): LayoutTemplate {
  return {
    formato: 'A4',
    orientacao: 'retrato',
    css: '.titulo { color: #123456 } .inexistente::after { content: "{inexistente}" }',
    corpo: '<h1 class="titulo">Orçamento {numero} v{versao}</h1><p>Cliente: {cliente}</p>',
    ...overrides,
  }
}

function input(overrides: Partial<RenderizarHtmlInput> = {}): RenderizarHtmlInput {
  return {
    layout: layoutMock(),
    snapshot: snapshotMock(),
    numero: 'ORC-2026-0001',
    versao: 1,
    ...overrides,
  }
}

describe('html-renderer.service', () => {
  let service: HtmlRendererService

  beforeEach(() => {
    service = criarHtmlRendererService()
  })

  it('substitui {cliente} e {numero} pelos valores reais e não deixa os literais crus', () => {
    const html = service.renderizar(input())

    expect(html).toContain('Acme Ltda')
    expect(html).toContain('ORC-2026-0001')
    expect(html).not.toContain('{cliente}')
    expect(html).not.toContain('{numero}')
  })

  it('substitui os demais placeholders do template (total, data_emissao, validade_dias, empresa, condicoes_pagamento)', () => {
    const layout = layoutMock({
      corpo:
        '<div>{empresa}</div><div>{total}</div><div>{valor_total}</div>' +
        '<div>{data_emissao}</div><div>{validade_dias}</div><div>{condicoes_pagamento}</div>',
    })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('Acme Comércio Ltda')
    expect(html).toContain('R$ 6.840,00')
    expect(html).toContain('2026-10-01')
    expect(html).toContain('30')
    expect(html).toContain('50% na aprovação, 50% na entrega')
  })

  it('substitui placeholder sem valor por string vazia (não deixa {inexistente} cru)', () => {
    const html = service.renderizar(input())

    expect(html).not.toContain('{inexistente}')
  })

  it('itera sobre os itens renderizando uma linha por item na ordem correta', () => {
    const snapshot = snapshotMock({
      itens: [
        {
          ordem: 2,
          nome: 'Item B',
          descricao: null,
          quantidade: 2,
          unidade: 'un',
          valor_unitario: 50,
          desconto_tipo: null,
          desconto_valor: null,
          total: 100,
          responsavel: null,
        },
        {
          ordem: 1,
          nome: 'Item A',
          descricao: 'Primeiro',
          quantidade: 1,
          unidade: 'un',
          valor_unitario: 300,
          desconto_tipo: null,
          desconto_valor: null,
          total: 300,
          responsavel: {
            id: 'resp-1',
            nome: 'Ana',
            registro_profissional: 'CREA 1',
          },
        },
      ],
    })
    const html = service.renderizar(input({ snapshot }))

    expect(html).toContain('Item A')
    expect(html).toContain('Item B')
    // Preserva a ordem declarada em `ordem` (A=1 antes de B=2).
    expect(html.indexOf('Item A')).toBeLessThan(html.indexOf('Item B'))
    expect(html).toContain('R$ 300,00')
    expect(html).toContain('R$ 100,00')
    // Responsável aparece com nome + registro.
    expect(html).toContain('Ana')
    expect(html).toContain('CREA 1')
  })

  it('aplica o CSS do template dentro de um <style>', () => {
    const html = service.renderizar(input())

    expect(html).toContain('<style>')
    expect(html).toContain('color: #123456')
  })

  it('usa CSS mínimo de fallback quando layout.css está ausente', () => {
    const layout = layoutMock({ css: undefined })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('<style>')
  })

  it('embute imagens em base64 (data URLs) quando layout.imagens é um mapa', () => {
    const layout = layoutMock({
      corpo: '<header>{img:logo}</header>',
      imagens: { logo: 'data:image/png;base64,AAAA' },
    })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('<img src="data:image/png;base64,AAAA"')
    expect(html).not.toContain('{img:logo}')
  })

  it('embute imagens em base64 (data URLs) quando layout.imagens é um array', () => {
    const layout = layoutMock({
      corpo: '<header>{img:logo}</header>',
      imagens: [{ nome: 'logo', dataUrl: 'data:image/jpeg;base64,BBBB' }],
    })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('<img src="data:image/jpeg;base64,BBBB"')
  })

  it('ignora {img:nome} quando a imagem referenciada não existe e descarta entradas inválidas do array', () => {
    const layout = layoutMock({
      corpo: '<header>{img:ausente}</header>',
      imagens: [{ nome: 'logo', dataUrl: 'data:image/png;base64,AAAA' }, 'invalida', { nome: 'x' }],
    })
    const html = service.renderizar(input({ layout }))

    expect(html).not.toContain('{img:ausente}')
    expect(html).not.toContain('<img src="data:')
  })

  it('renderiza item sem responsável e responsável sem registro profissional', () => {
    const snapshot = snapshotMock({
      itens: [
        {
          ordem: 1,
          nome: 'Item sem resp',
          descricao: null,
          quantidade: 1,
          unidade: 'un',
          valor_unitario: 10,
          desconto_tipo: null,
          desconto_valor: null,
          total: 10,
          responsavel: { id: 'r', nome: 'Carlos', registro_profissional: null },
        },
      ],
    })
    const html = service.renderizar(input({ snapshot }))

    expect(html).toContain('Carlos')
    expect(html).not.toContain('Carlos (')
  })

  it('formata valores negativos (ex.: -1234.5 -> -R$ 1.234,50)', () => {
    const snapshot = snapshotMock({ total: -1234.5 })
    const layout = layoutMock({ corpo: '<div>{total}</div>' })
    const html = service.renderizar(input({ snapshot, layout }))

    expect(html).toContain('-R$ 1.234,50')
  })

  it('usa a orientação paisagem no @page quando o layout pede', () => {
    const layout = layoutMock({ orientacao: 'paisagem' })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('landscape')
  })

  it('não emite nenhuma <img data:> e não lança erro quando layout.imagens está ausente', () => {
    const layout = layoutMock({ imagens: undefined })

    expect(() => service.renderizar(input({ layout }))).not.toThrow()
    const html = service.renderizar(input({ layout }))
    expect(html).not.toContain('<img src="data:')
  })

  it('escapa caracteres especiais de HTML vindos do snapshot', () => {
    const snapshot = snapshotMock({
      cliente: {
        id: 'cliente-1',
        nome: 'Tom & Jerry <"brinquedos">',
        tipo_pessoa: 'PJ',
        documento: '12345678000190',
        email: null,
        telefone: null,
        endereco: null,
      },
    })
    const html = service.renderizar(input({ snapshot }))

    expect(html).toContain('Tom &amp; Jerry &lt;&quot;brinquedos&quot;&gt;')
    expect(html).not.toContain('Tom & Jerry <"brinquedos">')
  })

  it('formata valores monetários de forma determinística (6840 -> R$ 6.840,00)', () => {
    const layout = layoutMock({ corpo: '<div>{total}</div>' })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('R$ 6.840,00')
  })

  it('produz um HTML completo e válido refletindo formato/orientação do layout', () => {
    const html = service.renderizar(input())

    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="utf-8"')
    expect((html.match(/<head>/g) ?? []).length).toBe(1)
    expect((html.match(/<body>/g) ?? []).length).toBe(1)
    expect(html).toContain('@page')
    expect(html).toContain('A4')
  })

  it('é determinístico: duas chamadas com a mesma entrada produzem a mesma string', () => {
    const entrada = input()
    const a = service.renderizar(entrada)
    const b = service.renderizar(entrada)

    expect(a).toBe(b)
  })

  it('anexa a tabela de itens ao corpo quando o template não contém {itens}', () => {
    const layout = layoutMock({ corpo: '<p>Sem placeholder de itens aqui</p>' })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('Desenvolvimento de API')
    expect(html).toContain('<table')
  })

  it('insere a tabela de itens na posição de {itens} quando presente', () => {
    const layout = layoutMock({ corpo: '<section>{itens}</section>' })
    const html = service.renderizar(input({ layout }))

    expect(html).toContain('Desenvolvimento de API')
    expect(html).not.toContain('{itens}')
  })

  it('lança AppError(422) quando o snapshot não tem itens', () => {
    const snapshot = snapshotMock({ itens: [] })

    expect(() => service.renderizar(input({ snapshot }))).toThrowError(AppError)
    expect(() => service.renderizar(input({ snapshot }))).toThrowError(/iten/i)
    try {
      service.renderizar(input({ snapshot }))
    } catch (erro) {
      expect(erro).toBeInstanceOf(AppError)
      expect((erro as AppError).statusCode).toBe(422)
    }
  })
})

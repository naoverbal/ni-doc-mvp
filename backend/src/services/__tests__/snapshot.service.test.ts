import { describe, it, expect, beforeEach } from 'vitest'
import { criarSnapshotService } from '../snapshot.service.js'
import type { SnapshotService } from '../snapshot.service.js'
import type { OrcamentoComItens } from '../../repositories/orcamento.repository.js'
import type { ClientePublico } from '../../repositories/cliente.repository.js'
import type { EmpresaPublica } from '../../repositories/empresa.repository.js'
import type { ResponsavelPublico } from '../../repositories/responsavel.repository.js'

// -----------------------------------------------------------------------------
// Fixtures montados no próprio teste (serviço puro: sem banco, sem mocks de repo).
// -----------------------------------------------------------------------------
function clienteMock(): ClientePublico {
  return {
    id: 'cliente-1',
    tenantId: 'tenant-1',
    tipoPessoa: 'PJ',
    nome: 'Acme Ltda',
    documento: '12345678000190',
    email: 'contato@acme.com',
    telefone: '11999990000',
    endereco: 'Rua A, 100',
    observacoes: 'obs interna',
    ativo: true,
    criadoEm: new Date('2024-01-01'),
  }
}

function empresaMock(): EmpresaPublica {
  return {
    id: 'empresa-1',
    tenantId: 'tenant-1',
    tipo: 'cliente_pj',
    razaoSocial: 'Acme Comércio Ltda',
    nomeFantasia: 'Acme',
    cnpj: '12345678000190',
    email: 'financeiro@acme.com',
    telefone: '1133334444',
    endereco: 'Av. B, 200',
    ativo: true,
    criadoEm: new Date('2024-01-01'),
  }
}

function responsavelMock(): ResponsavelPublico {
  return {
    id: 'resp-1',
    tenantId: 'tenant-1',
    nome: 'Eng. Ana Beatriz Lima',
    registroProfissional: 'CREA 123456',
    email: 'ana@acme.com',
    telefone: '1155556666',
    ativo: true,
    criadoEm: new Date('2024-01-01'),
  }
}

function orcamentoMock(): OrcamentoComItens {
  return {
    id: 'orcamento-1',
    tenantId: 'tenant-1',
    numero: 'ORC-2026-0001',
    clienteId: 'cliente-1',
    empresaClienteId: 'empresa-1',
    usuarioId: 'user-1',
    titulo: 'Projeto X',
    descricao: 'Descrição do projeto',
    status: 'rascunho',
    dataEmissao: new Date('2026-10-01T00:00:00.000Z'),
    validadeDias: 30,
    descontoGlobalTipo: 'percentual',
    descontoGlobalValor: 5,
    subtotal: 7200,
    total: 6840,
    versaoAtual: 1,
    observacoes: 'Observações gerais',
    prazoEntregaDias: 15,
    condicoesPagamentoTexto: '50% na aprovação, 50% na entrega',
    condicoesPagamento: [
      {
        id: 'cond-1',
        ordem: 1,
        descricao: 'Entrada',
        percentual: 50,
        marco: 'Na aprovação',
        formaPagamento: 'PIX',
      },
      {
        id: 'cond-2',
        ordem: 2,
        descricao: 'Saldo',
        percentual: 50,
        marco: null,
        formaPagamento: 'Boleto',
      },
    ],
    criadoEm: new Date('2026-10-01'),
    atualizadoEm: new Date('2026-10-01'),
    itens: [
      {
        id: 'item-1',
        ordem: 1,
        nome: 'Desenvolvimento de API',
        descricao: 'Backend em Node.js',
        quantidade: 40,
        unidade: 'h',
        valorUnitario: 200,
        descontoTipo: 'percentual',
        descontoValor: 10,
        total: 7200,
        responsavelId: 'resp-1',
      },
    ],
  }
}

describe('snapshot.service', () => {
  let service: SnapshotService

  beforeEach(() => {
    service = criarSnapshotService()
  })

  it('monta o snapshot completo copiando cliente, empresa, itens e totais (com responsável aninhado)', () => {
    const responsaveisPorId = new Map([['resp-1', responsavelMock()]])
    const snapshot = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      empresaCliente: empresaMock(),
      responsaveisPorId,
    })

    expect(snapshot.cliente).toEqual({
      id: 'cliente-1',
      nome: 'Acme Ltda',
      tipo_pessoa: 'PJ',
      documento: '12345678000190',
      email: 'contato@acme.com',
      telefone: '11999990000',
      endereco: 'Rua A, 100',
    })

    expect(snapshot.empresa_cliente).toEqual({
      id: 'empresa-1',
      razao_social: 'Acme Comércio Ltda',
      nome_fantasia: 'Acme',
      cnpj: '12345678000190',
      endereco: 'Av. B, 200',
    })

    expect(snapshot.itens).toHaveLength(1)
    expect(snapshot.itens[0]).toEqual({
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
    })

    expect(snapshot.condicoes_pagamento).toBe('50% na aprovação, 50% na entrega')
    expect(snapshot.observacoes).toBe('Observações gerais')
    expect(snapshot.validade_dias).toBe(30)
  })

  it('serializa data_emissao no formato ISO YYYY-MM-DD', () => {
    const snapshot = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      empresaCliente: empresaMock(),
      responsaveisPorId: new Map([['resp-1', responsavelMock()]]),
    })

    expect(snapshot.data_emissao).toBe('2026-10-01')
    // Garante serializável em JSON (string, não objeto Date).
    expect(typeof snapshot.data_emissao).toBe('string')
  })

  it('é imutável: mutar cliente/empresa/itens de origem não altera o snapshot (cópia por valor)', () => {
    const cliente = clienteMock()
    const empresa = empresaMock()
    const orcamento = orcamentoMock()
    const snapshot = service.montar({
      orcamento,
      cliente,
      empresaCliente: empresa,
      responsaveisPorId: new Map([['resp-1', responsavelMock()]]),
    })

    // Muta as fontes após a montagem.
    cliente.nome = 'ALTERADO'
    empresa.razaoSocial = 'ALTERADO'
    const item0 = orcamento.itens[0]
    if (item0) {
      item0.nome = 'ALTERADO'
      item0.total = 99999
    }

    expect(snapshot.cliente.nome).toBe('Acme Ltda')
    expect(snapshot.empresa_cliente?.razao_social).toBe('Acme Comércio Ltda')
    expect(snapshot.itens[0]?.nome).toBe('Desenvolvimento de API')
    expect(snapshot.itens[0]?.total).toBe(7200)
  })

  it('não compartilha a referência do array de itens com a entrada', () => {
    const orcamento = orcamentoMock()
    const snapshot = service.montar({
      orcamento,
      cliente: clienteMock(),
      empresaCliente: empresaMock(),
      responsaveisPorId: new Map([['resp-1', responsavelMock()]]),
    })

    expect(snapshot.itens).not.toBe(orcamento.itens)
    expect(snapshot.itens[0]).not.toBe(orcamento.itens[0])
  })

  it('empresa_cliente é null quando não há empresa (ausente, null ou undefined)', () => {
    const semEmpresa = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(semEmpresa.empresa_cliente).toBeNull()

    const empresaNull = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      empresaCliente: null,
      responsaveisPorId: new Map(),
    })
    expect(empresaNull.empresa_cliente).toBeNull()
  })

  it('responsavel do item é null quando não há responsavelId ou id ausente no Map', () => {
    const orcamento = orcamentoMock()
    const item0 = orcamento.itens[0]
    if (item0) item0.responsavelId = null

    const semResponsavel = service.montar({
      orcamento,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(semResponsavel.itens[0]?.responsavel).toBeNull()

    // responsavelId presente, mas id ausente no Map -> null.
    const comIdForaDoMap = orcamentoMock()
    const idItem = comIdForaDoMap.itens[0]
    if (idItem) idItem.responsavelId = 'resp-inexistente'
    const resultado = service.montar({
      orcamento: comIdForaDoMap,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(resultado.itens[0]?.responsavel).toBeNull()
  })

  it('desconto_global é null sem desconto e preenchido quando presente', () => {
    const semDesconto = orcamentoMock()
    semDesconto.descontoGlobalTipo = null
    semDesconto.descontoGlobalValor = null
    const resultadoSem = service.montar({
      orcamento: semDesconto,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(resultadoSem.desconto_global).toBeNull()

    const comDesconto = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(comDesconto.desconto_global).toEqual({ tipo: 'percentual', valor: 5 })
  })

  it('desconto_global é null quando apenas tipo ou apenas valor está presente', () => {
    const soTipo = orcamentoMock()
    soTipo.descontoGlobalValor = null
    const resultadoSoTipo = service.montar({
      orcamento: soTipo,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(resultadoSoTipo.desconto_global).toBeNull()

    const soValor = orcamentoMock()
    soValor.descontoGlobalTipo = null
    const resultadoSoValor = service.montar({
      orcamento: soValor,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })
    expect(resultadoSoValor.desconto_global).toBeNull()
  })

  it('copia as condições de pagamento estruturadas e o prazo de entrega no snapshot', () => {
    const snapshot = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      empresaCliente: empresaMock(),
      responsaveisPorId: new Map([['resp-1', responsavelMock()]]),
    })

    expect(snapshot.prazo_entrega_dias).toBe(15)
    expect(snapshot.condicoes_pagamento_lista).toHaveLength(2)
    expect(snapshot.condicoes_pagamento_lista[0]).toEqual({
      ordem: 1,
      descricao: 'Entrada',
      percentual: 50,
      marco: 'Na aprovação',
      forma_pagamento: 'PIX',
    })
    expect(snapshot.condicoes_pagamento_lista[1]).toEqual({
      ordem: 2,
      descricao: 'Saldo',
      percentual: 50,
      marco: null,
      forma_pagamento: 'Boleto',
    })
  })

  it('prazo_entrega_dias é null e a lista de condições é vazia quando ausentes', () => {
    const semExtras = orcamentoMock()
    semExtras.prazoEntregaDias = null
    semExtras.condicoesPagamento = []
    const snapshot = service.montar({
      orcamento: semExtras,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })

    expect(snapshot.prazo_entrega_dias).toBeNull()
    expect(snapshot.condicoes_pagamento_lista).toEqual([])
  })

  it('as condições de pagamento são copiadas por valor (mutar a origem não altera o snapshot)', () => {
    const orcamento = orcamentoMock()
    const snapshot = service.montar({
      orcamento,
      cliente: clienteMock(),
      responsaveisPorId: new Map(),
    })

    const cond0 = orcamento.condicoesPagamento[0]
    if (cond0) {
      cond0.descricao = 'ALTERADO'
      cond0.percentual = 999
    }

    expect(snapshot.condicoes_pagamento_lista[0]?.descricao).toBe('Entrada')
    expect(snapshot.condicoes_pagamento_lista[0]?.percentual).toBe(50)
    // Não compartilha a referência do array nem dos itens.
    expect(snapshot.condicoes_pagamento_lista).not.toBe(orcamento.condicoesPagamento)
  })

  it('copia os totais (subtotal, total e total de cada item) exatamente', () => {
    const snapshot = service.montar({
      orcamento: orcamentoMock(),
      cliente: clienteMock(),
      empresaCliente: empresaMock(),
      responsaveisPorId: new Map([['resp-1', responsavelMock()]]),
    })

    expect(snapshot.subtotal).toBe(7200)
    expect(snapshot.total).toBe(6840)
    expect(snapshot.itens[0]?.total).toBe(7200)
  })
})

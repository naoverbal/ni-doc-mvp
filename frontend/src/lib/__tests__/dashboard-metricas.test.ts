import { describe, it, expect } from 'vitest'
import {
  agruparCriadosPorPeriodo,
  aguardandoHaMaisTempo,
  contarPorStatus,
  distribuicaoPorStatus,
  recentes,
  somarTotalPorStatus,
  taxaConversao,
  valorEmAberto,
  valorEnviado,
} from '@/lib/dashboard-metricas'
import type { OrcamentoResumo, OrcamentoStatus } from '@/types/api'

// Fábrica de fixtures: cria um OrcamentoResumo com overrides pontuais.
let contador = 0
function orc(parcial: Partial<OrcamentoResumo> = {}): OrcamentoResumo {
  contador += 1
  return {
    id: `orc-${contador}`,
    numero: `ORC-2025-${String(contador).padStart(4, '0')}`,
    titulo: `Orçamento ${contador}`,
    status: 'rascunho',
    clienteId: 'cli-1',
    subtotal: 100,
    total: 100,
    versaoAtual: 0,
    dataEmissao: '2025-01-01',
    criadoEm: '2025-01-01T12:00:00.000Z',
    ...parcial,
  }
}

describe('contarPorStatus', () => {
  it('conta por status e zera os status ausentes (retorna os 6)', () => {
    const contagem = contarPorStatus([
      orc({ status: 'enviado' }),
      orc({ status: 'enviado' }),
      orc({ status: 'aprovado' }),
    ])
    expect(contagem).toEqual({
      rascunho: 0,
      enviado: 2,
      aprovado: 1,
      reprovado: 0,
      expirado: 0,
      cancelado: 0,
    })
  })

  it('retorna todos zerados para lista vazia', () => {
    const contagem = contarPorStatus([])
    const statuses: OrcamentoStatus[] = [
      'rascunho',
      'enviado',
      'aprovado',
      'reprovado',
      'expirado',
      'cancelado',
    ]
    for (const s of statuses) {
      expect(contagem[s]).toBe(0)
    }
  })
})

describe('somarTotalPorStatus / valorEmAberto / valorEnviado', () => {
  const base = [
    orc({ status: 'enviado', total: 100 }),
    orc({ status: 'enviado', total: 50 }),
    orc({ status: 'aprovado', total: 200 }),
    orc({ status: 'reprovado', total: 30 }),
    orc({ status: 'rascunho', total: 999 }),
  ]

  it('soma apenas os status pedidos', () => {
    expect(somarTotalPorStatus(base, ['enviado'])).toBe(150)
    expect(somarTotalPorStatus(base, ['aprovado', 'reprovado'])).toBe(230)
  })

  it('ignora status fora do conjunto', () => {
    expect(somarTotalPorStatus(base, ['cancelado'])).toBe(0)
  })

  it('valor em aberto soma só os enviados', () => {
    expect(valorEmAberto(base)).toBe(150)
  })

  it('valor enviado soma enviado + aprovado + reprovado', () => {
    expect(valorEnviado(base)).toBe(380)
  })

  it('retorna 0 para lista vazia', () => {
    expect(valorEmAberto([])).toBe(0)
    expect(valorEnviado([])).toBe(0)
    expect(somarTotalPorStatus([], ['enviado'])).toBe(0)
  })
})

describe('taxaConversao', () => {
  it('calcula aprovados / (enviado + aprovado + reprovado)', () => {
    const taxa = taxaConversao([
      orc({ status: 'aprovado' }),
      orc({ status: 'aprovado' }),
      orc({ status: 'enviado' }),
      orc({ status: 'reprovado' }),
    ])
    // 2 / (1 + 2 + 1) = 0.5
    expect(taxa).toBe(0.5)
  })

  it('ignora rascunho/expirado/cancelado no denominador', () => {
    const taxa = taxaConversao([
      orc({ status: 'aprovado' }),
      orc({ status: 'enviado' }),
      orc({ status: 'rascunho' }),
      orc({ status: 'cancelado' }),
    ])
    // 1 / (1 + 1) = 0.5
    expect(taxa).toBe(0.5)
  })

  it('retorna null quando o denominador é zero (divisão por zero)', () => {
    expect(taxaConversao([])).toBeNull()
    expect(taxaConversao([orc({ status: 'rascunho' })])).toBeNull()
  })
})

describe('agruparCriadosPorPeriodo', () => {
  it('agrupa por mês, ordenado asc, com rótulo pt-BR MM/AAAA', () => {
    const pontos = agruparCriadosPorPeriodo(
      [
        orc({ criadoEm: '2025-03-10T12:00:00.000Z' }),
        orc({ criadoEm: '2025-03-25T12:00:00.000Z' }),
        orc({ criadoEm: '2025-01-05T12:00:00.000Z' }),
      ],
      'mes',
    )
    expect(pontos).toEqual([
      { chave: '2025-01', rotulo: '01/2025', quantidade: 1 },
      { chave: '2025-03', rotulo: '03/2025', quantidade: 2 },
    ])
  })

  it('agrupa por ano, ordenado asc', () => {
    const pontos = agruparCriadosPorPeriodo(
      [
        orc({ criadoEm: '2024-07-01T12:00:00.000Z' }),
        orc({ criadoEm: '2025-02-01T12:00:00.000Z' }),
        orc({ criadoEm: '2025-11-01T12:00:00.000Z' }),
      ],
      'ano',
    )
    expect(pontos).toEqual([
      { chave: '2024', rotulo: '2024', quantidade: 1 },
      { chave: '2025', rotulo: '2025', quantidade: 2 },
    ])
  })

  it('agrupa por semana ISO com rótulo AAAA-Sww', () => {
    // 2025-01-06 é segunda-feira da semana ISO 02 de 2025.
    const pontos = agruparCriadosPorPeriodo(
      [
        orc({ criadoEm: '2025-01-06T12:00:00.000Z' }),
        orc({ criadoEm: '2025-01-09T12:00:00.000Z' }),
      ],
      'semana',
    )
    expect(pontos).toEqual([{ chave: '2025-W02', rotulo: '2025-S02', quantidade: 2 }])
  })

  it('trata a virada de ano pela regra ISO (01/01/2021 pertence à semana 53 de 2020)', () => {
    // 2021-01-01 é sexta-feira; pela ISO 8601 pertence à semana 53 de 2020.
    const pontos = agruparCriadosPorPeriodo([orc({ criadoEm: '2021-01-01T12:00:00.000Z' })], 'semana')
    expect(pontos).toEqual([{ chave: '2020-W53', rotulo: '2020-S53', quantidade: 1 }])
  })

  it('retorna lista vazia para entrada vazia', () => {
    expect(agruparCriadosPorPeriodo([], 'mes')).toEqual([])
  })
})

describe('recentes', () => {
  it('retorna os 5 mais recentes em ordem desc', () => {
    const lista = [
      orc({ id: 'a', criadoEm: '2025-01-01T00:00:00.000Z' }),
      orc({ id: 'b', criadoEm: '2025-06-01T00:00:00.000Z' }),
      orc({ id: 'c', criadoEm: '2025-03-01T00:00:00.000Z' }),
    ]
    const resultado = recentes(lista)
    expect(resultado.map((o) => o.id)).toEqual(['b', 'c', 'a'])
  })

  it('fatia no limite (top 5 por padrão)', () => {
    const lista = Array.from({ length: 8 }, (_, i) =>
      orc({ criadoEm: `2025-01-0${(i % 9) + 1}T00:00:00.000Z` }),
    )
    expect(recentes(lista)).toHaveLength(5)
  })
})

describe('aguardandoHaMaisTempo', () => {
  it('inclui apenas enviados, do mais antigo ao mais novo', () => {
    const lista = [
      orc({ id: 'novo', status: 'enviado', criadoEm: '2025-05-01T00:00:00.000Z' }),
      orc({ id: 'antigo', status: 'enviado', criadoEm: '2025-01-01T00:00:00.000Z' }),
      orc({ id: 'aprovado', status: 'aprovado', criadoEm: '2024-01-01T00:00:00.000Z' }),
    ]
    const resultado = aguardandoHaMaisTempo(lista)
    expect(resultado.map((o) => o.id)).toEqual(['antigo', 'novo'])
  })

  it('fatia no limite (top 5 por padrão)', () => {
    const lista = Array.from({ length: 7 }, (_, i) =>
      orc({ status: 'enviado', criadoEm: `2025-01-0${(i % 9) + 1}T00:00:00.000Z` }),
    )
    expect(aguardandoHaMaisTempo(lista)).toHaveLength(5)
  })
})

describe('distribuicaoPorStatus', () => {
  it('retorna só status com contagem > 0, com legenda textual', () => {
    const fatias = distribuicaoPorStatus([
      orc({ status: 'enviado' }),
      orc({ status: 'enviado' }),
      orc({ status: 'aprovado' }),
    ])
    expect(fatias).toEqual([
      { status: 'enviado', legenda: 'Enviado', valor: 2 },
      { status: 'aprovado', legenda: 'Aprovado', valor: 1 },
    ])
  })

  it('retorna lista vazia quando não há orçamentos', () => {
    expect(distribuicaoPorStatus([])).toEqual([])
  })
})

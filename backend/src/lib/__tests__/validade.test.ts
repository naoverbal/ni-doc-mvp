import { describe, expect, it } from 'vitest'
import {
  calcularExpiraEm,
  dataCivilNoFuso,
  estaExpirado,
  inicioDoDia,
  somarDias,
} from '../validade.js'

describe('validade', () => {
  it('inicioDoDia devolve 00:00 de America/Sao_Paulo (03:00Z)', () => {
    expect(inicioDoDia('2026-03-10').toISOString()).toBe('2026-03-10T03:00:00.000Z')
  })

  it('calcularExpiraEm expira às 00:00 do dia seguinte ao vencimento', () => {
    // Emissão 01/01 + 30 dias = vencimento 31/01; expira 01/02 00:00 (UTC-3).
    expect(calcularExpiraEm('2026-01-01', 30).toISOString()).toBe('2026-02-01T03:00:00.000Z')
  })

  it('somarDias atravessa mês e ano', () => {
    expect(somarDias('2025-12-31', 1)).toBe('2026-01-01')
    expect(somarDias('2026-02-27', 3)).toBe('2026-03-02')
  })

  it('dataCivilNoFuso usa o fuso de negócio, não UTC', () => {
    // 01:00Z do dia 11 ainda é dia 10 em São Paulo.
    expect(dataCivilNoFuso(new Date('2026-03-11T01:00:00Z'))).toBe('2026-03-10')
  })

  it('estaExpirado: 1s antes é válido; no instante exato está expirado', () => {
    const expira = calcularExpiraEm('2026-01-01', 30)
    expect(estaExpirado(expira, new Date(expira.getTime() - 1000))).toBe(false)
    expect(estaExpirado(expira, expira)).toBe(true)
  })
})

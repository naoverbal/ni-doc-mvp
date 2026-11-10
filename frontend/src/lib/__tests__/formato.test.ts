import { describe, it, expect } from 'vitest'
import { formatarDias } from '@/lib/formato'

describe('formatarDias', () => {
  it('usa traço quando não há valor', () => {
    expect(formatarDias(null)).toBe('—')
  })

  it('usa singular para 1 e plural nos demais', () => {
    expect(formatarDias(1)).toBe('1 dia')
    expect(formatarDias(0)).toBe('0 dias')
    expect(formatarDias(8)).toBe('8 dias')
  })

  it('exibe até uma casa decimal com vírgula', () => {
    expect(formatarDias(5.5)).toBe('5,5 dias')
    expect(formatarDias(0.5)).toBe('0,5 dias')
  })
})

import { describe, it, expect } from 'vitest'
import { validarCPF, validarCNPJ, normalizarDocumento } from '../documento.js'

describe('documento', () => {
  describe('validarCPF', () => {
    it('CPF válido formatado retorna true', () => {
      expect(validarCPF('529.982.247-25')).toBe(true)
    })

    it('CPF com todos dígitos iguais retorna false', () => {
      expect(validarCPF('111.111.111-11')).toBe(false)
    })

    it('CPF com dígito verificador errado retorna false', () => {
      expect(validarCPF('529.982.247-00')).toBe(false)
    })

    it('CPF não numérico retorna false', () => {
      expect(validarCPF('abc.def.ghi-jk')).toBe(false)
    })

    it('CPF com comprimento errado retorna false', () => {
      expect(validarCPF('123')).toBe(false)
    })
  })

  describe('validarCNPJ', () => {
    it('CNPJ válido retorna true', () => {
      expect(validarCNPJ('11.222.333/0001-81')).toBe(true)
    })

    it('CNPJ com dígito verificador errado retorna false', () => {
      expect(validarCNPJ('11.222.333/0001-00')).toBe(false)
    })

    it('CNPJ com todos dígitos iguais retorna false', () => {
      expect(validarCNPJ('11.111.111/1111-11')).toBe(false)
    })

    it('CNPJ com comprimento errado retorna false', () => {
      expect(validarCNPJ('123')).toBe(false)
    })
  })

  describe('normalizarDocumento', () => {
    it('remove pontos, traços e barras', () => {
      expect(normalizarDocumento('123.456.789-09')).toBe('12345678909')
    })

    it('normaliza CNPJ', () => {
      expect(normalizarDocumento('11.222.333/0001-81')).toBe('11222333000181')
    })
  })
})

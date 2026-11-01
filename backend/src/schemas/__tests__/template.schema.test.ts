import { describe, expect, it } from 'vitest'
import { atualizarTemplateSchema } from '../template.schema.js'

describe('atualizarTemplateSchema', () => {
  it('aceita layout sem imagens', () => {
    expect(atualizarTemplateSchema.safeParse({ layoutJson: { corpo: '<p>oi</p>' } }).success).toBe(
      true,
    )
  })

  it('aceita imagens como mapa ou array de data URLs base64 válidos', () => {
    const mapa = {
      layoutJson: {
        imagens: { logo: 'data:image/png;base64,AAAA', sel: 'data:image/svg+xml;base64,PHN2Zz4=' },
      },
    }
    const array = {
      layoutJson: { imagens: [{ nome: 'logo', dataUrl: 'data:image/jpeg;base64,BBBB' }] },
    }
    expect(atualizarTemplateSchema.safeParse(mapa).success).toBe(true)
    expect(atualizarTemplateSchema.safeParse(array).success).toBe(true)
  })

  it.each([
    ['aspas que injetam atributo', 'data:image/png;base64,AAAA" onerror="alert(1)'],
    ['URL externa', 'http://169.254.169.254/latest/meta-data'],
    ['esquema file', 'file:///etc/passwd'],
    ['tipo que não é imagem', 'data:text/html;base64,PHNjcmlwdD4='],
    ['esquema javascript', 'javascript:alert(1)'],
    ['valor que não é string', 123],
  ])('rejeita imagem inválida no mapa: %s', (_rotulo, valor) => {
    const r = atualizarTemplateSchema.safeParse({ layoutJson: { imagens: { logo: valor } } })
    expect(r.success).toBe(false)
  })

  it('rejeita imagem inválida no array', () => {
    const r = atualizarTemplateSchema.safeParse({
      layoutJson: { imagens: [{ nome: 'x', dataUrl: 'https://evil.example/x.png' }] },
    })
    expect(r.success).toBe(false)
  })
})

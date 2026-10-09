import { describe, it, expect } from 'vitest'

import {
  montarEmailOrcamentoAprovado,
  montarEmailOrcamentoEnviado,
  montarEmailOrcamentoReprovado,
} from '../email-templates.js'

// -----------------------------------------------------------------------------
// Testes dos templates de e-mail (`lib/email-templates.ts`) — RF-022.
//
// São funções PURAS que montam uma `MensagemEmail` (destinatário, assunto,
// texto e HTML) para cada evento do orçamento. O disparo (via `lib/email.ts`) e
// o registro na auditoria acontecem nos serviços de domínio; aqui validamos
// apenas o conteúdo determinístico das mensagens:
//
//  - "orçamento enviado": vai ao CLIENTE e inclui o link público (RF-022.1);
//  - "aprovado": notifica o OPERADOR (RF-022.2);
//  - "reprovado": notifica o OPERADOR (RF-022.3).
//
// Regras transversais verificadas: destinatário correto por evento; número do
// orçamento no assunto; link presente só no e-mail do cliente; dados dinâmicos
// escapados no HTML (sem injeção); versões `texto` e `html` sempre presentes.
// -----------------------------------------------------------------------------

describe('montarEmailOrcamentoEnviado', () => {
  const base = {
    destinatario: 'cliente@exemplo.com',
    nomeCliente: 'Maria Silva',
    numero: 'ORC-2026-0001',
    linkPublico: 'https://ni-doc.app/publico/orcamento/token-123',
  }

  it('endereça o e-mail ao cliente', () => {
    const msg = montarEmailOrcamentoEnviado(base)
    expect(msg.destinatario).toBe('cliente@exemplo.com')
  })

  it('inclui o número do orçamento no assunto', () => {
    const msg = montarEmailOrcamentoEnviado(base)
    expect(msg.assunto).toContain('ORC-2026-0001')
  })

  it('inclui o link público no texto e no HTML', () => {
    const msg = montarEmailOrcamentoEnviado(base)
    expect(msg.texto).toContain(base.linkPublico)
    expect(msg.html).toContain(base.linkPublico)
  })

  it('inclui o nome do cliente na saudação', () => {
    const msg = montarEmailOrcamentoEnviado(base)
    expect(msg.texto).toContain('Maria Silva')
    expect(msg.html).toContain('Maria Silva')
  })

  it('sempre produz versão texto e versão HTML', () => {
    const msg = montarEmailOrcamentoEnviado(base)
    expect(msg.texto).toBeTypeOf('string')
    expect(msg.texto?.length ?? 0).toBeGreaterThan(0)
    expect(msg.html).toBeTypeOf('string')
    expect(msg.html?.length ?? 0).toBeGreaterThan(0)
  })

  it('escapa caracteres HTML nos dados dinâmicos (sem injeção)', () => {
    const msg = montarEmailOrcamentoEnviado({
      ...base,
      nomeCliente: '<script>alert(1)</script>',
    })
    expect(msg.html).not.toContain('<script>')
    expect(msg.html).toContain('&lt;script&gt;')
  })

  it('não injeta o link cru dentro de um atributo href sem escapar aspas', () => {
    const msg = montarEmailOrcamentoEnviado({
      ...base,
      linkPublico: 'https://ni-doc.app/publico/orcamento/"></a><script>x',
    })
    expect(msg.html).not.toContain('<script>x')
  })
})

describe('montarEmailOrcamentoAprovado', () => {
  const base = {
    destinatario: 'operador@empresa.com',
    nomeOperador: 'João Souza',
    numero: 'ORC-2026-0002',
    nomeCliente: 'ACME Ltda',
  }

  it('notifica o operador (destinatário é o operador)', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.destinatario).toBe('operador@empresa.com')
  })

  it('inclui o número do orçamento no assunto', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.assunto).toContain('ORC-2026-0002')
  })

  it('sinaliza a aprovação no assunto', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.assunto.toLowerCase()).toContain('aprovado')
  })

  it('menciona o cliente que aprovou no corpo', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.texto).toContain('ACME Ltda')
    expect(msg.html).toContain('ACME Ltda')
  })

  it('não inclui link público (notificação interna ao operador)', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.texto).not.toContain('http')
    expect(msg.html).not.toContain('href')
  })

  it('sempre produz versão texto e versão HTML', () => {
    const msg = montarEmailOrcamentoAprovado(base)
    expect(msg.texto?.length ?? 0).toBeGreaterThan(0)
    expect(msg.html?.length ?? 0).toBeGreaterThan(0)
  })

  it('escapa caracteres HTML nos dados dinâmicos', () => {
    const msg = montarEmailOrcamentoAprovado({ ...base, nomeCliente: '<b>x</b>' })
    expect(msg.html).not.toContain('<b>x</b>')
    expect(msg.html).toContain('&lt;b&gt;')
  })
})

describe('montarEmailOrcamentoReprovado', () => {
  const base = {
    destinatario: 'operador@empresa.com',
    nomeOperador: 'João Souza',
    numero: 'ORC-2026-0003',
    nomeCliente: 'ACME Ltda',
  }

  it('notifica o operador (destinatário é o operador)', () => {
    const msg = montarEmailOrcamentoReprovado(base)
    expect(msg.destinatario).toBe('operador@empresa.com')
  })

  it('inclui o número do orçamento no assunto', () => {
    const msg = montarEmailOrcamentoReprovado(base)
    expect(msg.assunto).toContain('ORC-2026-0003')
  })

  it('sinaliza a reprovação no assunto', () => {
    const msg = montarEmailOrcamentoReprovado(base)
    expect(msg.assunto.toLowerCase()).toContain('reprovado')
  })

  it('inclui a justificativa quando fornecida', () => {
    const msg = montarEmailOrcamentoReprovado({ ...base, justificativa: 'Preço acima do esperado' })
    expect(msg.texto).toContain('Preço acima do esperado')
    expect(msg.html).toContain('Preço acima do esperado')
  })

  it('omite a seção de justificativa quando ausente', () => {
    const msg = montarEmailOrcamentoReprovado(base)
    expect(msg.texto?.toLowerCase()).not.toContain('justificativa')
    expect(msg.html?.toLowerCase()).not.toContain('justificativa')
  })

  it('escapa a justificativa no HTML', () => {
    const msg = montarEmailOrcamentoReprovado({
      ...base,
      justificativa: '<img src=x onerror=1>',
    })
    expect(msg.html).not.toContain('<img src=x')
    expect(msg.html).toContain('&lt;img')
  })

  it('sempre produz versão texto e versão HTML', () => {
    const msg = montarEmailOrcamentoReprovado(base)
    expect(msg.texto?.length ?? 0).toBeGreaterThan(0)
    expect(msg.html?.length ?? 0).toBeGreaterThan(0)
  })
})

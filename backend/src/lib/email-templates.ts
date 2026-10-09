import type { MensagemEmail } from './email.js'

// -----------------------------------------------------------------------------
// Templates de e-mail do orçamento (RF-022).
//
// Funções PURAS que montam uma `MensagemEmail` (do vocabulário de `lib/email.ts`)
// para cada evento do ciclo de vida do orçamento. Esta camada NÃO envia e NÃO
// toca em banco/auditoria: ela só produz o conteúdo. Quem dispara é `lib/email.ts`
// (resiliente a falhas) e quem registra na auditoria são os serviços de domínio
// (versionamento → "enviado"; aceite → "aprovado"/"reprovado").
//
// Eventos cobertos:
//  - "orçamento enviado": vai ao CLIENTE, com o link público de aprovação
//    (RF-022.1). O PDF é anexado pelo serviço de envio; aqui montamos corpo+link.
//  - "aprovado": notifica o OPERADOR responsável (RF-022.2).
//  - "reprovado": notifica o OPERADOR, com a justificativa quando houver (RF-022.3).
//
// Decisões de design:
//  - Cada mensagem traz SEMPRE `texto` (fallback para clientes sem HTML) e `html`.
//  - Todo dado dinâmico interpolado no HTML é escapado (`escaparHtml`) para evitar
//    injeção de marcação — o nome do cliente/operador e a justificativa vêm de
//    entrada do usuário. O link também é escapado antes de entrar no `href`.
//  - Sem dependências externas: mantém a lib 100% testável e determinística.
// -----------------------------------------------------------------------------

/** Dados para o e-mail "orçamento enviado" (ao cliente). */
export interface DadosEmailOrcamentoEnviado {
  /** E-mail do cliente destinatário. */
  destinatario: string
  /** Nome do cliente, usado na saudação. */
  nomeCliente: string
  /** Número do orçamento (ex.: `ORC-2026-0001`). */
  numero: string
  /** Link público de visualização/aprovação do orçamento. */
  linkPublico: string
}

/** Dados para o e-mail "orçamento aprovado" (ao operador). */
export interface DadosEmailOrcamentoAprovado {
  /** E-mail do operador destinatário. */
  destinatario: string
  /** Nome do operador, usado na saudação. */
  nomeOperador: string
  /** Número do orçamento. */
  numero: string
  /** Nome do cliente que aprovou. */
  nomeCliente: string
}

/** Dados para o e-mail "orçamento reprovado" (ao operador). */
export interface DadosEmailOrcamentoReprovado {
  /** E-mail do operador destinatário. */
  destinatario: string
  /** Nome do operador, usado na saudação. */
  nomeOperador: string
  /** Número do orçamento. */
  numero: string
  /** Nome do cliente que reprovou. */
  nomeCliente: string
  /** Justificativa opcional informada na reprovação (RF-019/RF-022.3). */
  justificativa?: string
}

/**
 * Escapa os caracteres com significado em HTML. Espelha o `escaparHtml` do
 * html-renderer/aceite: dados dinâmicos (nome, justificativa, link) não devem
 * quebrar a marcação nem permitir injeção.
 */
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Envolve o corpo em um documento HTML mínimo em pt-BR. */
function documentoHtml(titulo: string, corpo: string): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    `<head><meta charset="utf-8" /><title>${escaparHtml(titulo)}</title></head>`,
    `<body>${corpo}</body>`,
    '</html>',
  ].join('')
}

/**
 * E-mail "orçamento enviado" ao cliente, com o link público de aprovação
 * (RF-022.1). O PDF é anexado pelo serviço de envio.
 */
export function montarEmailOrcamentoEnviado(dados: DadosEmailOrcamentoEnviado): MensagemEmail {
  const assunto = `Orçamento ${dados.numero} disponível para aprovação`

  const texto = [
    `Olá, ${dados.nomeCliente}.`,
    '',
    `Seu orçamento ${dados.numero} está disponível para visualização e aprovação.`,
    `Acesse o link a seguir para aprovar ou reprovar:`,
    dados.linkPublico,
    '',
    'O documento em PDF segue anexo a este e-mail.',
  ].join('\n')

  const linkEscapado = escaparHtml(dados.linkPublico)
  const html = documentoHtml(
    assunto,
    [
      `<p>Olá, ${escaparHtml(dados.nomeCliente)}.</p>`,
      `<p>Seu orçamento <strong>${escaparHtml(dados.numero)}</strong> está disponível para visualização e aprovação.</p>`,
      `<p><a href="${linkEscapado}">Abrir orçamento ${escaparHtml(dados.numero)}</a></p>`,
      `<p>Caso o link não abra, copie e cole o endereço: ${linkEscapado}</p>`,
      '<p>O documento em PDF segue anexo a este e-mail.</p>',
    ].join(''),
  )

  return { destinatario: dados.destinatario, assunto, texto, html }
}

/**
 * E-mail "orçamento aprovado" ao operador (RF-022.2). Notificação interna, sem
 * link público.
 */
export function montarEmailOrcamentoAprovado(dados: DadosEmailOrcamentoAprovado): MensagemEmail {
  const assunto = `Orçamento ${dados.numero} aprovado`

  const texto = [
    `Olá, ${dados.nomeOperador}.`,
    '',
    `O cliente ${dados.nomeCliente} aprovou o orçamento ${dados.numero}.`,
  ].join('\n')

  const html = documentoHtml(
    assunto,
    [
      `<p>Olá, ${escaparHtml(dados.nomeOperador)}.</p>`,
      `<p>O cliente <strong>${escaparHtml(dados.nomeCliente)}</strong> aprovou o orçamento <strong>${escaparHtml(dados.numero)}</strong>.</p>`,
    ].join(''),
  )

  return { destinatario: dados.destinatario, assunto, texto, html }
}

/**
 * E-mail "orçamento reprovado" ao operador (RF-022.3). Inclui a justificativa
 * quando informada.
 */
export function montarEmailOrcamentoReprovado(dados: DadosEmailOrcamentoReprovado): MensagemEmail {
  const assunto = `Orçamento ${dados.numero} reprovado`

  const temJustificativa =
    dados.justificativa !== undefined && dados.justificativa.trim().length > 0

  const linhasTexto = [
    `Olá, ${dados.nomeOperador}.`,
    '',
    `O cliente ${dados.nomeCliente} reprovou o orçamento ${dados.numero}.`,
  ]
  if (temJustificativa) {
    linhasTexto.push('', `Justificativa: ${dados.justificativa}`)
  }
  const texto = linhasTexto.join('\n')

  const corpoHtml = [
    `<p>Olá, ${escaparHtml(dados.nomeOperador)}.</p>`,
    `<p>O cliente <strong>${escaparHtml(dados.nomeCliente)}</strong> reprovou o orçamento <strong>${escaparHtml(dados.numero)}</strong>.</p>`,
  ]
  if (temJustificativa) {
    corpoHtml.push(`<p>Justificativa: ${escaparHtml(dados.justificativa as string)}</p>`)
  }
  const html = documentoHtml(assunto, corpoHtml.join(''))

  return { destinatario: dados.destinatario, assunto, texto, html }
}

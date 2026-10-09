import nodemailer from 'nodemailer'
// pino é CJS: sob moduleResolution Node16 o default não é tipado como callable.
// Importa o namespace e usa o export nomeado `pino` (presente tanto nos tipos
// quanto no objeto exportado em runtime), espelhando o padrão de `pino-http`
// em `app.ts`.
import * as pinoModule from 'pino'

const pino = pinoModule.pino

// -----------------------------------------------------------------------------
// Lib base de envio de e-mail (RF-022).
//
// Esta é a camada de infraestrutura de e-mail: encapsula o transporte SMTP
// (nodemailer) e expõe uma função `enviar` resiliente. Os templates de e-mail
// e o disparo nos eventos do orçamento (enviado, aprovado, reprovado, nova
// versão) são tratados na Tarefa 52 e nos serviços de domínio.
//
// Decisões de design:
//  - Estilo factory + injeção de dependências (`criarEmail`): o transporte e o
//    logger são recebidos como argumentos, o que mantém a lib pura/stateless e
//    permite injetar um transporte mockado nos testes (sem SMTP real).
//  - Resiliência: uma falha de envio NUNCA deve quebrar o fluxo que a originou
//    (ex.: o envio de um orçamento não pode falhar só porque o SMTP caiu). Por
//    isso `enviar` captura o erro, registra via logger e retorna `false` em vez
//    de lançar. O chamador decide se o envio é crítico pelo retorno booleano.
//  - Serialização do destinatário: aceita string única ou lista; normaliza
//    (trim + remoção de vazios) e serializa como string separada por vírgula,
//    o formato aceito pelo campo `to` do nodemailer.
// -----------------------------------------------------------------------------

/**
 * Logger mínimo esperado pela lib. Compatível com a interface do pino, mas
 * declarado localmente para permitir injetar mocks nos testes sem acoplar à
 * assinatura completa do pino.
 */
export interface EmailLogger {
  info: (contexto: Record<string, unknown>, mensagem: string) => void
  warn: (contexto: Record<string, unknown>, mensagem: string) => void
  error: (contexto: Record<string, unknown>, mensagem: string) => void
}

/** Transporte capaz de enviar e-mails (subset da API do nodemailer). */
export interface Transporte {
  sendMail: (opcoes: OpcoesSendMail) => Promise<unknown>
}

/** Opções repassadas ao transporte (subset do `SendMailOptions` do nodemailer). */
export interface OpcoesSendMail {
  from: string
  to: string
  subject: string
  text?: string
  html?: string
}

/** Mensagem de e-mail no vocabulário do domínio (pt-BR). */
export interface MensagemEmail {
  destinatario: string | string[]
  assunto: string
  texto?: string
  html?: string
}

/** Dependências do serviço de e-mail. */
export interface CriarEmailDeps {
  transporte: Transporte
  /** Remetente padrão (`from`), tipicamente `SMTP_FROM`. */
  remetente: string
  logger?: EmailLogger
}

/** Serviço de e-mail: envia mensagens de forma resiliente. */
export interface Email {
  /**
   * Envia uma mensagem. Retorna `true` em sucesso e `false` quando não há
   * destinatário válido ou o envio falha. Nunca lança: falhas são logadas.
   */
  enviar: (mensagem: MensagemEmail) => Promise<boolean>
}

/** Configuração para montar um transporte SMTP a partir do ambiente. */
export interface ConfigSmtp {
  host: string
  porta: number
  usuario?: string
  senha?: string
}

const loggerPadrao: EmailLogger = pino({ name: 'email' })

/**
 * Normaliza o destinatário (string ou lista) em uma string separada por
 * vírgula, removendo espaços e entradas vazias. Retorna string vazia quando
 * não sobra nenhum endereço válido.
 */
export function serializarDestinatario(destinatario: string | string[]): string {
  const lista = Array.isArray(destinatario) ? destinatario : [destinatario]
  return lista
    .map((endereco) => endereco.trim())
    .filter((endereco) => endereco.length > 0)
    .join(', ')
}

/** Cria o serviço de e-mail a partir de um transporte e remetente. */
export function criarEmail({ transporte, remetente, logger = loggerPadrao }: CriarEmailDeps): Email {
  return {
    async enviar(mensagem) {
      const destinatario = serializarDestinatario(mensagem.destinatario)

      if (destinatario.length === 0) {
        logger.warn({ assunto: mensagem.assunto }, 'E-mail não enviado: destinatário vazio')
        return false
      }

      try {
        await transporte.sendMail({
          from: remetente,
          to: destinatario,
          subject: mensagem.assunto,
          text: mensagem.texto,
          html: mensagem.html,
        })
        logger.info({ destinatario, assunto: mensagem.assunto }, 'E-mail enviado')
        return true
      } catch (erro) {
        // Falha de envio é logada e engolida: o fluxo do chamador não deve
        // quebrar por indisponibilidade de SMTP (RF-022).
        logger.error(
          { erro, destinatario, assunto: mensagem.assunto },
          'Falha ao enviar e-mail',
        )
        return false
      }
    },
  }
}

/**
 * Monta um transporte SMTP do nodemailer a partir da configuração. Usa conexão
 * segura (TLS implícito) na porta 465 e StartTLS/plain nas demais. Omite `auth`
 * quando não há credenciais (ex.: servidor SMTP local sem autenticação).
 */
export function criarTransporteSmtp(config: ConfigSmtp): Transporte {
  const auth =
    config.usuario !== undefined && config.senha !== undefined
      ? { user: config.usuario, pass: config.senha }
      : undefined

  return nodemailer.createTransport({
    host: config.host,
    port: config.porta,
    secure: config.porta === 465,
    auth,
  }) as unknown as Transporte
}

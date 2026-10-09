import { AppError } from '../errors/app-error.js'
import { validarTokenPublico } from '../lib/token.js'
import type {
  OrcamentoAceiteRepository,
  RegistrarAceiteInput,
} from '../repositories/orcamento-aceite.repository.js'
import type {
  OrcamentoVersaoRepository,
  VersaoPorToken,
  VersaoSnapshotPorToken,
} from '../repositories/orcamento-versao.repository.js'
import type { OrcamentoRepository } from '../repositories/orcamento.repository.js'
import type { UsuarioRepository } from '../repositories/usuario.repository.js'
import type { ClienteRepository } from '../repositories/cliente.repository.js'
import type { AuditoriaService } from './auditoria.service.js'
import type { PdfService } from './pdf.service.js'
import type { HtmlRendererService } from './html-renderer.service.js'
import type { Email } from '../lib/email.js'
import {
  montarEmailOrcamentoAprovado,
  montarEmailOrcamentoReprovado,
} from '../lib/email-templates.js'

// -----------------------------------------------------------------------------
// Serviço de aceite (RF-019, RF-020, RF-021). Dois fluxos de aprovação de um
// orçamento enviado, ambos registrando evidências imutáveis (IP, user agent,
// hash do documento, método), gerando um comprovante em PDF (reusando a geração
// da Fase 8) e registrando auditoria:
//
//  - `aprovarViaCliente`: fluxo público (sem sessão). Localiza a versão pelo
//    token público, valida o HMAC (lib/token) e a expiração, rejeita token
//    inválido/expirado (410) e aceite duplicado (409), persiste com
//    `metodo='cliente'` e registra auditoria `acao='aprovar'`.
//  - `aceiteManual`: fluxo do operador. Exige justificativa (RF-020.1), carrega
//    o orçamento e a versão vigente do tenant, persiste com `metodo='operador'`
//    e o operador responsável, registra auditoria `acao='aceite_manual'`.
//
// A mudança de status (`orcamentos.status → 'aprovado'`) e a rede de segurança
// contra duplicidade vivem na transação do repositório de aceite — SQL fora do
// serviço. O hash gravado é o `pdf_hash` da versão (SHA-256 dos bytes do PDF
// emitido na Fase 8), não `crypto.ts#hashDocumento` (que normaliza CPF/CNPJ).
// -----------------------------------------------------------------------------

export interface AprovarViaClienteInput {
  token: string
  ip?: string
  userAgent?: string
}

export interface AceiteManualInput {
  tenantId: string
  orcamentoId: string
  usuarioId: string // operador responsável (RF-020.2)
  justificativa: string // obrigatória (RF-020.1)
  ip?: string
  userAgent?: string
}

// Reprovação via cliente (RF-019): mesmas evidências do fluxo de aprovação, com
// uma justificativa OPCIONAL. Não gera comprovante PDF (contraste com aprovar).
export interface ReprovarViaClienteInput {
  token: string
  justificativa?: string
  ip?: string
  userAgent?: string
}

export interface AceiteRegistrado {
  id: string
  versaoId: string
  orcamentoId: string
  metodo: 'cliente' | 'operador'
  hashDocumento: string
  // Null na reprovação (não gera comprovante); preenchido na aprovação.
  comprovantePdfPath: string | null
  comprovantePdfHash: string | null
  criadoEm: Date
}

// Visualização pública do orçamento (rota GET /publico/orcamento/:token): o
// snapshot imutável, a flag de integridade (há pdf_hash emitido?) e a URL do PDF.
export interface VisualizacaoPublica {
  numero: string
  versao: number
  snapshot: unknown
  // true quando a versão tem pdf_hash — o documento oficial foi emitido e é
  // verificável (RF-017). false quando ainda não há PDF/hash.
  integro: boolean
  // URL (relativa) do PDF público; null quando não há PDF emitido.
  pdfUrl: string | null
}

export interface AceiteService {
  aprovarViaCliente(input: AprovarViaClienteInput): Promise<AceiteRegistrado>
  reprovarViaCliente(input: ReprovarViaClienteInput): Promise<AceiteRegistrado>
  visualizarPorToken(token: string): Promise<VisualizacaoPublica>
  aceiteManual(input: AceiteManualInput): Promise<AceiteRegistrado>
}

interface AceiteServiceDeps {
  orcamentoVersaoRepo: OrcamentoVersaoRepository
  aceiteRepo: OrcamentoAceiteRepository
  orcamentoRepo: OrcamentoRepository
  auditoriaService: AuditoriaService
  pdfService: PdfService
  htmlRenderer: HtmlRendererService
  // OPCIONAIS: usados apenas para notificar o operador por e-mail (RF-022.2/.3).
  // Ausentes quando o SMTP não está configurado — nesse caso nada é enviado.
  usuarioRepo?: UsuarioRepository
  clienteRepo?: ClienteRepository
  email?: Email
  // Fonte de tempo injetável para testes determinísticos de expiração.
  relogio?: () => Date
}

// Dados do comprovante (RF-021.2): identificação do orçamento + as evidências do
// aceite. Campos opcionais (IP/UA) viram vazio no HTML.
interface DadosComprovante {
  numero: string
  versao: number
  metodo: 'cliente' | 'operador'
  hashDocumento: string
  dataHora: Date
  ip?: string
  userAgent?: string
}

// Escapa os caracteres com significado em HTML (dados de evidência não devem
// quebrar a estrutura do documento). Espelha o escaparHtml do html-renderer.
function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// HTML determinístico e mínimo do comprovante de aceite (RF-021.2). Não reusa o
// html-renderer (específico do layout de orçamento); monta um documento próprio
// com os campos exigidos. O pdfService transforma esse HTML em PDF (Fase 8).
function montarHtmlComprovante(dados: DadosComprovante): string {
  const linhas = [
    `<p>Orçamento: ${escaparHtml(dados.numero)}</p>`,
    `<p>Versão: ${escaparHtml(String(dados.versao))}</p>`,
    `<p>Data/hora do aceite: ${escaparHtml(dados.dataHora.toISOString())}</p>`,
    `<p>Método de aceite: ${escaparHtml(dados.metodo)}</p>`,
    `<p>Hash do documento: ${escaparHtml(dados.hashDocumento)}</p>`,
    `<p>IP: ${escaparHtml(dados.ip ?? '')}</p>`,
    `<p>User agent: ${escaparHtml(dados.userAgent ?? '')}</p>`,
  ].join('')

  return [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    '<head><meta charset="utf-8" /><title>Comprovante de aceite</title></head>',
    `<body><h1>Comprovante de aceite</h1>${linhas}</body>`,
    '</html>',
  ].join('')
}

export function criarAceiteService(deps: AceiteServiceDeps): AceiteService {
  const {
    orcamentoVersaoRepo,
    aceiteRepo,
    orcamentoRepo,
    auditoriaService,
    pdfService,
    htmlRenderer: _htmlRenderer,
    usuarioRepo,
    clienteRepo,
    email,
    relogio = () => new Date(),
  } = deps
  // htmlRenderer é injetado para compor o wiring futuro, mas o comprovante usa
  // HTML próprio (determinístico) — por isso fica deliberadamente sem uso aqui.
  void _htmlRenderer

  // Monta e dispara (melhor esforço) o e-mail de notificação ao operador
  // responsável. Resolve operador e cliente a partir do orçamento ligado à
  // versão. No-op quando faltam dependências (e-mail/repos não configurados),
  // quando o orçamento/operador não são encontrados ou quando o operador não tem
  // endereço de e-mail. Nunca lança (não pode quebrar o fluxo de decisão).
  async function notificarOperador(
    versao: VersaoPorToken,
    acao: 'aprovar' | 'reprovar' | 'aceite_manual',
    justificativa?: string,
  ): Promise<void> {
    if (!email || !usuarioRepo) {
      return
    }

    const orcamento = await orcamentoRepo.buscarPorId(versao.tenantId, versao.orcamentoId)
    if (!orcamento) {
      return
    }

    const operador = await usuarioRepo.buscarPorId(orcamento.usuarioId)
    if (!operador || operador.email.length === 0) {
      return
    }

    // Nome do cliente para a notificação: lido do cadastro quando o repositório
    // está disponível; cai para string vazia caso contrário (o template tolera).
    const cliente = clienteRepo
      ? await clienteRepo.buscarPorId(versao.tenantId, orcamento.clienteId)
      : null
    const nomeCliente = cliente?.nome ?? ''

    const mensagem =
      acao === 'reprovar'
        ? montarEmailOrcamentoReprovado({
            destinatario: operador.email,
            nomeOperador: operador.nome,
            numero: versao.numero,
            nomeCliente,
            justificativa,
          })
        : montarEmailOrcamentoAprovado({
            destinatario: operador.email,
            nomeOperador: operador.nome,
            numero: versao.numero,
            nomeCliente,
          })

    await email.enviar(mensagem)
  }

  // Persiste a decisão, (opcionalmente) gera o comprovante PDF e registra
  // auditoria. Compartilhado pelos fluxos: muda o repo chamado (aprovar/reprovar),
  // o input, a ação de auditoria e se há comprovante. A reprovação NÃO gera PDF.
  async function registrarDecisao(args: {
    versao: VersaoPorToken
    hashDocumento: string
    aceiteInput: RegistrarAceiteInput
    acao: 'aprovar' | 'reprovar' | 'aceite_manual'
    persistir: (input: RegistrarAceiteInput) => Promise<{
      id: string
      versaoId: string
      metodo: 'cliente' | 'operador'
      hashDocumento: string
      criadoEm: Date
    }>
    gerarComprovante: boolean
    usuarioId?: string
    ip?: string
    userAgent?: string
  }): Promise<AceiteRegistrado> {
    const { versao, hashDocumento } = args

    const aceite = await args.persistir(args.aceiteInput)

    // Comprovante PDF (RF-021): só na aprovação. O sufixo `-aceite` no número
    // evita colidir com o PDF do orçamento (`{numero}-v{versao}.pdf`).
    let comprovantePdfPath: string | null = null
    let comprovantePdfHash: string | null = null
    if (args.gerarComprovante) {
      const html = montarHtmlComprovante({
        numero: versao.numero,
        versao: versao.versao,
        metodo: args.aceiteInput.metodo,
        hashDocumento,
        dataHora: aceite.criadoEm,
        ip: args.ip,
        userAgent: args.userAgent,
      })
      const comprovante = await pdfService.gerarPdf({
        html,
        numero: `${versao.numero}-aceite`,
        versao: versao.versao,
      })
      comprovantePdfPath = comprovante.caminho
      comprovantePdfHash = comprovante.hash
    }

    await auditoriaService.registrar({
      tenantId: versao.tenantId,
      usuarioId: args.usuarioId,
      acao: args.acao,
      entidade: 'orcamentos',
      entidadeId: versao.orcamentoId,
      ip: args.ip,
      userAgent: args.userAgent,
    })

    // Notifica o operador responsável por e-mail (RF-022.2/.3), em melhor
    // esforço: só quando o serviço de e-mail e os repositórios de operador/cliente
    // estão configurados. Executado APÓS a auditoria; o `enviar` da lib engole
    // falhas e devolve booleano — nunca lança —, então uma indisponibilidade de
    // SMTP não quebra o aceite/reprovação já persistido.
    await notificarOperador(versao, args.acao, args.aceiteInput.justificativa)

    return {
      id: aceite.id,
      versaoId: aceite.versaoId,
      orcamentoId: versao.orcamentoId,
      metodo: aceite.metodo,
      hashDocumento: aceite.hashDocumento,
      comprovantePdfPath,
      comprovantePdfHash,
      criadoEm: aceite.criadoEm,
    }
  }

  // Valida o token público (existência + HMAC + expiração) e devolve a versão.
  // Distingue "não encontrado" (token inexistente ou HMAC inválido → 404) de
  // "expirado" (expira_em no passado → 410), conforme decidido para as rotas
  // públicas (tarefa 42). Genérica para os três fluxos públicos.
  function validarToken<T extends { versaoId: string; expiraEm: Date | null }>(
    token: string,
    versao: T | null,
  ): T {
    if (!versao || !validarTokenPublico(token, versao.versaoId)) {
      throw new AppError(404, 'Orçamento não encontrado')
    }
    if (versao.expiraEm !== null && versao.expiraEm.getTime() < relogio().getTime()) {
      throw new AppError(410, 'Link de aprovação expirado')
    }
    return versao
  }

  return {
    async aprovarViaCliente(input: AprovarViaClienteInput): Promise<AceiteRegistrado> {
      const versao = validarToken(input.token, await orcamentoVersaoRepo.buscarPorToken(input.token))
      // Duplicado: orçamento já aprovado não aceita novo aceite (RF-019.6).
      if (versao.statusOrcamento === 'aprovado') {
        throw new AppError(409, 'Orçamento já aprovado')
      }
      // Integridade: sem hash do PDF emitido não há como registrar o aceite.
      if (versao.pdfHash === null) {
        throw new AppError(409, 'Documento sem hash de integridade')
      }

      return registrarDecisao({
        versao,
        hashDocumento: versao.pdfHash,
        aceiteInput: {
          tenantId: versao.tenantId,
          versaoId: versao.versaoId,
          metodo: 'cliente',
          hashDocumento: versao.pdfHash,
          ip: input.ip,
          userAgent: input.userAgent,
        },
        acao: 'aprovar',
        persistir: (i) => aceiteRepo.aprovarAceite(i),
        gerarComprovante: true,
        ip: input.ip,
        userAgent: input.userAgent,
      })
    },

    async reprovarViaCliente(input: ReprovarViaClienteInput): Promise<AceiteRegistrado> {
      const versao = validarToken(input.token, await orcamentoVersaoRepo.buscarPorToken(input.token))
      // Já decidido: orçamento aprovado/reprovado não aceita nova decisão.
      if (versao.statusOrcamento === 'aprovado' || versao.statusOrcamento === 'reprovado') {
        throw new AppError(409, 'Orçamento já decidido')
      }
      if (versao.pdfHash === null) {
        throw new AppError(409, 'Documento sem hash de integridade')
      }

      return registrarDecisao({
        versao,
        hashDocumento: versao.pdfHash,
        aceiteInput: {
          tenantId: versao.tenantId,
          versaoId: versao.versaoId,
          metodo: 'cliente',
          hashDocumento: versao.pdfHash,
          justificativa: input.justificativa,
          ip: input.ip,
          userAgent: input.userAgent,
        },
        acao: 'reprovar',
        persistir: (i) => aceiteRepo.reprovarAceite(i),
        // Reprovação NÃO gera comprovante PDF — apenas registra o evento.
        gerarComprovante: false,
        ip: input.ip,
        userAgent: input.userAgent,
      })
    },

    async visualizarPorToken(token: string): Promise<VisualizacaoPublica> {
      const versao: VersaoSnapshotPorToken = validarToken(
        token,
        await orcamentoVersaoRepo.buscarSnapshotPorToken(token),
      )

      // Integridade: há documento oficial emitido (pdf_hash) e verificável?
      const integro = versao.pdfHash !== null
      // A URL do PDF aponta de volta para a própria rota pública, usando o token
      // como credencial (sem expor caminho de disco). Null quando não há PDF.
      const pdfUrl = versao.pdfPath !== null ? `/api/publico/orcamento/${token}/pdf` : null

      return {
        numero: versao.numero,
        versao: versao.versao,
        snapshot: versao.snapshot,
        integro,
        pdfUrl,
      }
    },

    async aceiteManual(input: AceiteManualInput): Promise<AceiteRegistrado> {
      // Justificativa obrigatória (RF-020.1): rejeita vazia ou só espaços.
      if (input.justificativa.trim().length === 0) {
        throw new AppError(400, 'Justificativa é obrigatória para o aceite manual')
      }

      const orcamento = await orcamentoRepo.buscarPorId(input.tenantId, input.orcamentoId)
      if (!orcamento) {
        throw new AppError(404, 'Orçamento não encontrado')
      }

      // Aceite manual recebe orcamentoId, não token: usa a versão vigente.
      const versao = await orcamentoVersaoRepo.buscarVersaoAtualPorOrcamento(
        input.tenantId,
        input.orcamentoId,
      )
      if (!versao) {
        throw new AppError(409, 'Orçamento sem versão enviada')
      }
      if (versao.pdfHash === null) {
        throw new AppError(409, 'Documento sem hash de integridade')
      }

      return registrarDecisao({
        versao,
        hashDocumento: versao.pdfHash,
        aceiteInput: {
          tenantId: input.tenantId,
          versaoId: versao.versaoId,
          metodo: 'operador',
          usuarioId: input.usuarioId,
          justificativa: input.justificativa,
          hashDocumento: versao.pdfHash,
          ip: input.ip,
          userAgent: input.userAgent,
        },
        acao: 'aceite_manual',
        persistir: (i) => aceiteRepo.aprovarAceite(i),
        gerarComprovante: true,
        usuarioId: input.usuarioId,
        ip: input.ip,
        userAgent: input.userAgent,
      })
    },
  }
}

import { AppError } from '../errors/app-error.js'
import { validarTokenPublico } from '../lib/token.js'
import type {
  OrcamentoAceiteRepository,
  RegistrarAceiteInput,
} from '../repositories/orcamento-aceite.repository.js'
import type {
  OrcamentoVersaoRepository,
  VersaoPorToken,
} from '../repositories/orcamento-versao.repository.js'
import type { OrcamentoRepository } from '../repositories/orcamento.repository.js'
import type { AuditoriaService } from './auditoria.service.js'
import type { PdfService } from './pdf.service.js'
import type { HtmlRendererService } from './html-renderer.service.js'

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

export interface AceiteRegistrado {
  id: string
  versaoId: string
  orcamentoId: string
  metodo: 'cliente' | 'operador'
  hashDocumento: string
  comprovantePdfPath: string
  comprovantePdfHash: string
  criadoEm: Date
}

export interface AceiteService {
  aprovarViaCliente(input: AprovarViaClienteInput): Promise<AceiteRegistrado>
  aceiteManual(input: AceiteManualInput): Promise<AceiteRegistrado>
}

interface AceiteServiceDeps {
  orcamentoVersaoRepo: OrcamentoVersaoRepository
  aceiteRepo: OrcamentoAceiteRepository
  orcamentoRepo: OrcamentoRepository
  auditoriaService: AuditoriaService
  pdfService: PdfService
  htmlRenderer: HtmlRendererService
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
    relogio = () => new Date(),
  } = deps
  // htmlRenderer é injetado para compor o wiring futuro, mas o comprovante usa
  // HTML próprio (determinístico) — por isso fica deliberadamente sem uso aqui.
  void _htmlRenderer

  // Persiste o aceite, gera o comprovante PDF e registra auditoria. Compartilhado
  // pelos dois fluxos: muda apenas o input de aceite, os dados do comprovante e a
  // ação de auditoria.
  async function registrarAceite(args: {
    versao: VersaoPorToken
    hashDocumento: string
    aceiteInput: RegistrarAceiteInput
    acao: 'aprovar' | 'aceite_manual'
    usuarioId?: string
    ip?: string
    userAgent?: string
  }): Promise<AceiteRegistrado> {
    const { versao, hashDocumento } = args

    const aceite = await aceiteRepo.aprovarAceite(args.aceiteInput)

    // Comprovante PDF (RF-021): reusa a geração da Fase 8. O sufixo `-aceite` no
    // número evita colidir com o PDF do orçamento (`{numero}-v{versao}.pdf`).
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

    await auditoriaService.registrar({
      tenantId: versao.tenantId,
      usuarioId: args.usuarioId,
      acao: args.acao,
      entidade: 'orcamentos',
      entidadeId: versao.orcamentoId,
      ip: args.ip,
      userAgent: args.userAgent,
    })

    return {
      id: aceite.id,
      versaoId: aceite.versaoId,
      orcamentoId: versao.orcamentoId,
      metodo: aceite.metodo,
      hashDocumento: aceite.hashDocumento,
      comprovantePdfPath: comprovante.caminho,
      comprovantePdfHash: comprovante.hash,
      criadoEm: aceite.criadoEm,
    }
  }

  return {
    async aprovarViaCliente(input: AprovarViaClienteInput): Promise<AceiteRegistrado> {
      const versao = await orcamentoVersaoRepo.buscarPorToken(input.token)
      // Mensagem genérica em qualquer falha de token (RF-019.7): não revela se o
      // token existe. Token inexistente ou HMAC inválido → 410.
      if (!versao || !validarTokenPublico(input.token, versao.versaoId)) {
        throw new AppError(410, 'Link de aprovação inválido ou expirado')
      }
      // Expiração: a versão expira quando expiraEm está no passado.
      if (versao.expiraEm !== null && versao.expiraEm.getTime() < relogio().getTime()) {
        throw new AppError(410, 'Link de aprovação inválido ou expirado')
      }
      // Duplicado: orçamento já aprovado não aceita novo aceite (RF-019.6).
      if (versao.statusOrcamento === 'aprovado') {
        throw new AppError(409, 'Orçamento já aprovado')
      }
      // Integridade: sem hash do PDF emitido não há como registrar o aceite.
      if (versao.pdfHash === null) {
        throw new AppError(409, 'Documento sem hash de integridade')
      }

      return registrarAceite({
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
        ip: input.ip,
        userAgent: input.userAgent,
      })
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

      return registrarAceite({
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
        usuarioId: input.usuarioId,
        ip: input.ip,
        userAgent: input.userAgent,
      })
    },
  }
}

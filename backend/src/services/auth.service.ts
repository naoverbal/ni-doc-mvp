import { verificarSenha } from '../lib/senha.js'
import { AppError } from '../errors/app-error.js'
import type { UsuarioPublico, UsuarioRepository } from '../repositories/usuario.repository.js'
import type { SessaoAtiva, SessaoRepository } from '../repositories/sessao.repository.js'

export interface LoginInput {
  email: string
  senha: string
  ip?: string
  userAgent?: string
}

export interface LoginResult {
  sessaoId: string
  expiraEm: Date
  usuario: {
    id: string
    nome: string
    email: string
    papel: 'admin' | 'operador'
    tenantId: string
  }
}

export interface AuthService {
  login(input: LoginInput): Promise<LoginResult>
  logout(sessaoId: string): Promise<void>
  validarSessao(sessaoId: string): Promise<{ usuario: UsuarioPublico; sessao: SessaoAtiva } | null>
}

interface AuthServiceDeps {
  usuarioRepo: UsuarioRepository
  sessaoRepo: SessaoRepository
  // Escopo de tenant (RLS). As rotas `/api/auth/*` não têm `setTenant`, mas a
  // auditoria de login/logout escreve em `eventos_auditoria` (tabela com RLS
  // forçado). Como o tenant do usuário já é conhecido nesse ponto, o registro de
  // auditoria roda dentro de `executarComTenant(tenantId, ...)` para ativar o
  // GUC `app.current_tenant`. Default: passthrough (testes unitários).
  escopoTenant?: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>
}

const OITO_HORAS_MS = 8 * 60 * 60 * 1000
const INTERVALO_TOQUE_SESSAO_MS = 60 * 1000

export function criarAuthService(deps: AuthServiceDeps): AuthService {
  const { usuarioRepo, sessaoRepo, escopoTenant = (_tenantId, fn) => fn() } = deps

  return {
    async login(input: LoginInput): Promise<LoginResult> {
      const usuario = await usuarioRepo.buscarPorEmail(input.email)

      if (!usuario) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      // Usuário inativo recebe a mesma resposta de credencial inválida (não revela
      // o estado da conta). A senha é verificada antes para manter o mesmo custo.
      const senhaValida = await verificarSenha(input.senha, usuario.senhaHash)
      if (!senhaValida || !usuario.ativo) {
        throw new AppError(401, 'Credenciais inválidas')
      }

      const expiraEm = new Date(Date.now() + OITO_HORAS_MS)
      // Sessão + auditoria de login numa única transação, sob o escopo do tenant
      // (RLS em `eventos_auditoria`): se a auditoria falhar, a sessão não é criada
      // e o login é recusado.
      const sessao = await escopoTenant(usuario.tenantId, () =>
        sessaoRepo.criar(
          {
            usuarioId: usuario.id,
            ip: input.ip,
            userAgent: input.userAgent,
            expiraEm,
          },
          () => ({
            tenantId: usuario.tenantId,
            usuarioId: usuario.id,
            acao: 'login',
            entidade: 'usuarios',
            entidadeId: usuario.id,
            ip: input.ip,
            userAgent: input.userAgent,
          }),
        ),
      )

      return {
        sessaoId: sessao.id,
        expiraEm: sessao.expiraEm,
        usuario: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          papel: usuario.papel,
          tenantId: usuario.tenantId,
        },
      }
    },

    async logout(sessaoId: string): Promise<void> {
      // Buscar sessão para obter tenantId/usuarioId para auditoria
      const sessao = await sessaoRepo.buscarPorId(sessaoId)
      const usuario = sessao ? await usuarioRepo.buscarPorId(sessao.usuarioId) : null

      if (!usuario) {
        // Sem usuário resolvido não há tenant para auditar: apenas invalida.
        await sessaoRepo.invalidar(sessaoId)
        return
      }

      // Invalidação da sessão + auditoria de logout numa única transação, sob o
      // escopo do tenant: se a auditoria falhar, a sessão continua válida.
      await escopoTenant(usuario.tenantId, () =>
        sessaoRepo.invalidar(sessaoId, () => ({
          tenantId: usuario.tenantId,
          usuarioId: usuario.id,
          acao: 'logout',
          entidade: 'usuarios',
          entidadeId: usuario.id,
        })),
      )
    },

    async validarSessao(
      sessaoId: string,
    ): Promise<{ usuario: UsuarioPublico; sessao: SessaoAtiva } | null> {
      const sessao = await sessaoRepo.buscarPorId(sessaoId)
      if (!sessao) return null

      if (sessao.expiraEm < new Date()) {
        return null
      }

      const usuario = await usuarioRepo.buscarPorId(sessao.usuarioId)
      if (!usuario) return null

      // Throttle: `ultima_atividade` só é regravada se o último registro tiver mais
      // de 60s. Evita um UPDATE por requisição (linhas mortas e vacuum em
      // `sessoes`). A expiração da sessão usa `expira_em`, não este carimbo.
      if (Date.now() - sessao.ultimaAtividade.getTime() >= INTERVALO_TOQUE_SESSAO_MS) {
        await sessaoRepo.atualizarAtividade(sessaoId)
      }

      return { usuario, sessao }
    },
  }
}

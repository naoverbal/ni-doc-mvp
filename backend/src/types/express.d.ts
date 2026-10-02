import type { UsuarioPublico } from '../repositories/usuario.repository.js'
import type { SessaoAtiva } from '../repositories/sessao.repository.js'

declare global {
  namespace Express {
    interface Request {
      usuario: UsuarioPublico
      sessao: SessaoAtiva
    }
  }
}

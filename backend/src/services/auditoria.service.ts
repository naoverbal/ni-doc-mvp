import type {
  AuditoriaRepository,
  CriarEventoInput,
  EventoAuditoria,
  FiltroAuditoria,
} from '../repositories/auditoria.repository.js'

export interface AuditoriaService {
  registrar(input: CriarEventoInput): Promise<void>
  listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]>
}

export function criarAuditoriaService(repo: AuditoriaRepository): AuditoriaService {
  return {
    async registrar(input: CriarEventoInput): Promise<void> {
      await repo.criar(input)
    },

    async listar(filtro: FiltroAuditoria): Promise<EventoAuditoria[]> {
      return repo.listar(filtro)
    },
  }
}

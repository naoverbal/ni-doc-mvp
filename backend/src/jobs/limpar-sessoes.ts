import type { Kysely } from 'kysely'
import { sql } from 'kysely'
// pino é CJS: importa o namespace e usa o export nomeado (espelha `expirar-orcamentos.ts`).
import * as pinoModule from 'pino'
import type { Database } from '../types/database.js'
import { db as dbPadrao } from '../config/database.js'

const pino = pinoModule.pino

// -----------------------------------------------------------------------------
// Job de limpeza de sessões expiradas.
//
// A tabela `sessoes` só perdia linhas no logout; sessões expiradas (expira_em no
// passado, já recusadas por `validarSessao`) ficavam para sempre. O DELETE roda
// na função SECURITY DEFINER `rls_limpar_sessoes_expiradas` (migration 014), pois
// `sessoes` tem RLS forçado e o job roda fora de escopo de tenant.
// -----------------------------------------------------------------------------

export interface LimparSessoesJob {
  executar(): Promise<{ removidas: number }>
}

export function criarLimparSessoesJob(db: Kysely<Database> = dbPadrao): LimparSessoesJob {
  return {
    async executar(): Promise<{ removidas: number }> {
      const resultado = await sql<{ removidas: string }>`
        SELECT rls_limpar_sessoes_expiradas() AS removidas
      `.execute(db)
      return { removidas: Number(resultado.rows[0]?.removidas ?? 0) }
    },
  }
}

const UMA_HORA_MS = 60 * 60 * 1000
const UM_DIA_MS = 24 * UMA_HORA_MS

/**
 * Agendador mínimo: executa uma vez na partida e depois a cada 24h. Falhas são
 * logadas e não derrubam o agendador. Retorna o timer para shutdown.
 */
export function agendarLimparSessoes(
  job: LimparSessoesJob = criarLimparSessoesJob(),
): NodeJS.Timeout {
  const logger = pino({ name: 'limpar-sessoes' })
  const rodar = (): void => {
    job
      .executar()
      .then(({ removidas }) => logger.info({ removidas }, 'limpeza de sessões concluída'))
      .catch((erro: unknown) => {
        logger.error({ erro }, 'execução agendada da limpeza de sessões falhou')
      })
  }
  rodar()
  const timer = setInterval(rodar, UM_DIA_MS)
  timer.unref()
  return timer
}

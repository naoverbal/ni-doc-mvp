import type { Kysely } from 'kysely'
import { sql } from 'kysely'
// pino é CJS: importa o namespace e usa o export nomeado (espelha `limpar-pdfs.ts`).
import * as pinoModule from 'pino'
import type { Database } from '../types/database.js'
import { db as dbPadrao } from '../config/database.js'

const pino = pinoModule.pino

// -----------------------------------------------------------------------------
// Job de expiração automática de orçamentos (Tarefa 66, RF-009.5).
//
// Muda para `expirado` os orçamentos `enviado` cuja validade foi atingida
// (`data_emissao + validade_dias`, vale o dia inteiro; expira às 00:00 do dia
// seguinte em America/Sao_Paulo — ver `lib/validade.ts`) e registra a auditoria.
//
// Decisões de design:
//  - CROSS-TENANT sob RLS: a varredura e a auditoria rodam na função
//    SECURITY DEFINER `rls_expirar_orcamentos_vencidos` (migration 008), que faz
//    o UPDATE e o INSERT de auditoria numa única instrução. Assim o job não
//    precisa de papel privilegiado nem de `app.current_tenant`.
//  - IDEMPOTENTE e seguro sob concorrência: o UPDATE só atinge linhas ainda
//    `enviado`; uma segunda execução (ou instância simultânea) não altera nada
//    e não duplica auditoria. Aprovado/reprovado nunca são tocados.
//  - TESTÁVEL: relógio e repositório são injetáveis; o agendamento é um
//    envoltório fino e separado.
// -----------------------------------------------------------------------------

export interface OrcamentoExpirado {
  orcamentoId: string
  tenantId: string
  numero: string
}

export interface ExpirarOrcamentosRepositorio {
  // Expira (atomicamente, com auditoria) os orçamentos vencidos em `agora`.
  expirarVencidos(agora: Date): Promise<OrcamentoExpirado[]>
}

export interface ExpirarOrcamentosResultado {
  // Ids dos orçamentos que ESTA execução mudou para `expirado`.
  expirados: string[]
}

export interface ExpirarOrcamentosJob {
  executar(): Promise<ExpirarOrcamentosResultado>
}

export interface ExpirarOrcamentosJobDeps {
  repo: ExpirarOrcamentosRepositorio
  agora?: () => Date
  logger?: Pick<pinoModule.Logger, 'info' | 'error'>
}

export function criarExpirarOrcamentosJob(deps: ExpirarOrcamentosJobDeps): ExpirarOrcamentosJob {
  const { repo } = deps
  const agora = deps.agora ?? (() => new Date())
  const logger = deps.logger ?? pino({ name: 'expirar-orcamentos' })
  return {
    async executar(): Promise<ExpirarOrcamentosResultado> {
      const referencia = agora()
      const expirados = await repo.expirarVencidos(referencia)
      logger.info({ expirados: expirados.length, referencia }, 'expiração de orçamentos concluída')
      return { expirados: expirados.map((o) => o.orcamentoId) }
    },
  }
}

interface ExpiradoRow {
  id_orcamento: string
  id_tenant: string
  numero_orcamento: string
}

export function criarExpirarOrcamentosRepositorio(
  db: Kysely<Database>,
): ExpirarOrcamentosRepositorio {
  return {
    async expirarVencidos(agora: Date): Promise<OrcamentoExpirado[]> {
      const resultado = await sql<ExpiradoRow>`
        SELECT id_orcamento, id_tenant, numero_orcamento
        FROM rls_expirar_orcamentos_vencidos(${agora})
      `.execute(db)
      return resultado.rows.map((row) => ({
        orcamentoId: row.id_orcamento,
        tenantId: row.id_tenant,
        numero: row.numero_orcamento,
      }))
    },
  }
}

export function criarExpirarOrcamentosJobPadrao(
  agora?: () => Date,
  db: Kysely<Database> = dbPadrao,
): ExpirarOrcamentosJob {
  return criarExpirarOrcamentosJob({ repo: criarExpirarOrcamentosRepositorio(db), agora })
}

// A expiração ocorre à meia-noite de São Paulo; rodar de hora em hora limita o
// atraso a 1h (e o aceite checa a validade na hora, então o atraso é inofensivo).
const UMA_HORA_MS = 60 * 60 * 1000

/**
 * Agendador mínimo: executa uma vez na partida e depois de hora em hora. Falhas
 * são logadas e não derrubam o agendador. Retorna o timer para shutdown.
 */
export function agendarExpirarOrcamentos(
  job: ExpirarOrcamentosJob = criarExpirarOrcamentosJobPadrao(),
): NodeJS.Timeout {
  const logger = pino({ name: 'expirar-orcamentos' })
  const rodar = (): void => {
    void job.executar().catch((erro: unknown) => {
      logger.error({ erro }, 'execução agendada da expiração de orçamentos falhou')
    })
  }
  rodar()
  const timer = setInterval(rodar, UMA_HORA_MS)
  timer.unref()
  return timer
}

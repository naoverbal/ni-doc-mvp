import { rm as fsRm } from 'node:fs/promises'
import type { Kysely } from 'kysely'
// pino é CJS: sob moduleResolution Node16 o default não é tipado como callable.
// Importa o namespace e usa o export nomeado `pino`, espelhando `lib/email.ts`.
import * as pinoModule from 'pino'
import type { Database } from '../types/database.js'
import { db as dbPadrao } from '../config/database.js'
import { env } from '../config/env.js'
import type { AuditoriaService } from '../services/auditoria.service.js'
import { criarAuditoriaService } from '../services/auditoria.service.js'
import { criarAuditoriaRepository } from '../repositories/auditoria.repository.js'

const pino = pinoModule.pino

// -----------------------------------------------------------------------------
// Job de limpeza de PDFs antigos (Tarefa 55, _Requirements: cleanup_).
//
// Motivação (design.md, riscos): "PDFs acumulam em disco" → job de limpeza para
// PDFs com mais de 1 ano (após a retenção legal). Rode diariamente via cron.
//
// Decisões de design:
//  - MANUTENÇÃO CROSS-TENANT: diferente dos fluxos de request, o job varre
//    versões de TODOS os tenants. Por isso NÃO roda sob o escopo de
//    `app.current_tenant`; usa o papel de banco que o `migrate`/`seed` usam
//    (privilegiado, sem RLS) e resolve o `tenant_id` de cada versão via join com
//    `orcamentos` para registrar a auditoria no tenant correto.
//  - FATOR TESTÁVEL: a lógica vive em `criarLimparPdfsJob({ ... })`, com
//    repositório, filesystem, serviço de auditoria e relógio INJETADOS. Assim o
//    job roda nos testes sem banco, sem disco e sem agendador. O agendamento de
//    cron (`agendarLimparPdfsDiario`) é um envoltório fino e separado da lógica.
//  - TOLERÂNCIA A FALHAS: a falha ao remover um arquivo (ex.: permissão, arquivo
//    já ausente) NÃO interrompe o job — é logada e contabilizada; os demais
//    seguem. Só os arquivos efetivamente removidos registram auditoria e têm a
//    referência (`pdf_path`/`pdf_hash`) limpa no banco, mantendo a consistência
//    entre o disco e o registro.
//  - RETENÇÃO = 1 ANO: a data-limite é "agora menos 1 ano"; versões com
//    `enviado_em` anterior a ela são elegíveis. `enviado_em` é o marco de emissão
//    do documento (quando o PDF passa a existir).
// -----------------------------------------------------------------------------

// Linha projetada pelo join versão↔orçamento, já em camelCase de domínio.
export interface PdfExpirado {
  versaoId: string
  orcamentoId: string
  tenantId: string
  numero: string
  versao: number
  pdfPath: string | null
  enviadoEm: Date
}

// Fronteira de dados do job (padrão repositório: dono das queries Kysely).
export interface LimparPdfsRepositorio {
  // Versões cujo `enviado_em` é anterior a `dataLimite`, com PDF em disco.
  listarPdfsExpirados(dataLimite: Date): Promise<PdfExpirado[]>
  // Zera `pdf_path`/`pdf_hash` da versão após a remoção do arquivo.
  limparReferenciaPdf(versaoId: string): Promise<void>
}

// Subconjunto mínimo de `node:fs/promises` usado pelo job (injeção nos testes).
export interface LimparPdfsFileSystem {
  rm(caminho: string): Promise<void>
}

export interface LimparPdfsResultado {
  // Arquivos removidos do disco com sucesso.
  removidos: number
  // Arquivos que falharam ao ser removidos (contabilizados, não interrompem).
  falhas: number
}

export interface LimparPdfsJob {
  executar(): Promise<LimparPdfsResultado>
}

export interface LimparPdfsJobDeps {
  repo: LimparPdfsRepositorio
  fs: LimparPdfsFileSystem
  auditoriaService: AuditoriaService
  // Relógio injetável (default: `Date.now`). Permite fixar o tempo nos testes.
  agora?: () => Date
  logger?: Pick<pinoModule.Logger, 'info' | 'warn' | 'error'>
}

// Subtrai exatamente 1 ano da data informada (fronteira da retenção).
function umAnoAntes(data: Date): Date {
  const limite = new Date(data)
  limite.setFullYear(limite.getFullYear() - 1)
  return limite
}

export function criarLimparPdfsJob(deps: LimparPdfsJobDeps): LimparPdfsJob {
  const { repo, fs, auditoriaService } = deps
  const agora = deps.agora ?? (() => new Date())
  const logger = deps.logger ?? pino({ name: 'limpar-pdfs' })

  return {
    async executar(): Promise<LimparPdfsResultado> {
      const dataLimite = umAnoAntes(agora())
      const expirados = await repo.listarPdfsExpirados(dataLimite)

      let removidos = 0
      let falhas = 0

      for (const pdf of expirados) {
        // Versão sem arquivo em disco: nada a remover (defesa; a query já filtra).
        if (pdf.pdfPath === null) {
          continue
        }

        try {
          await fs.rm(pdf.pdfPath)
        } catch (erro) {
          falhas += 1
          logger.warn(
            { versaoId: pdf.versaoId, pdfPath: pdf.pdfPath, erro },
            'falha ao remover PDF expirado; seguindo com os demais',
          )
          continue
        }

        // Só após a remoção bem-sucedida: registra auditoria no tenant do
        // orçamento e limpa a referência no banco (disco e registro coerentes).
        await auditoriaService.registrar({
          tenantId: pdf.tenantId,
          acao: 'limpar_pdf',
          entidade: 'orcamento_versoes',
          entidadeId: pdf.versaoId,
          estadoAnterior: { pdfPath: pdf.pdfPath },
          estadoNovo: { pdfPath: null },
        })
        await repo.limparReferenciaPdf(pdf.versaoId)
        removidos += 1
      }

      logger.info({ removidos, falhas, dataLimite }, 'limpeza de PDFs concluída')
      return { removidos, falhas }
    },
  }
}

// -----------------------------------------------------------------------------
// Implementação padrão do repositório (dona do SQL Kysely). Varre TODOS os
// tenants (join com `orcamentos` para o `tenant_id`), por isso é usada pelo job
// de manutenção fora do escopo de RLS por request.
// -----------------------------------------------------------------------------

interface PdfExpiradoRow {
  versao_id: string
  orcamento_id: string
  tenant_id: string
  numero: string
  versao: number
  pdf_path: string | null
  enviado_em: Date
}

export function criarLimparPdfsRepositorio(db: Kysely<Database>): LimparPdfsRepositorio {
  return {
    async listarPdfsExpirados(dataLimite: Date): Promise<PdfExpirado[]> {
      const rows = (await db
        .selectFrom('orcamento_versoes as v')
        .innerJoin('orcamentos as o', 'o.id', 'v.orcamento_id')
        .select([
          'v.id as versao_id',
          'v.orcamento_id as orcamento_id',
          'o.tenant_id as tenant_id',
          'o.numero as numero',
          'v.versao as versao',
          'v.pdf_path as pdf_path',
          'v.enviado_em as enviado_em',
        ])
        .where('v.pdf_path', 'is not', null)
        .where('v.enviado_em', '<', dataLimite)
        .orderBy('v.enviado_em', 'asc')
        .execute()) as unknown as PdfExpiradoRow[]

      return rows.map((row) => ({
        versaoId: row.versao_id,
        orcamentoId: row.orcamento_id,
        tenantId: row.tenant_id,
        numero: row.numero,
        versao: row.versao,
        pdfPath: row.pdf_path,
        enviadoEm: row.enviado_em,
      }))
    },

    async limparReferenciaPdf(versaoId: string): Promise<void> {
      await db
        .updateTable('orcamento_versoes')
        .set({ pdf_path: null, pdf_hash: null })
        .where('id', '=', versaoId)
        .execute()
    },
  }
}

// -----------------------------------------------------------------------------
// Wiring padrão: compõe o job com as dependências reais (Kysely global,
// `node:fs/promises`, serviço de auditoria). Mantido separado da lógica para que
// os testes injetem fakes sem tocar em banco/disco.
// -----------------------------------------------------------------------------

export function criarLimparPdfsJobPadrao(db: Kysely<Database> = dbPadrao): LimparPdfsJob {
  const auditoriaService = criarAuditoriaService(criarAuditoriaRepository(db))
  return criarLimparPdfsJob({
    repo: criarLimparPdfsRepositorio(db),
    fs: { rm: (caminho) => fsRm(caminho) },
    auditoriaService,
  })
}

// Intervalo de um dia em milissegundos (cron diário).
const UM_DIA_MS = 24 * 60 * 60 * 1000

/**
 * Agendador mínimo (cron diário) do job de limpeza. Dispara uma execução a cada
 * 24h; falhas de uma execução são logadas e não derrubam o agendador. Retorna o
 * handle do timer para permitir o cancelamento (ex.: shutdown gracioso).
 *
 * Mantido fino e separado da lógica (`criarLimparPdfsJob`), que é a parte
 * testável. O agendamento em si não é coberto por teste unitário.
 */
export function agendarLimparPdfsDiario(job: LimparPdfsJob = criarLimparPdfsJobPadrao()): NodeJS.Timeout {
  const logger = pino({ name: 'limpar-pdfs' })
  const timer = setInterval(() => {
    void job.executar().catch((erro: unknown) => {
      logger.error({ erro }, 'execução agendada da limpeza de PDFs falhou')
    })
  }, UM_DIA_MS)
  // Não impede o processo de encerrar se for a única coisa pendente.
  timer.unref()
  return timer
}

// Permite rodar o job manualmente: `tsx src/jobs/limpar-pdfs.ts`.
const executadoDiretamente =
  process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`

if (executadoDiretamente) {
  // `env` é validado na primeira leitura; força a validação cedo (fail-fast).
  void env.PDFS_DIR
  criarLimparPdfsJobPadrao()
    .executar()
    .then((resultado) => {
      console.log(`Limpeza concluída: ${resultado.removidos} removidos, ${resultado.falhas} falhas`)
      process.exit(0)
    })
    .catch((erro: unknown) => {
      console.error('Erro na limpeza de PDFs:', erro)
      process.exit(1)
    })
}

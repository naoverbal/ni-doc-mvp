import { randomUUID } from 'node:crypto'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'
import { AppError } from '../errors/app-error.js'
import { gerarTokenPublico } from '../lib/token.js'

// -----------------------------------------------------------------------------
// Repositório das versões imutáveis do orçamento (tabela orcamento_versoes).
// Dono do SQL do envio: calcula a próxima versão sequencial, resolve o template
// ativo do tenant, invalida o aceite anterior, insere a versão com token público
// único e marca o orçamento como `enviado` — tudo em uma transação atômica
// (RF-008, RF-009). A geração de PDF é da tarefa 40: `pdf_path`/`pdf_hash` ficam
// nulos aqui.
// -----------------------------------------------------------------------------

export interface CriarVersaoEnviarInput {
  tenantId: string
  orcamentoId: string
  // Snapshot imutável montado pelo serviço (snapshot.service). Serializável em JSONB.
  snapshot: unknown
  // Derivado de validade; pode ser null no MVP (expiração é da tarefa 42).
  expiraEm?: Date | null
}

export interface OrcamentoVersaoPublica {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  templateId: string
  pdfPath: string | null
  pdfHash: string | null
  enviadoEm: Date
  expiraEm: Date | null
}

export interface OrcamentoVersaoRepository {
  criarVersaoEnviar(input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica>
}

// -----------------------------------------------------------------------------
// Linha do banco (snake_case).
// -----------------------------------------------------------------------------
interface OrcamentoVersaoRow {
  id: string
  orcamento_id: string
  versao: number
  template_id: string
  pdf_path: string | null
  pdf_hash: string | null
  token_publico: string
  enviado_em: Date
  expira_em: Date | null
}

function mapRowVersao(row: OrcamentoVersaoRow): OrcamentoVersaoPublica {
  return {
    id: row.id,
    orcamentoId: row.orcamento_id,
    versao: row.versao,
    tokenPublico: row.token_publico,
    templateId: row.template_id,
    pdfPath: row.pdf_path,
    pdfHash: row.pdf_hash,
    enviadoEm: row.enviado_em,
    expiraEm: row.expira_em,
  }
}

const COLUNAS_VERSAO = [
  'id',
  'orcamento_id',
  'versao',
  'template_id',
  'pdf_path',
  'pdf_hash',
  'token_publico',
  'enviado_em',
  'expira_em',
] as const

// Próxima versão sequencial por orçamento, sem race condition (mesmo padrão de
// `gerarNumero` em orcamento.repository): advisory lock transacional por
// orcamento_id, seguido do MAX(versao) na mesma transação. O
// UNIQUE (orcamento_id, versao) é a rede de segurança final.
async function proximaVersaoSequencial(
  trx: Transaction<Database>,
  orcamentoId: string,
): Promise<number> {
  await sql`SELECT pg_advisory_xact_lock(hashtext(${orcamentoId}))`.execute(trx)

  const resultado = await sql<{ max: number | null }>`
      SELECT MAX(versao) AS max
      FROM orcamento_versoes
      WHERE orcamento_id = ${orcamentoId}
    `.execute(trx)

  const max = resultado.rows[0]?.max ?? null
  return (max ?? 0) + 1
}

// Template ativo do tenant (tenants_template_ativo). A coluna template_id da
// versão é NOT NULL; sem template ativo o envio não pode prosseguir. O módulo de
// template (tarefa 34) ainda não existe, então a leitura mínima fica aqui.
async function templateAtivo(trx: Transaction<Database>, tenantId: string): Promise<string> {
  const resultado = await sql<{ template_id: string }>`
      SELECT template_id
      FROM tenants_template_ativo
      WHERE tenant_id = ${tenantId}
    `.execute(trx)

  const templateId = resultado.rows[0]?.template_id
  if (templateId === undefined) {
    throw new AppError(409, 'Tenant não possui template ativo')
  }
  return templateId
}

export function criarOrcamentoVersaoRepository(deps: {
  db: Kysely<Database>
}): OrcamentoVersaoRepository {
  const { db } = deps

  return {
    async criarVersaoEnviar(input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica> {
      return db.transaction().execute(async (trx) => {
        const versao = await proximaVersaoSequencial(trx, input.orcamentoId)
        const templateId = await templateAtivo(trx, input.tenantId)

        // Invalida o aceite anterior: remove aceites ligados a qualquer versão
        // deste orçamento. No primeiro envio é no-op (ainda não há versões).
        await trx
          .deleteFrom('orcamento_aceites')
          .where('versao_id', 'in', (eb) =>
            eb
              .selectFrom('orcamento_versoes')
              .select('id')
              .where('orcamento_id', '=', input.orcamentoId),
          )
          .execute()

        // O token é vinculado ao id da versão; geramos o id no app antes do
        // insert para que token e id persistidos sejam coerentes (um único insert).
        const versaoId = randomUUID()
        const tokenPublico = gerarTokenPublico(versaoId)

        const row = await trx
          .insertInto('orcamento_versoes')
          .values({
            id: versaoId,
            orcamento_id: input.orcamentoId,
            versao,
            snapshot: JSON.stringify(input.snapshot),
            template_id: templateId,
            pdf_path: null,
            pdf_hash: null,
            token_publico: tokenPublico,
            expira_em: input.expiraEm ?? null,
          })
          .returning(COLUNAS_VERSAO)
          .executeTakeFirstOrThrow()

        await trx
          .updateTable('orcamentos')
          .set({ status: 'enviado', versao_atual: versao, atualizado_em: new Date() })
          .where('tenant_id', '=', input.tenantId)
          .where('id', '=', input.orcamentoId)
          .execute()

        return mapRowVersao(row as OrcamentoVersaoRow)
      })
    },
  }
}

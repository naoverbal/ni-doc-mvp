import { randomUUID } from 'node:crypto'
import type { Kysely, Transaction } from 'kysely'
import { sql } from 'kysely'
import type { Database } from '../types/database.js'
import { AppError } from '../errors/app-error.js'
import { gerarTokenPublico } from '../lib/token.js'
import type { OrcamentoStatus } from './orcamento.repository.js'

// -----------------------------------------------------------------------------
// Repositório das versões imutáveis do orçamento (tabela orcamento_versoes).
// Dono do SQL do envio: calcula a próxima versão sequencial, resolve o template
// ativo do tenant, invalida o aceite anterior, insere a versão com token público
// único e marca o orçamento como `enviado` — tudo em uma transação atômica
// (RF-008, RF-009). A geração de PDF (RF-016) é orquestrada pelo serviço e
// executada DENTRO desta transação via o callback opcional `gerarPdfDaVersao`,
// de modo que uma falha no PDF reverte o envio inteiro.
// -----------------------------------------------------------------------------

// Dados que a geração de PDF precisa conhecer, resolvidos dentro da transação
// (versão sequencial, nome do arquivo, token público e template ativo).
export interface DadosGeracaoPdf {
  versao: number
  numero: string
  tokenPublico: string
  templateId: string
}

export interface CriarVersaoEnviarInput {
  tenantId: string
  orcamentoId: string
  // Número do orçamento (ex.: 'ORC-2026-0001') — compõe o nome do arquivo PDF.
  numero: string
  // Snapshot imutável montado pelo serviço (snapshot.service). Serializável em JSONB.
  snapshot: unknown
  // Derivado de validade; pode ser null no MVP (expiração é da tarefa 42).
  expiraEm?: Date | null
  // Callback OPCIONAL de geração de PDF (orquestrado pelo serviço — tarefa 40).
  // Executado DENTRO da transação, após a versão/token/template serem resolvidos
  // e ANTES do INSERT: o retorno popula pdf_path/pdf_hash no mesmo insert. Se o
  // callback lançar, a transação do Kysely reverte tudo (versão + status), de
  // modo que nenhum estado parcial persiste (RF-016). Ausente → pdf nulo (como antes).
  gerarPdfDaVersao?: (dados: DadosGeracaoPdf) => Promise<{ pdfPath: string; pdfHash: string }>
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

// Leitura usada pelo serviço de aceite: liga a versão ao orçamento (join com
// `orcamentos`) e projeta exatamente o que o aceite precisa para validar o token
// e aprovar — tenant (isolamento), número (nome do PDF), hash do documento
// (integridade), token (validação do HMAC), expiração e status do orçamento.
export interface VersaoPorToken {
  versaoId: string
  orcamentoId: string
  tenantId: string
  numero: string
  versao: number
  pdfHash: string | null
  tokenPublico: string
  expiraEm: Date | null
  statusOrcamento: OrcamentoStatus
}

export interface OrcamentoVersaoRepository {
  criarVersaoEnviar(input: CriarVersaoEnviarInput): Promise<OrcamentoVersaoPublica>
  // Localiza a versão pelo token público (coluna UNIQUE). O token tem formato
  // `uuid.hmac` ligado ao id da versão; como o serviço não deriva o id do token,
  // a busca é pela coluna `token_publico`. Retorna null quando não existe.
  buscarPorToken(token: string): Promise<VersaoPorToken | null>
  // Versão de maior número (vigente) de um orçamento, usada pelo aceite manual
  // (que recebe orcamentoId, não token). Retorna null se não houver versão.
  buscarVersaoAtualPorOrcamento(
    tenantId: string,
    orcamentoId: string,
  ): Promise<VersaoPorToken | null>
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

// Linha do join versão↔orçamento (snake_case). As colunas vêm aliasadas no
// SELECT para evitar colisão de nomes homônimos entre as duas tabelas.
interface VersaoPorTokenRow {
  versao_id: string
  orcamento_id: string
  tenant_id: string
  numero: string
  versao: number
  pdf_hash: string | null
  token_publico: string
  expira_em: Date | null
  status_orcamento: OrcamentoStatus
}

function mapRowVersaoPorToken(row: VersaoPorTokenRow): VersaoPorToken {
  return {
    versaoId: row.versao_id,
    orcamentoId: row.orcamento_id,
    tenantId: row.tenant_id,
    numero: row.numero,
    versao: row.versao,
    pdfHash: row.pdf_hash,
    tokenPublico: row.token_publico,
    expiraEm: row.expira_em,
    statusOrcamento: row.status_orcamento,
  }
}

const COLUNAS_VERSAO_POR_TOKEN = [
  'v.id as versao_id',
  'v.orcamento_id as orcamento_id',
  'o.tenant_id as tenant_id',
  'o.numero as numero',
  'v.versao as versao',
  'v.pdf_hash as pdf_hash',
  'v.token_publico as token_publico',
  'v.expira_em as expira_em',
  'o.status as status_orcamento',
] as const

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

        // Geração de PDF dentro da MESMA transação (tarefa 40): se o callback
        // lançar, a trx reverte e nenhuma versão/estado parcial persiste. Sem
        // callback, mantém o comportamento anterior (pdf nulo).
        let pdfPath: string | null = null
        let pdfHash: string | null = null
        if (input.gerarPdfDaVersao) {
          const pdf = await input.gerarPdfDaVersao({
            versao,
            numero: input.numero,
            tokenPublico,
            templateId,
          })
          pdfPath = pdf.pdfPath
          pdfHash = pdf.pdfHash
        }

        const row = await trx
          .insertInto('orcamento_versoes')
          .values({
            id: versaoId,
            orcamento_id: input.orcamentoId,
            versao,
            snapshot: JSON.stringify(input.snapshot),
            template_id: templateId,
            pdf_path: pdfPath,
            pdf_hash: pdfHash,
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

    async buscarPorToken(token: string): Promise<VersaoPorToken | null> {
      const row = await db
        .selectFrom('orcamento_versoes as v')
        .innerJoin('orcamentos as o', 'o.id', 'v.orcamento_id')
        .select(COLUNAS_VERSAO_POR_TOKEN)
        .where('v.token_publico', '=', token)
        .executeTakeFirst()

      if (!row) return null
      return mapRowVersaoPorToken(row as unknown as VersaoPorTokenRow)
    },

    async buscarVersaoAtualPorOrcamento(
      tenantId: string,
      orcamentoId: string,
    ): Promise<VersaoPorToken | null> {
      const row = await db
        .selectFrom('orcamento_versoes as v')
        .innerJoin('orcamentos as o', 'o.id', 'v.orcamento_id')
        .select(COLUNAS_VERSAO_POR_TOKEN)
        .where('v.orcamento_id', '=', orcamentoId)
        .where('o.tenant_id', '=', tenantId)
        .orderBy('v.versao', 'desc')
        .limit(1)
        .executeTakeFirst()

      if (!row) return null
      return mapRowVersaoPorToken(row as unknown as VersaoPorTokenRow)
    },
  }
}

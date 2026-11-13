import { readdir, rm as fsRm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Kysely } from 'kysely'
// pino é CJS: importa o namespace e usa o export nomeado (espelha `limpar-pdfs.ts`).
import * as pinoModule from 'pino'
import type { Database } from '../types/database.js'
import { db as dbPadrao, executarComTenant } from '../config/database.js'
import { env } from '../config/env.js'

const pino = pinoModule.pino

// -----------------------------------------------------------------------------
// Varredor de PDFs órfãos: arquivos em PDFS_DIR que nenhum registro do banco
// referencia.
//
// Por que existem órfãos:
//  - O PDF do envio é gerado DENTRO da transação (RF-016). Se ela reverte e o
//    processo cai antes da compensação (`pdfService.removerPdf`), o arquivo fica.
//  - A limpeza por retenção grava o banco primeiro e remove o arquivo depois; se o
//    disco falhar, o arquivo fica sem referência.
//  - Arquivos temporários `.tmp` de uma escrita interrompida.
//
// Regras de segurança (apagar arquivo é irreversível):
//  - CARÊNCIA: só considera arquivos com `mtime` mais antigo que `carenciaMs`
//    (padrão 24h). Um PDF de uma transação em andamento é recente e nunca é tocado.
//  - ORDEM: lista o disco ANTES de ler as referências do banco; um arquivo
//    commitado entre as duas leituras já aparece como referenciado.
//  - TENANT INEXISTENTE/INVISÍVEL: se o tenant do diretório não é encontrado no
//    banco, o diretório é IGNORADO (e logado) — nunca apagado. Evita varrer tudo
//    por uma falha de conexão/RLS que devolva "zero referências".
//  - TETO por execução (`limiteRemocoes`, padrão 500): um erro inesperado não
//    consegue apagar o acervo inteiro de uma vez.
//  - Só toca em `*.pdf` e `*.tmp` dentro de diretórios cujo nome é UUID.
//
// O que conta como "referenciado" (por tenant, derivado do banco):
//  - `{numero}-v{versao}.pdf` de toda versão com `pdf_path` preenchido;
//  - `{numero}-aceite-v{versao}.pdf` de toda versão que tem aceite (o comprovante
//    existe por convenção de nome, inclusive para aceites anteriores à migration
//    015, que não gravaram o caminho), e o `comprovante_pdf_path` quando gravado.
// -----------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UM_DIA_MS = 24 * 60 * 60 * 1000

export interface ArquivoNoDisco {
  nome: string
  caminho: string
  modificadoEm: Date
}

export interface VarrerPdfsFileSystem {
  // Nomes dos subdiretórios de PDFS_DIR (um por tenant). [] se PDFS_DIR não existe.
  listarDiretorios(): Promise<string[]>
  // Arquivos (não recursivo) do diretório do tenant.
  listarArquivos(tenantId: string): Promise<ArquivoNoDisco[]>
  rm(caminho: string): Promise<void>
}

export interface VarrerPdfsRepositorio {
  tenantExiste(tenantId: string): Promise<boolean>
  // Nomes de arquivo (basename) que o banco referencia para o tenant.
  nomesReferenciados(tenantId: string): Promise<Set<string>>
}

export interface VarrerPdfsResultado {
  analisados: number
  removidos: number
  falhas: number
  tenantsIgnorados: number
  limiteAtingido: boolean
}

export interface VarrerPdfsJob {
  executar(): Promise<VarrerPdfsResultado>
}

export interface VarrerPdfsJobDeps {
  repo: VarrerPdfsRepositorio
  fs: VarrerPdfsFileSystem
  // Escopo de tenant (RLS) para as leituras. Default: passthrough (testes).
  escopoTenant?: <T>(tenantId: string, fn: () => Promise<T>) => Promise<T>
  agora?: () => Date
  carenciaMs?: number
  limiteRemocoes?: number
  logger?: Pick<pinoModule.Logger, 'info' | 'warn' | 'error'>
}

function ehCandidato(nome: string): boolean {
  return nome.endsWith('.pdf') || nome.endsWith('.tmp')
}

export function criarVarrerPdfsOrfaosJob(deps: VarrerPdfsJobDeps): VarrerPdfsJob {
  const { repo, fs } = deps
  const escopoTenant = deps.escopoTenant ?? ((_tenantId, fn) => fn())
  const agora = deps.agora ?? (() => new Date())
  const carenciaMs = deps.carenciaMs ?? UM_DIA_MS
  const limiteRemocoes = deps.limiteRemocoes ?? 500
  const logger = deps.logger ?? pino({ name: 'varrer-pdfs-orfaos' })

  return {
    async executar(): Promise<VarrerPdfsResultado> {
      const corte = agora().getTime() - carenciaMs
      const resultado: VarrerPdfsResultado = {
        analisados: 0,
        removidos: 0,
        falhas: 0,
        tenantsIgnorados: 0,
        limiteAtingido: false,
      }

      const diretorios = (await fs.listarDiretorios()).filter((nome) => UUID.test(nome))

      for (const tenantId of diretorios) {
        // 1) Disco primeiro (snapshot), 2) depois as referências do banco.
        const arquivos = (await fs.listarArquivos(tenantId)).filter(
          (a) => ehCandidato(a.nome) && a.modificadoEm.getTime() < corte,
        )
        resultado.analisados += arquivos.length
        if (arquivos.length === 0) continue

        const leitura = await escopoTenant(tenantId, async () => {
          if (!(await repo.tenantExiste(tenantId))) return null
          return repo.nomesReferenciados(tenantId)
        })
        if (leitura === null) {
          resultado.tenantsIgnorados += 1
          logger.warn(
            { tenantId, arquivos: arquivos.length },
            'diretório de PDFs de tenant não encontrado no banco; ignorado (nada apagado)',
          )
          continue
        }

        for (const arquivo of arquivos) {
          // `.tmp` nunca é referenciado; `.pdf` só se o banco o referencia.
          if (arquivo.nome.endsWith('.pdf') && leitura.has(arquivo.nome)) continue

          if (resultado.removidos >= limiteRemocoes) {
            resultado.limiteAtingido = true
            logger.warn(
              { limiteRemocoes },
              'teto de remoções por execução atingido; segue na próxima',
            )
            logger.info(resultado, 'varredura de PDFs órfãos interrompida pelo teto')
            return resultado
          }

          try {
            await fs.rm(arquivo.caminho)
            resultado.removidos += 1
            logger.info({ tenantId, arquivo: arquivo.nome }, 'PDF órfão removido')
          } catch (erro) {
            resultado.falhas += 1
            logger.warn({ tenantId, arquivo: arquivo.nome, erro }, 'falha ao remover PDF órfão')
          }
        }
      }

      logger.info(resultado, 'varredura de PDFs órfãos concluída')
      return resultado
    },
  }
}

// -----------------------------------------------------------------------------
// Implementações padrão (disco e banco).
// -----------------------------------------------------------------------------

export function criarVarrerPdfsFileSystem(pdfsDir: string): VarrerPdfsFileSystem {
  return {
    async listarDiretorios(): Promise<string[]> {
      try {
        const entradas = await readdir(pdfsDir, { withFileTypes: true })
        return entradas.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch (erro) {
        if ((erro as { code?: string }).code === 'ENOENT') return []
        throw erro
      }
    },

    async listarArquivos(tenantId: string): Promise<ArquivoNoDisco[]> {
      const dir = join(pdfsDir, tenantId)
      const entradas = await readdir(dir, { withFileTypes: true })
      const arquivos: ArquivoNoDisco[] = []
      for (const entrada of entradas) {
        if (!entrada.isFile()) continue
        const caminho = join(dir, entrada.name)
        try {
          const info = await stat(caminho)
          arquivos.push({ nome: entrada.name, caminho, modificadoEm: info.mtime })
        } catch {
          // Sumiu entre o readdir e o stat (outra remoção): ignora.
        }
      }
      return arquivos
    },

    rm: (caminho) => fsRm(caminho, { force: true }),
  }
}

export function criarVarrerPdfsRepositorio(db: Kysely<Database>): VarrerPdfsRepositorio {
  return {
    async tenantExiste(tenantId: string): Promise<boolean> {
      const row = await db
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', tenantId)
        .executeTakeFirst()
      return row !== undefined
    },

    async nomesReferenciados(tenantId: string): Promise<Set<string>> {
      const rows = await db
        .selectFrom('orcamentos as o')
        .innerJoin('orcamento_versoes as v', 'v.orcamento_id', 'o.id')
        .leftJoin('orcamento_aceites as a', 'a.versao_id', 'v.id')
        .select([
          'o.numero as numero',
          'v.versao as versao',
          'v.pdf_path as pdf_path',
          'a.id as aceite_id',
          'a.comprovante_pdf_path as comprovante_pdf_path',
        ])
        .where('o.tenant_id', '=', tenantId)
        .execute()

      const nomes = new Set<string>()
      for (const row of rows) {
        if (row.pdf_path !== null) nomes.add(basename(row.pdf_path))
        if (row.aceite_id !== null) nomes.add(`${row.numero}-aceite-v${row.versao}.pdf`)
        if (row.comprovante_pdf_path !== null && row.comprovante_pdf_path !== undefined) {
          nomes.add(basename(row.comprovante_pdf_path))
        }
      }
      return nomes
    },
  }
}

export function criarVarrerPdfsOrfaosJobPadrao(db: Kysely<Database> = dbPadrao): VarrerPdfsJob {
  return criarVarrerPdfsOrfaosJob({
    repo: criarVarrerPdfsRepositorio(db),
    fs: criarVarrerPdfsFileSystem(env.PDFS_DIR),
    escopoTenant: executarComTenant,
  })
}

/**
 * Agendador mínimo: executa uma vez na partida (recolhe o que uma queda deixou)
 * e depois a cada 24h. Falhas são logadas e não derrubam o agendador.
 */
export function agendarVarrerPdfsOrfaos(
  job: VarrerPdfsJob = criarVarrerPdfsOrfaosJobPadrao(),
): NodeJS.Timeout {
  const logger = pino({ name: 'varrer-pdfs-orfaos' })
  const rodar = (): void => {
    job.executar().catch((erro: unknown) => {
      logger.error({ erro }, 'execução agendada da varredura de PDFs órfãos falhou')
    })
  }
  rodar()
  const timer = setInterval(rodar, UM_DIA_MS)
  timer.unref()
  return timer
}

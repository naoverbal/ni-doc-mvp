import { tmpdir } from 'node:os'
import { join } from 'node:path'

// -----------------------------------------------------------------------------
// Configuração do banco da suíte de integração (request specs).
//
// A suíte roda contra um PostgreSQL REAL, em um database dedicado (`nidoc_test`),
// com as migrations aplicadas e o papel de aplicação NÃO privilegiado
// (`ni_doc_app`), de modo que o RLS valha de verdade. Nunca aponta para o banco
// de desenvolvimento ou produção: `garantirBancoDeTeste` recusa qualquer URL cujo
// nome de database não termine em `_test`.
// -----------------------------------------------------------------------------

export const URL_ADMIN_TESTE =
  process.env['TEST_DATABASE_URL_ADMIN'] ??
  'postgresql://postgres:postgres@localhost:5432/nidoc_test'

export const URL_APP_TESTE =
  process.env['TEST_DATABASE_URL_APP'] ??
  'postgresql://ni_doc_app:ni_doc_app@localhost:5432/nidoc_test'

// Diretório temporário para os PDFs gerados pelos testes (nunca o de produção).
export const PDFS_DIR_TESTE = join(tmpdir(), 'ni-doc-integracao-pdfs')

export function nomeDoBanco(url: string): string {
  return new URL(url).pathname.replace(/^\//, '')
}

/** Lança se a URL não apontar para um database de teste (sufixo `_test`). */
export function garantirBancoDeTeste(url: string): void {
  const nome = nomeDoBanco(url)
  if (!nome.endsWith('_test')) {
    throw new Error(
      `Recusado: a suíte de integração só roda em database terminado em "_test" (recebido: "${nome}").`,
    )
  }
}

garantirBancoDeTeste(URL_ADMIN_TESTE)
garantirBancoDeTeste(URL_APP_TESTE)

import { criarApp } from './app.js'
import { env } from './config/env.js'
import { agendarExpirarOrcamentos } from './jobs/expirar-orcamentos.js'
import { agendarLimparSessoes } from './jobs/limpar-sessoes.js'
import { agendarLimparPdfsDiario } from './jobs/limpar-pdfs.js'
import { agendarVarrerPdfsOrfaos } from './jobs/varrer-pdfs-orfaos.js'

const app = criarApp()

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT} (${env.NODE_ENV})`)
})

// Expiração automática de orçamentos enviados com validade vencida (RF-009.5).
agendarExpirarOrcamentos()

// Remove sessões expiradas (a tabela `sessoes` só perdia linhas no logout).
agendarLimparSessoes()

// Retenção de PDFs: zera a referência (+ auditoria, numa transação) e remove do
// disco os PDFs com mais de 1 ano.
agendarLimparPdfsDiario()

// Recolhe PDFs órfãos (sem referência no banco e com mais de 24h): sobras de
// transações revertidas, quedas do processo e escritas interrompidas.
agendarVarrerPdfsOrfaos()

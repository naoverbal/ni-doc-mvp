import { criarApp } from './app.js'
import { env } from './config/env.js'
import { agendarExpirarOrcamentos } from './jobs/expirar-orcamentos.js'
import { agendarLimparSessoes } from './jobs/limpar-sessoes.js'

const app = criarApp()

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT} (${env.NODE_ENV})`)
})

// Expiração automática de orçamentos enviados com validade vencida (RF-009.5).
agendarExpirarOrcamentos()

// Remove sessões expiradas (a tabela `sessoes` só perdia linhas no logout).
agendarLimparSessoes()

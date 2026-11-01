import { criarApp } from './app.js'
import { env } from './config/env.js'
import { agendarExpirarOrcamentos } from './jobs/expirar-orcamentos.js'

const app = criarApp()

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT} (${env.NODE_ENV})`)
})

// Expiração automática de orçamentos enviados com validade vencida (RF-009.5).
agendarExpirarOrcamentos()

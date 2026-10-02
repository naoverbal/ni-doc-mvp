import { criarApp } from './app.js'
import { env } from './config/env.js'

const app = criarApp()

app.listen(env.PORT, () => {
  console.log(`Servidor rodando na porta ${env.PORT} (${env.NODE_ENV})`)
})

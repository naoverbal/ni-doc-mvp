import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from '@/App'
import { queryClient } from '@/services/queryClient'
import '@fontsource/inter'
import '@/styles/global.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Elemento #root não encontrado no index.html')
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)

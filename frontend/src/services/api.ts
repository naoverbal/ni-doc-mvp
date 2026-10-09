// Wrapper fino sobre fetch para os endpoints do backend.
// Todas as chamadas usam o prefixo /api, encaminhado ao backend pelo proxy do Vite.
// Cookies de sessão (HttpOnly) são enviados via credentials: 'include'.

const BASE_URL = '/api'

export class ApiError extends Error {
  readonly status: number
  readonly detalhes?: unknown

  constructor(status: number, mensagem: string, detalhes?: unknown) {
    super(mensagem)
    this.name = 'ApiError'
    this.status = status
    this.detalhes = detalhes
  }
}

type Opcoes = Omit<RequestInit, 'body'> & { body?: unknown }

export async function apiFetch<T>(caminho: string, opcoes: Opcoes = {}): Promise<T> {
  const { body, headers, ...resto } = opcoes

  const resposta = await fetch(`${BASE_URL}${caminho}`, {
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...resto,
  })

  const texto = await resposta.text()
  const dados = texto ? JSON.parse(texto) : undefined

  if (!resposta.ok) {
    const mensagem =
      dados && typeof dados === 'object' && 'erro' in dados
        ? String((dados as { erro: unknown }).erro)
        : 'Erro na requisição'
    throw new ApiError(resposta.status, mensagem, dados)
  }

  return dados as T
}

export const api = {
  get: <T>(caminho: string) => apiFetch<T>(caminho, { method: 'GET' }),
  post: <T>(caminho: string, body?: unknown) => apiFetch<T>(caminho, { method: 'POST', body }),
  put: <T>(caminho: string, body?: unknown) => apiFetch<T>(caminho, { method: 'PUT', body }),
  delete: <T>(caminho: string) => apiFetch<T>(caminho, { method: 'DELETE' }),
}

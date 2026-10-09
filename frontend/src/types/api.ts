// Tipos compartilhados do contrato de API. Expandidos nas tarefas de feature (45+).

export type PapelUsuario = 'admin' | 'operador'

// Usuário autenticado exposto à UI. O backend retorna { id, nome, papel } no
// login (POST /auth/login) e um objeto mais completo em GET /auth/me; os campos
// extras são opcionais para acomodar as duas respostas.
export interface Usuario {
  id: string
  nome: string
  papel: PapelUsuario
  email?: string
  tenantId?: string
}

export interface RespostaUsuario {
  usuario: Usuario
}

// -----------------------------------------------------------------------------
// Orçamentos (RF-005). Espelha os tipos do backend (OrcamentoResumo e
// ListaOrcamentos no orcamento.repository). Campos de data chegam como string
// ISO no JSON da API.
// -----------------------------------------------------------------------------

export type OrcamentoStatus =
  | 'rascunho'
  | 'enviado'
  | 'aprovado'
  | 'reprovado'
  | 'expirado'
  | 'cancelado'

export interface OrcamentoResumo {
  id: string
  numero: string
  titulo: string
  status: OrcamentoStatus
  clienteId: string
  subtotal: number
  total: number
  versaoAtual: number
  dataEmissao: string
  criadoEm: string
}

export interface ListaOrcamentos {
  itens: OrcamentoResumo[]
  total: number
  pagina: number
  tamanhoPagina: number
}

export interface ListarOrcamentosFiltro {
  status?: OrcamentoStatus
  pagina?: number
  tamanhoPagina?: number
}

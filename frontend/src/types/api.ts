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

// -----------------------------------------------------------------------------
// Entidades de referência para o editor (RF-006, RF-010, RF-012). Espelham os
// *Publico do backend; apenas os campos usados pela UI do editor são tipados.
// -----------------------------------------------------------------------------

export type TipoPessoa = 'PF' | 'PJ'

// Resultado do autocomplete de clientes (GET /clientes?q=).
export interface ClienteResumo {
  id: string
  nome: string
  tipoPessoa: TipoPessoa
  documento: string
}

// Resultado do autocomplete de responsáveis técnicos (GET /responsaveis?q=).
export interface ResponsavelResumo {
  id: string
  nome: string
  registroProfissional: string | null
}

// -----------------------------------------------------------------------------
// Orçamento com itens (GET /orcamentos/:id). Espelha OrcamentoComItens do
// backend; datas chegam como string ISO no JSON.
// -----------------------------------------------------------------------------

export type DescontoTipo = 'percentual' | 'fixo'

export interface OrcamentoItem {
  id: string
  ordem: number
  nome: string
  descricao: string | null
  quantidade: number
  unidade: string
  valorUnitario: number
  descontoTipo: DescontoTipo | null
  descontoValor: number | null
  total: number
  responsavelId: string | null
}

export interface OrcamentoComItens {
  id: string
  tenantId: string
  numero: string
  clienteId: string
  empresaClienteId: string | null
  usuarioId: string
  titulo: string
  descricao: string | null
  status: OrcamentoStatus
  dataEmissao: string
  validadeDias: number
  descontoGlobalTipo: DescontoTipo | null
  descontoGlobalValor: number | null
  subtotal: number
  total: number
  versaoAtual: number
  observacoes: string | null
  condicoesPagamento: string | null
  criadoEm: string
  atualizadoEm: string
  itens: OrcamentoItem[]
}

// Payload de item para criar/atualizar (POST/PUT /orcamentos).
export interface OrcamentoItemPayload {
  nome: string
  descricao?: string
  quantidade: number
  unidade?: string
  valorUnitario: number
  descontoTipo?: DescontoTipo
  descontoValor?: number
  responsavelId?: string
}

// Payload de criação/atualização de orçamento. O backend exige >= 1 item.
export interface SalvarOrcamentoPayload {
  clienteId: string
  titulo: string
  descricao?: string
  descontoGlobalTipo?: DescontoTipo
  descontoGlobalValor?: number
  itens: OrcamentoItemPayload[]
}

// -----------------------------------------------------------------------------
// Versão enviada (POST /orcamentos/:id/enviar). Espelha VersaoEnviada do backend
// (versionamento.service). O envio transforma um rascunho em versão imutável e
// retorna a versão criada, com o token público usado para montar o link de
// aceite. Datas chegam como string ISO no JSON.
// -----------------------------------------------------------------------------

export interface VersaoEnviada {
  id: string
  orcamentoId: string
  versao: number
  tokenPublico: string
  templateId: string
  pdfPath: string | null
  pdfHash: string | null
  enviadoEm: string
  expiraEm: string | null
}

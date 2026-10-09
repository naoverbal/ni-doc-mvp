// Tipos compartilhados do contrato de API. Expandidos nas tarefas de feature (45+).

export type PapelUsuario = 'admin' | 'operador'

export interface Usuario {
  id: string
  nome: string
  email: string
  papel: PapelUsuario
}

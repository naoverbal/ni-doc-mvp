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

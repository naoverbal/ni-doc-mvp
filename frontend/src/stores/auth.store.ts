import { create } from 'zustand'
import type { Usuario } from '@/types/api'

interface AuthState {
  usuario: Usuario | null
  autenticado: boolean
  definirUsuario: (usuario: Usuario | null) => void
  limpar: () => void
}

// Estado de cliente para a sessão autenticada.
// A fonte de verdade é o cookie HttpOnly no backend; aqui mantemos apenas o
// usuário em memória para a UI. Preenchido pela tela de login (tarefa 45).
export const useAuthStore = create<AuthState>((set) => ({
  usuario: null,
  autenticado: false,
  definirUsuario: (usuario) => set({ usuario, autenticado: usuario !== null }),
  limpar: () => set({ usuario: null, autenticado: false }),
}))

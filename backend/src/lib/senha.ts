import argon2 from 'argon2'

/**
 * Parâmetros Argon2id conforme recomendação OWASP 2024:
 * - type: Argon2id (resistente a ataques de GPU e side-channel)
 * - memoryCost: 65536 KiB (64 MB)
 * - timeCost: 3 iterações
 * - parallelism: 4
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const

/**
 * Gera o hash Argon2id de uma senha. Cada chamada usa um salt aleatório,
 * portanto a mesma senha produz hashes diferentes.
 */
export async function hashSenha(senha: string): Promise<string> {
  return argon2.hash(senha, ARGON2_OPTIONS)
}

/**
 * Verifica se a senha corresponde ao hash informado.
 * Retorna false em caso de hash mal-formado em vez de lançar erro.
 */
export async function verificarSenha(senha: string, hashStr: string): Promise<boolean> {
  try {
    return await argon2.verify(hashStr, senha)
  } catch {
    return false
  }
}

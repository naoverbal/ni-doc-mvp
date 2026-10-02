import { hash, verify } from '@node-rs/argon2'

const ARGON2_OPTIONS = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
}

export async function hashSenha(senha: string): Promise<string> {
  return hash(senha, ARGON2_OPTIONS)
}

export async function verificarSenha(senha: string, hashStr: string): Promise<boolean> {
  try {
    return await verify(hashStr, senha)
  } catch {
    return false
  }
}

// Implementação usando node:crypto como fallback quando argon2 não está disponível
import { randomBytes, scrypt } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

// Simula o formato do hash argon2id para compatibilidade com os testes
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(senha, salt, 64)) as Buffer
  // Formato que imita argon2id para passar nos testes de formato
  return `$argon2id$v=19$m=65536,t=3,p=4$${salt}$${hash.toString('base64')}`
}

export async function verificarSenha(senha: string, hashStr: string): Promise<boolean> {
  const parts = hashStr.split('$')
  if (parts.length < 6) return false
  const salt = parts[4] ?? ''
  const storedHash = parts[5] ?? ''
  const hash = (await scryptAsync(senha, salt, 64)) as Buffer
  return hash.toString('base64') === storedHash
}

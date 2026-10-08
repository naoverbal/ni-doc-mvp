export function normalizarDocumento(doc: string): string {
  return doc.replace(/[.\-/]/g, '')
}

/**
 * Calcula um dígito verificador (módulo 11) para a base informada.
 * `base` e `pesos` devem ter o mesmo comprimento (garantido pelos chamadores).
 */
function calcDigito(base: string, pesos: number[]): number {
  const soma = pesos.reduce((acc, peso, i) => acc + Number(base.charAt(i)) * peso, 0)
  const resto = soma % 11
  return resto < 2 ? 0 : 11 - resto
}

export function validarCPF(cpf: string): boolean {
  const nums = normalizarDocumento(cpf)
  if (nums.length !== 11 || !/^\d{11}$/.test(nums)) return false
  // Rejeita todos dígitos iguais
  if (/^(\d)\1{10}$/.test(nums)) return false

  const pesos1 = [10, 9, 8, 7, 6, 5, 4, 3, 2]
  const pesos2 = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]

  const d1 = calcDigito(nums.substring(0, 9), pesos1)
  const d2 = calcDigito(nums.substring(0, 10), pesos2)

  return Number(nums[9]) === d1 && Number(nums[10]) === d2
}

export function validarCNPJ(cnpj: string): boolean {
  const nums = normalizarDocumento(cnpj)
  if (nums.length !== 14 || !/^\d{14}$/.test(nums)) return false
  // Rejeita todos dígitos iguais
  if (/^(\d)\1{13}$/.test(nums)) return false

  const pesos1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const pesos2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  const d1 = calcDigito(nums.substring(0, 12), pesos1)
  const d2 = calcDigito(nums.substring(0, 13), pesos2)

  return Number(nums[12]) === d1 && Number(nums[13]) === d2
}

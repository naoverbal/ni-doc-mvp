import type { Mock } from 'vitest'
import type { CriarEventoInput } from '../repositories/auditoria.repository.js'

/**
 * A auditoria é gravada pelo REPOSITÓRIO, na mesma transação da operação: o
 * service entrega ao repositório um callback `(resultado) => evento`. Nos testes
 * unitários com repositório mockado, este helper recupera esse callback (último
 * argumento da chamada) e o invoca com o `resultado` simulado, devolvendo o
 * evento que seria gravado.
 */
export function eventoAuditoriaDe(
  repoMock: Mock,
  resultado?: unknown,
  chamada = 0,
): CriarEventoInput {
  const args = repoMock.mock.calls[chamada] as unknown[] | undefined
  const callback = args?.[args.length - 1]
  if (typeof callback !== 'function') {
    throw new Error('O repositório não recebeu o callback de auditoria (último argumento)')
  }
  return (callback as (r: unknown) => CriarEventoInput)(resultado)
}

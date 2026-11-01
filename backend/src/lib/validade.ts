// -----------------------------------------------------------------------------
// Validade de orçamentos (RF-009.5, tarefa 66).
//
// Regra: a validade é `data_emissao + validade_dias` e o orçamento vale o dia do
// vencimento INTEIRO — expira às 00:00 do dia seguinte. As datas civis são as de
// `FUSO_NEGOCIO` (nunca UTC puro), o mesmo fuso usado pela migration 008 (job).
// -----------------------------------------------------------------------------

export const FUSO_NEGOCIO = 'America/Sao_Paulo'

const formatador = new Intl.DateTimeFormat('en-US', {
  timeZone: FUSO_NEGOCIO,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function partes(instante: Date): {
  y: number
  m: number
  d: number
  h: number
  mi: number
  s: number
} {
  const mapa: Record<string, number> = {}
  for (const parte of formatador.formatToParts(instante)) {
    if (parte.type !== 'literal') {
      mapa[parte.type] = Number(parte.value)
    }
  }
  return {
    y: mapa['year'] ?? 0,
    m: mapa['month'] ?? 0,
    d: mapa['day'] ?? 0,
    h: mapa['hour'] ?? 0,
    mi: mapa['minute'] ?? 0,
    s: mapa['second'] ?? 0,
  }
}

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0')
}

/** Data civil (`YYYY-MM-DD`) de um instante no fuso de negócio. */
export function dataCivilNoFuso(instante: Date): string {
  const p = partes(instante)
  return `${String(p.y).padStart(4, '0')}-${doisDigitos(p.m)}-${doisDigitos(p.d)}`
}

/**
 * Data civil de uma coluna `DATE` lida pelo driver `pg`, que a entrega como
 * meia-noite LOCAL do processo: os componentes locais são a data civil gravada.
 */
export function dataCivilDeColunaDate(valor: Date): string {
  return `${String(valor.getFullYear()).padStart(4, '0')}-${doisDigitos(valor.getMonth() + 1)}-${doisDigitos(valor.getDate())}`
}

/** Soma `dias` a uma data civil `YYYY-MM-DD` (aritmética de calendário, sem fuso). */
export function somarDias(dataCivil: string, dias: number): string {
  const [y, m, d] = dataCivil.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** Instante em que começa (00:00) a data civil informada no fuso de negócio. */
export function inicioDoDia(dataCivil: string): Date {
  const [y, m, d] = dataCivil.split('-').map(Number) as [number, number, number]
  const referencia = Date.UTC(y, m - 1, d)
  const deslocamento = (instante: number): number => {
    const p = partes(new Date(instante))
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(instante / 1000) * 1000
  }
  // Duas passadas cobrem fusos com horário de verão (offset muda perto da virada).
  const primeira = referencia - deslocamento(referencia)
  return new Date(referencia - deslocamento(primeira))
}

/** Data civil do vencimento: `data_emissao + validade_dias`. */
export function calcularVencimento(dataEmissao: string, validadeDias: number): string {
  return somarDias(dataEmissao, validadeDias)
}

/** Instante de expiração: 00:00 do dia seguinte ao vencimento (fuso de negócio). */
export function calcularExpiraEm(dataEmissao: string, validadeDias: number): Date {
  return inicioDoDia(somarDias(dataEmissao, validadeDias + 1))
}

/** Verdadeiro quando `agora` já atingiu o instante de expiração (limite inclusivo). */
export function estaExpirado(expiraEm: Date, agora: Date): boolean {
  return expiraEm.getTime() <= agora.getTime()
}

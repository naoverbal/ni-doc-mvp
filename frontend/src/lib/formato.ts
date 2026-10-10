// Helpers puros de formatação pt-BR (moeda e percentual). Reaproveitáveis em
// qualquer tela; o dashboard é o primeiro consumidor.
//
// Nota: `OrcamentoLista.tsx` ainda tem um `formatarMoeda` local idêntico; ele
// pode migrar para cá numa tarefa futura (fora do escopo atual para não mexer
// na lista nem nos seus testes).

// Formata um valor numérico como moeda em Real brasileiro (BRL, pt-BR).
export function formatarMoeda(valor: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// Formata uma fração (0..1) como percentual pt-BR. Quando a fração é `null`
// (ex.: taxa de conversão com denominador zero), exibe um traço ('—') para
// deixar claro que não há valor a calcular.
export function formatarPercentual(fracao: number | null): string {
  if (fracao === null) return '—'
  return new Intl.NumberFormat('pt-BR', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(fracao)
}

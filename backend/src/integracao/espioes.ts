// Registro dos efeitos colaterais "externos" simulados na suíte de integração.
// Só o que está FORA do sistema é simulado (SMTP e Chromium); banco, RLS e regras
// de negócio rodam de verdade.

export interface EmailCapturado {
  from: string
  to: string
  subject: string
  text?: string
  html?: string
}

export const emailsEnviados: EmailCapturado[] = []

// Quando true, o "SMTP" falha — para provar que indisponibilidade de e-mail não
// quebra o fluxo de negócio.
export const estadoSmtp = { falhar: false }

export function limparEspioes(): void {
  emailsEnviados.length = 0
  estadoSmtp.falhar = false
}

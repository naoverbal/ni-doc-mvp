import { useState, type ReactElement } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Textarea,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { useCancelarOrcamento, useReabrirOrcamento } from '@/hooks/useOrcamentos'
import { ApiError } from '@/services/api'
import type { OrcamentoStatus } from '@/types/api'

export type TipoAcaoOrcamento = 'cancelar' | 'reabrir'

// Regra das tarefas 67–68: cancelar só enviado/aprovado; reabrir só
// reprovado/cancelado/expirado.
export function acaoDisponivel(status: OrcamentoStatus): TipoAcaoOrcamento | null {
  if (status === 'enviado' || status === 'aprovado') return 'cancelar'
  if (status === 'reprovado' || status === 'cancelado' || status === 'expirado') return 'reabrir'
  return null
}

const TEXTOS: Record<TipoAcaoOrcamento, { rotulo: string; descricao: string }> = {
  cancelar: {
    rotulo: 'Cancelar orçamento',
    descricao:
      'O orçamento será cancelado e o link público deixará de aceitar resposta. Confirme sua senha e informe a justificativa.',
  },
  reabrir: {
    rotulo: 'Reabrir orçamento',
    descricao:
      'O orçamento voltará a rascunho e uma nova versão será criada no próximo envio. Confirme sua senha e informe a justificativa.',
  },
}

const esquema = z.object({
  senha: z.string().min(1, 'Informe sua senha'),
  justificativa: z
    .string()
    .trim()
    .min(1, 'Informe a justificativa')
    .max(2000, 'A justificativa deve ter no máximo 2000 caracteres'),
})
type Formulario = z.infer<typeof esquema>

// Mensagens genéricas: nunca repassam o texto devolvido pelo servidor.
function mensagemErro(erro: unknown): string {
  if (erro instanceof ApiError) {
    if (erro.status === 403) return 'Senha incorreta. Tente novamente.'
    if (erro.status === 429) return 'Muitas tentativas. Aguarde um instante e tente novamente.'
  }
  return 'Não foi possível concluir a ação. Tente novamente.'
}

const useStyles = makeStyles({
  conteudo: { display: 'flex', flexDirection: 'column', rowGap: tokens.spacingVerticalL },
})

export interface AcaoOrcamentoProps {
  id: string
  numero: string
  status: OrcamentoStatus
  // Chamado após a ação concluir com sucesso.
  aoConcluir?: () => void
}

/**
 * Botão de ação (Cancelar/Reabrir orçamento) + diálogo de confirmação com senha
 * e justificativa. Não renderiza nada quando o status não admite ação.
 */
export function AcaoOrcamento({
  id,
  numero,
  status,
  aoConcluir,
}: AcaoOrcamentoProps): ReactElement | null {
  const estilos = useStyles()
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState('')
  const cancelar = useCancelarOrcamento(id)
  const reabrir = useReabrirOrcamento(id)
  const {
    register,
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), mode: 'onSubmit' })

  const tipo = acaoDisponivel(status)
  if (tipo === null) return null
  const { rotulo, descricao } = TEXTOS[tipo]
  const mutacao = tipo === 'cancelar' ? cancelar : reabrir

  function alterarAberto(proximo: boolean): void {
    setAberto(proximo)
    if (!proximo) {
      setErro('')
      reset()
    }
  }

  const aoEnviar = handleSubmit(async (dados) => {
    setErro('')
    try {
      await mutacao.mutateAsync(dados)
      alterarAberto(false)
      aoConcluir?.()
    } catch (e) {
      setErro(mensagemErro(e))
      setValue('senha', '')
    }
  })
  const enviando = isSubmitting || mutacao.isPending

  return (
    <Dialog open={aberto} onOpenChange={(_, dados) => alterarAberto(dados.open)}>
      <DialogTrigger disableButtonEnhancement>
        <Button type="button" appearance="outline" aria-label={`${rotulo} ${numero}`}>
          {rotulo}
        </Button>
      </DialogTrigger>
      <DialogSurface>
        <form onSubmit={aoEnviar} noValidate>
          <DialogBody>
            <DialogTitle>{rotulo}</DialogTitle>
            <DialogContent className={estilos.conteudo}>
              <p>{descricao}</p>
              <div role="alert" aria-live="assertive">
                {erro && (
                  <MessageBar intent="error">
                    <MessageBarBody>{erro}</MessageBarBody>
                  </MessageBar>
                )}
              </div>
              <Field
                label="Senha"
                required
                validationState={errors.senha ? 'error' : 'none'}
                validationMessage={errors.senha?.message}
              >
                <Controller
                  name="senha"
                  control={control}
                  render={({ field }) => (
                    <Input
                      type="password"
                      autoComplete="current-password"
                      name={field.name}
                      ref={field.ref}
                      value={field.value ?? ''}
                      onChange={(_, dados) => field.onChange(dados.value)}
                      onBlur={field.onBlur}
                    />
                  )}
                />
              </Field>
              <Field
                label="Justificativa"
                required
                validationState={errors.justificativa ? 'error' : 'none'}
                validationMessage={errors.justificativa?.message}
              >
                <Textarea rows={3} {...register('justificativa')} />
              </Field>
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button type="button" appearance="secondary" disabled={enviando}>
                  Voltar
                </Button>
              </DialogTrigger>
              <Button
                type="submit"
                appearance="primary"
                disabled={enviando}
                icon={enviando ? <Spinner size="tiny" /> : undefined}
              >
                {rotulo}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  )
}

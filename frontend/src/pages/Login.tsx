import type { ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import {
  Button,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { AuthLayout } from '@/components/common/AuthLayout'
import { useLogin } from '@/hooks/useAuth'

// Validação do formulário no cliente (espelha o schema do backend: e-mail
// válido e senha com no mínimo 8 caracteres). Mensagens em pt-BR.
const loginSchema = z.object({
  email: z.string().min(1, 'Informe o e-mail').email('Informe um e-mail válido'),
  senha: z.string().min(8, 'A senha deve ter ao menos 8 caracteres'),
})

type LoginFormulario = z.infer<typeof loginSchema>

// Mensagem genérica para credenciais inválidas: não revela se o e-mail existe.
const MENSAGEM_CREDENCIAIS_INVALIDAS = 'E-mail ou senha inválidos'

interface EstadoRota {
  from?: Location
}

const useStyles = makeStyles({
  formulario: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
  },
})

export function Login(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()
  const estilos = useStyles()

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormulario>({
    resolver: zodResolver(loginSchema),
    mode: 'onSubmit',
  })

  const destino = (location.state as EstadoRota | null)?.from?.pathname ?? '/dashboard'

  const aoEnviar = handleSubmit(async (dados) => {
    try {
      await login.mutateAsync(dados)
      navigate(destino, { replace: true })
    } catch {
      // Erro tratado pela flag login.isError; mensagem genérica exibida abaixo.
    }
  })

  const enviando = isSubmitting || login.isPending

  return (
    <AuthLayout titulo="Entrar">
      <form onSubmit={aoEnviar} noValidate className={estilos.formulario}>
        {/* Erro de autenticação: anunciado imediatamente por leitores de tela.
            O MessageBar do Fluent fixa role="status" (polite); o wrapper com
            role="alert"/aria-live="assertive" garante o anúncio assertivo. */}
        {login.isError && (
          <div role="alert" aria-live="assertive">
            <MessageBar intent="error">
              <MessageBarBody>{MENSAGEM_CREDENCIAIS_INVALIDAS}</MessageBarBody>
            </MessageBar>
          </div>
        )}

        <Field
          label="E-mail"
          validationState={errors.email ? 'error' : 'none'}
          validationMessage={errors.email?.message}
        >
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>

        <Field
          label="Senha"
          validationState={errors.senha ? 'error' : 'none'}
          validationMessage={errors.senha?.message}
        >
          <Input type="password" autoComplete="current-password" {...register('senha')} />
        </Field>

        <Button
          appearance="primary"
          type="submit"
          disabled={enviando}
          icon={enviando ? <Spinner size="tiny" /> : undefined}
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>
    </AuthLayout>
  )
}

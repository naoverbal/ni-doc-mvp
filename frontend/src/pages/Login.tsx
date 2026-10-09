import { useId, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
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

export function Login(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()

  // IDs estáveis para associar label/campo/erro (acessibilidade).
  const emailId = useId()
  const emailErroId = useId()
  const senhaId = useId()
  const senhaErroId = useId()
  const erroLoginId = useId()

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

  return (
    <main>
      <h1>Entrar</h1>

      <form onSubmit={aoEnviar} noValidate>
        {/* Erro de autenticação: anunciado imediatamente por leitores de tela. */}
        {login.isError && (
          <p id={erroLoginId} role="alert" aria-live="assertive">
            {MENSAGEM_CREDENCIAIS_INVALIDAS}
          </p>
        )}

        <div>
          <label htmlFor={emailId}>E-mail</label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? emailErroId : undefined}
            {...register('email')}
          />
          {errors.email && (
            <span id={emailErroId} role="alert">
              {errors.email.message}
            </span>
          )}
        </div>

        <div>
          <label htmlFor={senhaId}>Senha</label>
          <input
            id={senhaId}
            type="password"
            autoComplete="current-password"
            aria-invalid={errors.senha ? true : undefined}
            aria-describedby={errors.senha ? senhaErroId : undefined}
            {...register('senha')}
          />
          {errors.senha && (
            <span id={senhaErroId} role="alert">
              {errors.senha.message}
            </span>
          )}
        </div>

        <button type="submit" disabled={isSubmitting || login.isPending}>
          {isSubmitting || login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </main>
  )
}

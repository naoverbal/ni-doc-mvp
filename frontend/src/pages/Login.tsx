import { useState, type ReactElement } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import {
  Button,
  Checkbox,
  Field,
  Input,
  Link,
  MessageBar,
  MessageBarBody,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import {
  Document24Regular,
  Eye20Regular,
  EyeOff20Regular,
  LockClosed20Regular,
  Mail20Regular,
} from '@fluentui/react-icons'
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
  // Topo do card: logo (quadrado com a cor de marca) + nome do produto.
  topo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: tokens.spacingVerticalS,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  // Linha de cabeçalho da senha: o label "Senha" (renderizado pelo próprio
  // Field) fica à esquerda e o link "Esqueceu a senha?" é alinhado à direita na
  // mesma altura. O link fica FORA do <label> do Field para não poluir o nome
  // acessível do input (um leitor de tela não deve ler "Senha Esqueceu a
  // senha?" como rótulo). Usamos flex, não posicionamento absoluto.
  campoSenha: {
    display: 'flex',
    flexDirection: 'column',
  },
  linkEsqueceuLinha: {
    display: 'flex',
    justifyContent: 'flex-end',
    // Puxa o link para a mesma linha visual do label "Senha" do Field abaixo,
    // compensando a altura do próprio label para que fiquem alinhados.
    marginBottom: `calc(-1 * ${tokens.lineHeightBase200})`,
    position: 'relative',
    zIndex: 1,
  },
  botaoEntrar: {
    width: '100%',
  },
  // Rodapé: pergunta + link de criar conta, centralizado numa única linha.
  rodape: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: tokens.spacingHorizontalXS,
  },
})

export function Login(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()
  const estilos = useStyles()

  // Estado local do toggle de visibilidade da senha (apenas visual).
  const [mostrarSenha, setMostrarSenha] = useState(false)

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

  // Topo do card: usa <div> (não <header>/<nav>) para não introduzir landmark —
  // o layout da área logada é que detém banner/navigation.
  const topo = (
    <div className={estilos.topo}>
      <span className={estilos.logo} aria-hidden>
        <Document24Regular />
      </span>
      <Text weight="semibold" size={400}>
        Ni.doc
      </Text>
    </div>
  )

  return (
    <AuthLayout
      topo={topo}
      titulo="Entre na sua conta"
      subtitulo="Insira seus dados para continuar."
    >
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
          <Input
            type="email"
            size="large"
            autoComplete="email"
            placeholder="voce@exemplo.com"
            contentBefore={<Mail20Regular aria-hidden />}
            {...register('email')}
          />
        </Field>

        <div className={estilos.campoSenha}>
          {/* Link "Esqueceu a senha?" alinhado à direita, na mesma linha do
              label "Senha". É placeholder (não há fluxo de recuperação de senha
              no MVP) e fica fora do <label> do Field para preservar o nome
              acessível do campo. */}
          <div className={estilos.linkEsqueceuLinha}>
            <Link as="button" type="button" inline>
              Esqueceu a senha?
            </Link>
          </div>
          <Field
            label="Senha"
            validationState={errors.senha ? 'error' : 'none'}
            validationMessage={errors.senha?.message}
          >
            <Input
              type={mostrarSenha ? 'text' : 'password'}
              size="large"
              autoComplete="current-password"
              placeholder="Digite sua senha"
              contentBefore={<LockClosed20Regular aria-hidden />}
              contentAfter={
                <Button
                  appearance="transparent"
                  type="button"
                  size="small"
                  icon={mostrarSenha ? <EyeOff20Regular /> : <Eye20Regular />}
                  aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                  onClick={() => setMostrarSenha((atual) => !atual)}
                />
              }
              {...register('senha')}
            />
          </Field>
        </div>

        {/* "Lembrar de mim" é apenas visual: não entra no schema nem no submit. */}
        <Checkbox label="Lembrar de mim" />

        <Button
          appearance="primary"
          type="submit"
          size="large"
          className={estilos.botaoEntrar}
          disabled={enviando}
          icon={enviando ? <Spinner size="tiny" /> : undefined}
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </Button>

        {/* "Criar conta" é placeholder: não há fluxo de cadastro no MVP. */}
        <div className={estilos.rodape}>
          <Text size={200}>Ainda não tem uma conta?</Text>
          <Link as="button" type="button" inline>
            Criar conta
          </Link>
        </div>
      </form>
    </AuthLayout>
  )
}

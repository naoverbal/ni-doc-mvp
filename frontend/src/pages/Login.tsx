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
  mergeClasses,
  tokens,
} from '@fluentui/react-components'
import {
  Eye20Regular,
  EyeOff20Regular,
  LockClosed20Regular,
  Mail20Regular,
} from '@fluentui/react-icons'
import { AuthLayout } from '@/components/common/AuthLayout'
import { useLogin } from '@/hooks/useAuth'
import { useThemeStore } from '@/stores/theme.store'
import { marca } from '@/theme/ni-doc-theme'

// Validação do formulário no cliente (espelha o schema do backend: e-mail
// válido e senha com no mínimo 8 caracteres). Mensagens em pt-BR.
const loginSchema = z.object({
  email: z.string().min(1, 'Informe o e-mail').email('Informe um e-mail válido'),
  senha: z.string().min(1, 'Informe sua senha').min(8, 'A senha deve ter ao menos 8 caracteres'),
})

type LoginFormulario = z.infer<typeof loginSchema>

// Mensagem genérica para credenciais inválidas: não revela se o e-mail existe.
const MENSAGEM_CREDENCIAIS_INVALIDAS =
  'Credenciais inválidas. Verifique seus dados e tente novamente.'

interface EstadoRota {
  from?: Location
}

const useStyles = makeStyles({
  formulario: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalL,
  },
  // Topo do card: badge circular da marca + nome do produto, lado a lado.
  topo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: tokens.spacingHorizontalM,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '48px',
    height: '48px',
    borderRadius: tokens.borderRadiusCircular,
    backgroundColor: tokens.colorBrandBackground,
    color: tokens.colorNeutralForegroundOnBrand,
  },
  // Linha de opções: "Lembrar-me" à esquerda e "Esqueci minha senha" à direita.
  opcoes: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: '32px',
  },
  botaoEntrar: {
    width: '100%',
  },
  // Estado de carregamento: o botão mantém a cor de marca (definida em
  // botaoClaro/botaoEscuro, que também sobrepõem o cinza de "desabilitado" do
  // Fluent) com 50% de opacidade, como no Figma. Controle inativo é isento do
  // critério de contraste do WCAG 1.4.3.
  botaoCarregando: {
    opacity: 0.5,
  },
  // Modo claro: o Figma usa o tom 80 da marca (#6b7c72), que dá ~4,4:1 com
  // texto branco de 14px (abaixo do AA, 4,5:1). Priorizamos o AA: tom 70
  // (~5,7:1), com 60 no hover e 50 ao pressionar.
  botaoClaro: {
    backgroundColor: marca[70],
    color: tokens.colorNeutralForegroundOnBrand,
    ':hover': {
      backgroundColor: marca[60],
      color: tokens.colorNeutralForegroundOnBrand,
    },
    ':hover:active': {
      backgroundColor: marca[50],
      color: tokens.colorNeutralForegroundOnBrand,
    },
  },
  // Modo escuro: botão, link e foco usam o tom 110 da marca (design Figma).
  botaoEscuro: {
    backgroundColor: marca[110],
    color: tokens.colorNeutralForegroundInverted,
    ':hover': {
      backgroundColor: marca[120],
      color: tokens.colorNeutralForegroundInverted,
    },
    ':hover:active': {
      backgroundColor: marca[100],
      color: tokens.colorNeutralForegroundInverted,
    },
  },
  linkEscuro: {
    color: marca[110],
    ':hover': {
      color: marca[120],
    },
  },
})

export function Login(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const login = useLogin()
  const estilos = useStyles()
  const escuro = useThemeStore((estado) => estado.modo === 'escuro')

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
        <Text as="span" size={600} weight="bold">
          n
        </Text>
      </span>
      <Text weight="semibold" size={500}>
        ni-doc
      </Text>
    </div>
  )

  return (
    <AuthLayout
      topo={topo}
      titulo="Bem-vindo de volta"
      subtitulo="Entre com suas credenciais para acessar o sistema"
      notaRodape="Não tem uma conta? Fale com o administrador do seu tenant."
    >
      <form onSubmit={aoEnviar} noValidate className={estilos.formulario} aria-busy={enviando}>
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
          label={{ children: 'E-mail', weight: 'semibold' }}
          validationState={errors.email ? 'error' : 'none'}
          validationMessage={errors.email?.message}
        >
          <Input
            type="email"
            size="large"
            autoComplete="email"
            placeholder="exemplo@email.com"
            contentBefore={<Mail20Regular aria-hidden />}
            {...register('email')}
          />
        </Field>

        <Field
          label={{ children: 'Senha', weight: 'semibold' }}
          validationState={errors.senha ? 'error' : 'none'}
          validationMessage={errors.senha?.message}
        >
          <Input
            type={mostrarSenha ? 'text' : 'password'}
            size="large"
            autoComplete="current-password"
            placeholder="Sua senha"
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

        <div className={estilos.opcoes}>
          {/* "Lembrar-me" é apenas visual: não entra no schema nem no submit. */}
          <Checkbox label="Lembrar-me" />
          {/* Placeholder: não há fluxo de recuperação de senha no MVP. */}
          <Link as="button" type="button" className={escuro ? estilos.linkEscuro : undefined}>
            Esqueci minha senha
          </Link>
        </div>

        {/* disabledFocusable mantém o botão no foco durante o envio e impede
            novo clique/Enter (o Fluent bloqueia o click). */}
        <Button
          appearance="primary"
          type="submit"
          size="large"
          className={mergeClasses(
            estilos.botaoEntrar,
            escuro ? estilos.botaoEscuro : estilos.botaoClaro,
            enviando && estilos.botaoCarregando,
          )}
          disabledFocusable={enviando}
          icon={enviando ? <Spinner size="tiny" /> : undefined}
        >
          {enviando ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>
    </AuthLayout>
  )
}

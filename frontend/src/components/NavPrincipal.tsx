import type { ReactElement } from 'react'
import { NavLink } from 'react-router-dom'
import { Tooltip, makeStyles, mergeClasses, tokens } from '@fluentui/react-components'
import { useAuthStore } from '@/stores/auth.store'
import { ITENS_NAVEGACAO, type ItemNavegacao } from '@/components/layout/itens-navegacao'

const useStyles = makeStyles({
  nav: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    overflowY: 'auto',
    paddingBlock: tokens.spacingVerticalS,
    paddingInline: tokens.spacingHorizontalS,
  },
  lista: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXXS,
  },
  // Base compartilhada por links e itens desabilitados: linha com ícone + rótulo.
  item: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalM,
    minHeight: '40px',
    paddingInline: tokens.spacingHorizontalM,
    borderRadius: tokens.borderRadiusMedium,
    color: tokens.colorNeutralForeground2,
    textDecoration: 'none',
    fontSize: tokens.fontSizeBase300,
    // Reforço não-cromático do item ativo é aplicado via &.ativo abaixo.
    borderLeft: `${tokens.strokeWidthThick} solid transparent`,
  },
  itemColapsado: {
    justifyContent: 'center',
    columnGap: 0,
    paddingInline: 0,
  },
  link: {
    ':hover': {
      backgroundColor: tokens.colorNeutralBackground1Hover,
      color: tokens.colorNeutralForeground1,
    },
  },
  // Item ativo: cor de marca + fundo + peso + borda à esquerda (reforço
  // não-cromático), para não depender apenas de cor (WCAG 1.4.1).
  ativo: {
    backgroundColor: tokens.colorBrandBackground2,
    color: tokens.colorBrandForeground1,
    fontWeight: tokens.fontWeightSemibold,
    borderLeftColor: tokens.colorBrandStroke1,
  },
  desabilitado: {
    color: tokens.colorNeutralForegroundDisabled,
    cursor: 'default',
  },
  icone: {
    display: 'flex',
    flexShrink: 0,
    fontSize: '24px',
  },
  rotulo: {
    flexGrow: 1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  // "em breve": indicação textual (não só visual) de que o item ainda não tem
  // destino. Também compõe o nome acessível do item desabilitado.
  emBreve: {
    fontSize: tokens.fontSizeBase200,
    color: tokens.colorNeutralForeground3,
    whiteSpace: 'nowrap',
  },
})

interface NavPrincipalProps {
  // Modo colapsado: só ícones, com Tooltip exibindo o rótulo.
  colapsada?: boolean
  // Chamado ao navegar (usado pelo Drawer mobile para fechar ao escolher).
  aoNavegar?: () => void
}

// Navegação principal da área logada. Renderiza os itens do protótipo; itens
// com rota viram NavLink (o React Router aplica aria-current="page" ao ativo),
// e itens sem rota ainda aparecem desabilitados (aria-disabled + "em breve"),
// não focáveis. No modo colapsado só os ícones aparecem, com Tooltip do rótulo.
export function NavPrincipal({ colapsada = false, aoNavegar }: NavPrincipalProps): ReactElement {
  const estilos = useStyles()
  const usuario = useAuthStore((estado) => estado.usuario)
  const ehAdmin = usuario?.papel === 'admin'

  const itens = ITENS_NAVEGACAO.filter((item) => !item.apenasAdmin || ehAdmin)

  return (
    <nav className={estilos.nav} aria-label="Principal">
      <ul className={estilos.lista}>
        {itens.map((item) => (
          <li key={item.chave}>
            {renderizarItem(item, { colapsada, aoNavegar, estilos })}
          </li>
        ))}
      </ul>
    </nav>
  )
}

function renderizarItem(
  item: ItemNavegacao,
  opcoes: {
    colapsada: boolean
    aoNavegar?: () => void
    estilos: ReturnType<typeof useStyles>
  },
): ReactElement {
  const { colapsada, aoNavegar, estilos } = opcoes
  const Icone = item.icone

  // Item sem rota ainda: desabilitado, não focável, com indicação "em breve".
  if (!item.rota) {
    const nomeAcessivel = `${item.rotulo}, em breve`
    const conteudo = (
      <span
        className={mergeClasses(
          estilos.item,
          estilos.desabilitado,
          colapsada && estilos.itemColapsado,
        )}
        aria-disabled="true"
        aria-label={nomeAcessivel}
      >
        <span className={estilos.icone} aria-hidden>
          <Icone />
        </span>
        {!colapsada && (
          <>
            <span className={estilos.rotulo}>{item.rotulo}</span>
            <span className={estilos.emBreve}>em breve</span>
          </>
        )}
      </span>
    )

    return colapsada ? (
      <Tooltip content={nomeAcessivel} relationship="label" withArrow positioning="after">
        {conteudo}
      </Tooltip>
    ) : (
      conteudo
    )
  }

  // Item com rota: NavLink; o React Router aplica aria-current="page" ao ativo.
  const link = (
    <NavLink
      to={item.rota}
      end={item.fim}
      onClick={aoNavegar}
      aria-label={colapsada ? item.rotulo : undefined}
      className={({ isActive }) =>
        mergeClasses(
          estilos.item,
          estilos.link,
          colapsada && estilos.itemColapsado,
          isActive && estilos.ativo,
        )
      }
    >
      <span className={estilos.icone} aria-hidden>
        <Icone />
      </span>
      {!colapsada && <span className={estilos.rotulo}>{item.rotulo}</span>}
    </NavLink>
  )

  return colapsada ? (
    <Tooltip content={item.rotulo} relationship="label" withArrow positioning="after">
      {link}
    </Tooltip>
  ) : (
    link
  )
}

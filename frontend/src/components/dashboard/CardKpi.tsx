import type { ReactElement, ReactNode } from 'react'
import { Card, Text, makeStyles, tokens } from '@fluentui/react-components'

// Card de KPI reutilizável do dashboard: rótulo textual + número grande, com
// descrição e ícone opcionais. Estilizado só com tokens Fluent (sem cor
// hard-coded). Específico de tela, por isso vive em components/dashboard/.

interface CardKpiProps {
  rotulo: string
  valor: string
  descricao?: string
  // Ícone decorativo opcional; deve vir com aria-hidden do chamador.
  icone?: ReactNode
}

const useStyles = makeStyles({
  card: {
    display: 'flex',
    flexDirection: 'column',
    rowGap: tokens.spacingVerticalXS,
    padding: tokens.spacingVerticalXL,
  },
  cabecalho: {
    display: 'flex',
    alignItems: 'center',
    columnGap: tokens.spacingHorizontalS,
    color: tokens.colorNeutralForeground2,
  },
  valor: {
    fontFamily: tokens.fontFamilyMonospace,
  },
})

export function CardKpi({ rotulo, valor, descricao, icone }: CardKpiProps): ReactElement {
  const estilos = useStyles()
  return (
    <Card className={estilos.card}>
      <div className={estilos.cabecalho}>
        {icone}
        <Text size={200}>{rotulo}</Text>
      </div>
      <Text size={700} weight="bold" className={estilos.valor}>
        {valor}
      </Text>
      {descricao && (
        <Text size={200} style={{ color: tokens.colorNeutralForeground3 }}>
          {descricao}
        </Text>
      )}
    </Card>
  )
}

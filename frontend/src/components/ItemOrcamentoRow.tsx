import { useId, useState, type ReactElement } from 'react'
import {
  Button,
  Caption1,
  Dropdown,
  Input,
  Menu,
  MenuItem,
  MenuList,
  MenuPopover,
  MenuTrigger,
  Option,
  TableCell,
  TableCellLayout,
  TableRow,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { MoreHorizontal20Regular, ReOrderDotsVertical20Regular } from '@fluentui/react-icons'
import type { DescontoTipo, ResponsavelResumo } from '@/types/api'
import { calcularTotalItem } from '@/lib/orcamento-calculo'
import { useBuscarResponsaveis } from '@/hooks/useReferencias'
import { Autocomplete, type OpcaoAutocomplete } from '@/components/Autocomplete'
import { formatarMoeda } from '@/lib/formato'

// Unidades de medida disponíveis para um item (RF-006).
export const UNIDADES_ITEM = ['un', 'h', 'm²', 'kit'] as const

// Forma de um item no estado do formulário. Mantém os campos de seleção/entrada
// com os tipos usados pelo cálculo; a conversão para o payload de salvamento
// acontece no editor.
export interface ItemFormulario {
  nome: string
  quantidade: number
  unidade: string
  valorUnitario: number
  descontoTipo: DescontoTipo | ''
  descontoValor: number
  responsavelId: string
  responsavelNome: string
}

export interface ItemOrcamentoRowProps {
  indice: number
  item: ItemFormulario
  aoMudar: (item: ItemFormulario) => void
  aoRemover: () => void
  podeRemover: boolean
  // Erro de validação do nome (RF-006.1), vinculado por aria-describedby.
  erroNome?: string
}

const useStyles = makeStyles({
  celulaResponsavel: {
    minWidth: '220px',
  },
  entradaResponsavel: {
    marginTop: tokens.spacingVerticalXS,
  },
  erro: {
    display: 'block',
    marginTop: tokens.spacingVerticalXXS,
    color: tokens.colorPaletteRedForeground1,
    fontSize: tokens.fontSizeBase200,
  },
  celulaMoeda: {
    textAlign: 'right',
    whiteSpace: 'nowrap',
    fontFamily: tokens.fontFamilyMonospace,
  },
  manipulador: {
    color: tokens.colorNeutralForeground3,
  },
})

/**
 * Uma linha editável de item do orçamento (RF-006), renderizada como `TableRow`
 * Fluent. Cada campo tem nome acessível via `aria-label`; o total do item é
 * recalculado em tempo real. O responsável técnico (opcional) usa um combobox
 * acessível, exibido abaixo do nome do item.
 */
export function ItemOrcamentoRow({
  indice,
  item,
  aoMudar,
  aoRemover,
  podeRemover,
  erroNome,
}: ItemOrcamentoRowProps): ReactElement {
  const estilos = useStyles()
  const nomeErroId = useId()
  const respBaseId = useId()
  const numero = indice + 1

  const [termoResp, setTermoResp] = useState(item.responsavelNome)
  const { data: responsaveis = [], isLoading } = useBuscarResponsaveis(termoResp)

  const opcoes: OpcaoAutocomplete[] = responsaveis.map((r: ResponsavelResumo) => ({
    id: r.id,
    rotulo: r.registroProfissional ? `${r.nome} (${r.registroProfissional})` : r.nome,
  }))

  const selecionado: OpcaoAutocomplete | null = item.responsavelId
    ? { id: item.responsavelId, rotulo: item.responsavelNome }
    : null

  const total = calcularTotalItem({
    quantidade: item.quantidade,
    valorUnitario: item.valorUnitario,
    descontoTipo: item.descontoTipo || undefined,
    descontoValor: item.descontoTipo ? item.descontoValor : undefined,
  })

  function atualizar<K extends keyof ItemFormulario>(campo: K, valor: ItemFormulario[K]): void {
    aoMudar({ ...item, [campo]: valor })
  }

  // Converte uma string de entrada numérica para número, tratando vazio como NaN
  // (o cálculo em tempo real trata NaN como 0).
  function paraNumero(texto: string): number {
    return texto === '' ? Number.NaN : Number(texto)
  }

  return (
    <TableRow>
      <TableCell className="col-handle cell-handle">
        <ReOrderDotsVertical20Regular aria-hidden className={estilos.manipulador} />
      </TableCell>

      <TableCell>
        <TableCellLayout>
          <Input
            aria-label={`Nome do item ${numero}`}
            appearance="underline"
            size="small"
            value={item.nome}
            aria-invalid={erroNome ? true : undefined}
            aria-describedby={erroNome ? nomeErroId : undefined}
            onChange={(_, dados) => atualizar('nome', dados.value)}
          />
          {erroNome && (
            <span id={nomeErroId} role="alert" className={estilos.erro}>
              {erroNome}
            </span>
          )}
          <div className={estilos.celulaResponsavel}>
            <Autocomplete
              id={respBaseId}
              className={estilos.entradaResponsavel}
              rotulo={`Responsável técnico do item ${numero} (opcional)`}
              rotuloOculto
              texto={termoResp}
              aoMudarTexto={(texto) => {
                setTermoResp(texto)
                if (texto.trim() === '') {
                  aoMudar({ ...item, responsavelId: '', responsavelNome: '' })
                }
              }}
              opcoes={opcoes}
              selecionado={selecionado}
              carregando={isLoading}
              placeholder="Responsável técnico (opcional)"
              aoSelecionar={(opcao) => {
                setTermoResp(opcao.rotulo)
                aoMudar({ ...item, responsavelId: opcao.id, responsavelNome: opcao.rotulo })
              }}
            />
          </div>
        </TableCellLayout>
      </TableCell>

      <TableCell>
        <Input
          aria-label={`Quantidade do item ${numero}`}
          appearance="underline"
          size="small"
          type="number"
          min={0}
          step="any"
          value={Number.isFinite(item.quantidade) ? String(item.quantidade) : ''}
          onChange={(_, dados) => atualizar('quantidade', paraNumero(dados.value))}
        />
      </TableCell>

      <TableCell>
        <Dropdown
          aria-label={`Unidade do item ${numero}`}
          size="small"
          value={item.unidade}
          selectedOptions={[item.unidade]}
          onOptionSelect={(_, dados) => atualizar('unidade', dados.optionValue ?? 'un')}
        >
          {UNIDADES_ITEM.map((unidade) => (
            <Option key={unidade}>{unidade}</Option>
          ))}
        </Dropdown>
      </TableCell>

      <TableCell>
        <Input
          aria-label={`Valor unitário do item ${numero}`}
          appearance="underline"
          size="small"
          type="number"
          min={0}
          step="any"
          contentBefore={<Caption1>R$</Caption1>}
          value={Number.isFinite(item.valorUnitario) ? String(item.valorUnitario) : ''}
          onChange={(_, dados) => atualizar('valorUnitario', paraNumero(dados.value))}
        />
      </TableCell>

      <TableCell className={`col-total ${estilos.celulaMoeda}`}>{formatarMoeda(total)}</TableCell>

      <TableCell className="col-actions">
        <Menu>
          <MenuTrigger disableButtonEnhancement>
            <Tooltip content={`Ações do item ${numero}`} relationship="label">
              <Button
                appearance="subtle"
                size="small"
                aria-label={`Ações do item ${numero}`}
                icon={<MoreHorizontal20Regular />}
              />
            </Tooltip>
          </MenuTrigger>
          <MenuPopover>
            <MenuList>
              <MenuItem disabled={!podeRemover} onClick={aoRemover}>
                Remover item {numero}
              </MenuItem>
            </MenuList>
          </MenuPopover>
        </Menu>
      </TableCell>
    </TableRow>
  )
}

import type {
  DescontoTipo,
  OrcamentoComItens,
  OrcamentoItemPublico,
} from '../repositories/orcamento.repository.js'
import type { ClientePublico } from '../repositories/cliente.repository.js'
import type { EmpresaPublica } from '../repositories/empresa.repository.js'
import type { ResponsavelPublico } from '../repositories/responsavel.repository.js'

// -----------------------------------------------------------------------------
// Serviço de montagem PURO do snapshot JSONB imutável de um orçamento no momento
// da emissão (RF-008; Correctness Properties nº 2 — imutabilidade — e nº 3 —
// integridade). Sem acesso a banco, sem persistência e sem repositórios: a
// persistência e o versionamento são responsabilidade da Tarefa 32.
//
// A estrutura segue a seção 5.2 do design (chaves em snake_case). O resultado é
// uma cópia PROFUNDA por valor: todos os objetos/arrays são construídos campo a
// campo (nunca por spread ou reuso de referências da entrada), de modo que mutar
// as fontes depois de montar não afeta o snapshot.
// -----------------------------------------------------------------------------

export interface SnapshotCliente {
  id: string
  nome: string
  tipo_pessoa: 'PF' | 'PJ'
  documento: string
  email: string | null
  telefone: string | null
  endereco: string | null
}

export interface SnapshotEmpresa {
  id: string
  razao_social: string
  nome_fantasia: string | null
  cnpj: string | null
  endereco: string | null
}

export interface SnapshotResponsavel {
  id: string
  nome: string
  registro_profissional: string | null
}

export interface SnapshotItem {
  ordem: number
  nome: string
  descricao: string | null
  quantidade: number
  unidade: string
  valor_unitario: number
  desconto_tipo: DescontoTipo | null
  desconto_valor: number | null
  total: number
  responsavel: SnapshotResponsavel | null
}

export interface SnapshotDescontoGlobal {
  tipo: DescontoTipo
  valor: number
}

export interface OrcamentoSnapshot {
  cliente: SnapshotCliente
  empresa_cliente: SnapshotEmpresa | null
  itens: SnapshotItem[]
  desconto_global: SnapshotDescontoGlobal | null
  subtotal: number
  total: number
  condicoes_pagamento: string | null
  observacoes: string | null
  // Serializada como string ISO de data `YYYY-MM-DD` (ver `montarDataEmissao`).
  data_emissao: string
  validade_dias: number
}

export interface MontarSnapshotInput {
  orcamento: OrcamentoComItens
  cliente: ClientePublico
  empresaCliente?: EmpresaPublica | null
  // Responsáveis já resolvidos pelo chamador (mantém o serviço puro). Chave: id
  // do responsável. Itens cujo `responsavelId` seja nulo ou ausente do Map ficam
  // com `responsavel: null`.
  responsaveisPorId: Map<string, ResponsavelPublico>
}

export interface SnapshotService {
  montar(input: MontarSnapshotInput): OrcamentoSnapshot
}

// `dataEmissao` é um `Date` do JS; a coluna `orcamentos.data_emissao` é `DATE` e
// o design 5.2 mostra `"2026-10-01"`. Convertemos de forma determinística para
// `YYYY-MM-DD` em UTC (sem hora/fuso), garantindo um valor JSON-serializável e
// estável independentemente do fuso do processo.
function montarDataEmissao(dataEmissao: Date): string {
  return dataEmissao.toISOString().slice(0, 10)
}

function montarCliente(cliente: ClientePublico): SnapshotCliente {
  return {
    id: cliente.id,
    nome: cliente.nome,
    tipo_pessoa: cliente.tipoPessoa,
    documento: cliente.documento,
    email: cliente.email,
    telefone: cliente.telefone,
    endereco: cliente.endereco,
  }
}

function montarEmpresa(empresa: EmpresaPublica | null | undefined): SnapshotEmpresa | null {
  if (empresa === null || empresa === undefined) return null
  return {
    id: empresa.id,
    razao_social: empresa.razaoSocial,
    nome_fantasia: empresa.nomeFantasia,
    cnpj: empresa.cnpj,
    endereco: empresa.endereco,
  }
}

function montarResponsavel(responsavel: ResponsavelPublico): SnapshotResponsavel {
  return {
    id: responsavel.id,
    nome: responsavel.nome,
    registro_profissional: responsavel.registroProfissional,
  }
}

function montarItem(
  item: OrcamentoItemPublico,
  responsaveisPorId: Map<string, ResponsavelPublico>,
): SnapshotItem {
  // `.get()` pode retornar `undefined` (noUncheckedIndexedAccess); tratamos
  // como "sem responsável" (null) quando o id é nulo ou não está no Map.
  const responsavel =
    item.responsavelId !== null ? responsaveisPorId.get(item.responsavelId) : undefined

  return {
    ordem: item.ordem,
    nome: item.nome,
    descricao: item.descricao,
    quantidade: item.quantidade,
    unidade: item.unidade,
    valor_unitario: item.valorUnitario,
    desconto_tipo: item.descontoTipo,
    desconto_valor: item.descontoValor,
    total: item.total,
    responsavel: responsavel !== undefined ? montarResponsavel(responsavel) : null,
  }
}

// `desconto_global` só existe quando tipo E valor estão presentes (espelha a
// lógica do repositório de orçamentos, onde ambos são obrigatórios juntos).
function montarDescontoGlobal(
  tipo: DescontoTipo | null,
  valor: number | null,
): SnapshotDescontoGlobal | null {
  if (tipo === null || valor === null) return null
  return { tipo, valor }
}

export function criarSnapshotService(): SnapshotService {
  return {
    montar(input: MontarSnapshotInput): OrcamentoSnapshot {
      const { orcamento, cliente, empresaCliente, responsaveisPorId } = input

      return {
        cliente: montarCliente(cliente),
        empresa_cliente: montarEmpresa(empresaCliente),
        itens: orcamento.itens.map((item) => montarItem(item, responsaveisPorId)),
        desconto_global: montarDescontoGlobal(
          orcamento.descontoGlobalTipo,
          orcamento.descontoGlobalValor,
        ),
        subtotal: orcamento.subtotal,
        total: orcamento.total,
        condicoes_pagamento: orcamento.condicoesPagamento,
        observacoes: orcamento.observacoes,
        data_emissao: montarDataEmissao(orcamento.dataEmissao),
        validade_dias: orcamento.validadeDias,
      }
    },
  }
}

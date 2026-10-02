import type { Generated, ColumnType } from 'kysely';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Column that is writable on INSERT/UPDATE but returns Date on SELECT. */
type DateCol = ColumnType<Date, Date | string, Date | string>;

/** Column with a server-side DEFAULT — omittable on INSERT, not updatable here. */
type GeneratedDate = Generated<Date>;

// ---------------------------------------------------------------------------
// TENANTS
// ---------------------------------------------------------------------------
export interface TenantTable {
  id: Generated<string>;
  nome: string;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// USUÁRIOS
// ---------------------------------------------------------------------------
export interface UsuarioTable {
  id: Generated<string>;
  tenant_id: string;
  nome: string;
  email_hash: string;
  email_encrypted: string;
  senha_hash: string;
  papel: 'admin' | 'operador';
  ativo: Generated<boolean>;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// SESSÕES
// ---------------------------------------------------------------------------
export interface SessaoTable {
  id: Generated<string>;
  usuario_id: string;
  ip: string | null;
  user_agent: string | null;
  criado_em: GeneratedDate;
  expira_em: DateCol;
  ultima_atividade: GeneratedDate;
}

// ---------------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------------
export interface ClienteTable {
  id: Generated<string>;
  tenant_id: string;
  tipo_pessoa: 'PF' | 'PJ';
  nome: string;
  documento_hash: string;
  documento_encrypted: string;
  email_encrypted: string | null;
  telefone_encrypted: string | null;
  endereco_encrypted: string | null;
  observacoes: string | null;
  ativo: Generated<boolean>;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// EMPRESAS
// ---------------------------------------------------------------------------
export interface EmpresaTable {
  id: Generated<string>;
  tenant_id: string;
  tipo: 'tenant' | 'cliente_pj';
  razao_social: string;
  nome_fantasia: string | null;
  cnpj_hash: string | null;
  cnpj_encrypted: string | null;
  endereco_encrypted: string | null;
  email_encrypted: string | null;
  telefone_encrypted: string | null;
  ativo: Generated<boolean>;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// RESPONSÁVEIS TÉCNICOS
// ---------------------------------------------------------------------------
export interface ResponsavelTecnicoTable {
  id: Generated<string>;
  tenant_id: string;
  nome: string;
  registro_profissional: string | null;
  email_encrypted: string | null;
  telefone_encrypted: string | null;
  ativo: Generated<boolean>;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// TEMPLATES
// ---------------------------------------------------------------------------
export interface TemplateTable {
  id: Generated<string>;
  tenant_id: string;
  versao: number;
  layout_json: unknown;
  criado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// TENANTS_TEMPLATE_ATIVO
// ---------------------------------------------------------------------------
export interface TenantTemplateAtivoTable {
  tenant_id: string;
  template_id: string;
}

// ---------------------------------------------------------------------------
// ORÇAMENTOS
// ---------------------------------------------------------------------------
export interface OrcamentoTable {
  id: Generated<string>;
  tenant_id: string;
  numero: string;
  cliente_id: string;
  empresa_cliente_id: string | null;
  usuario_id: string;
  titulo: string;
  descricao: string | null;
  status: Generated<
    'rascunho' | 'enviado' | 'aprovado' | 'reprovado' | 'expirado' | 'cancelado'
  >;
  data_emissao: Generated<Date>;
  validade_dias: Generated<number>;
  desconto_global_tipo: 'percentual' | 'fixo' | null;
  desconto_global_valor: string | null; // NUMERIC returns string from pg driver
  subtotal: Generated<string>;
  total: Generated<string>;
  versao_atual: Generated<number>;
  observacoes: string | null;
  condicoes_pagamento: string | null;
  criado_em: GeneratedDate;
  atualizado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// ITENS DO ORÇAMENTO
// ---------------------------------------------------------------------------
export interface OrcamentoItemTable {
  id: Generated<string>;
  orcamento_id: string;
  ordem: number;
  nome: string;
  descricao: string | null;
  quantidade: Generated<string>; // NUMERIC
  unidade: Generated<string>;
  valor_unitario: string; // NUMERIC
  desconto_tipo: 'percentual' | 'fixo' | null;
  desconto_valor: string | null; // NUMERIC
  total: string; // NUMERIC
  responsavel_id: string | null;
  criado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// VERSÕES DO ORÇAMENTO
// ---------------------------------------------------------------------------
export interface OrcamentoVersaoTable {
  id: Generated<string>;
  orcamento_id: string;
  versao: number;
  snapshot: unknown;
  template_id: string;
  pdf_path: string | null;
  pdf_hash: string | null;
  token_publico: string;
  enviado_em: GeneratedDate;
  expira_em: DateCol | null;
}

// ---------------------------------------------------------------------------
// ACEITES
// ---------------------------------------------------------------------------
export interface OrcamentoAceiteTable {
  id: Generated<string>;
  versao_id: string;
  metodo: 'cliente' | 'operador';
  usuario_id: string | null;
  ip: string | null;
  user_agent: string | null;
  hash_documento: string;
  justificativa: string | null;
  criado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// EVENTOS DE AUDITORIA
// ---------------------------------------------------------------------------
export interface EventoAuditoriaTable {
  id: Generated<string>;
  tenant_id: string;
  usuario_id: string | null;
  acao: string;
  entidade: string;
  entidade_id: string | null;
  estado_anterior: unknown | null;
  estado_novo: unknown | null;
  ip: string | null;
  user_agent: string | null;
  criado_em: GeneratedDate;
}

// ---------------------------------------------------------------------------
// DATABASE — agregado para uso em new Kysely<Database>(...)
// ---------------------------------------------------------------------------
export interface Database {
  tenants: TenantTable;
  usuarios: UsuarioTable;
  sessoes: SessaoTable;
  clientes: ClienteTable;
  empresas: EmpresaTable;
  responsaveis_tecnicos: ResponsavelTecnicoTable;
  templates: TemplateTable;
  tenants_template_ativo: TenantTemplateAtivoTable;
  orcamentos: OrcamentoTable;
  orcamento_itens: OrcamentoItemTable;
  orcamento_versoes: OrcamentoVersaoTable;
  orcamento_aceites: OrcamentoAceiteTable;
  eventos_auditoria: EventoAuditoriaTable;
}

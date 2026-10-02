-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================================================
-- TENANTS
-- =====================================================
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================
-- USUÁRIOS
-- email_encrypted: e-mail criptografado (AES-256-GCM)
-- email_hash: SHA-256 do e-mail em lowercase (para busca e login)
-- =====================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  email_hash CHAR(64) NOT NULL,
  email_encrypted TEXT NOT NULL,
  senha_hash TEXT NOT NULL,
  papel VARCHAR(20) NOT NULL CHECK (papel IN ('admin', 'operador')),
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (email_hash)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);

-- =====================================================
-- SESSÕES (server-side)
-- =====================================================
CREATE TABLE IF NOT EXISTS sessoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip VARCHAR(45),
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ NOT NULL,
  ultima_atividade TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessoes_usuario ON sessoes(usuario_id);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);

-- =====================================================
-- CLIENTES
-- =====================================================
CREATE TABLE IF NOT EXISTS clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo_pessoa VARCHAR(2) NOT NULL CHECK (tipo_pessoa IN ('PF', 'PJ')),
  nome VARCHAR(255) NOT NULL,
  documento_hash CHAR(64) NOT NULL,
  documento_encrypted TEXT NOT NULL,
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  endereco_encrypted TEXT,
  observacoes TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, documento_hash)
);

CREATE INDEX IF NOT EXISTS idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(tenant_id, nome);

-- =====================================================
-- EMPRESAS
-- =====================================================
CREATE TABLE IF NOT EXISTS empresas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('tenant', 'cliente_pj')),
  razao_social VARCHAR(255) NOT NULL,
  nome_fantasia VARCHAR(255),
  cnpj_hash CHAR(64),
  cnpj_encrypted TEXT,
  endereco_encrypted TEXT,
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empresas_tenant ON empresas(tenant_id, tipo);

-- =====================================================
-- RESPONSÁVEIS TÉCNICOS
-- =====================================================
CREATE TABLE IF NOT EXISTS responsaveis_tecnicos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome VARCHAR(255) NOT NULL,
  registro_profissional VARCHAR(50),
  email_encrypted TEXT,
  telefone_encrypted TEXT,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_responsaveis_tenant ON responsaveis_tecnicos(tenant_id);

-- =====================================================
-- TEMPLATES (versionados e imutáveis)
-- =====================================================
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  layout_json JSONB NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id, versao DESC);

-- Aponta qual versão do template é a "atual" para novas emissões
CREATE TABLE IF NOT EXISTS tenants_template_ativo (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES templates(id)
);

-- =====================================================
-- ORÇAMENTOS (rascunho atual)
-- =====================================================
CREATE TABLE IF NOT EXISTS orcamentos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  numero VARCHAR(30) NOT NULL,
  cliente_id UUID NOT NULL REFERENCES clientes(id),
  empresa_cliente_id UUID REFERENCES empresas(id),
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  titulo VARCHAR(255) NOT NULL,
  descricao TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'enviado', 'aprovado', 'reprovado', 'expirado', 'cancelado')),
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  validade_dias INTEGER NOT NULL DEFAULT 30,
  desconto_global_tipo VARCHAR(10) CHECK (desconto_global_tipo IN ('percentual', 'fixo')),
  desconto_global_valor NUMERIC(12,2),
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  versao_atual INTEGER NOT NULL DEFAULT 0,
  observacoes TEXT,
  condicoes_pagamento TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant ON orcamentos(tenant_id);
CREATE INDEX IF NOT EXISTS idx_orcamentos_status ON orcamentos(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_orcamentos_cliente ON orcamentos(cliente_id);

-- =====================================================
-- ITENS DO ORÇAMENTO (rascunho)
-- =====================================================
CREATE TABLE IF NOT EXISTS orcamento_itens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  quantidade NUMERIC(12,4) NOT NULL DEFAULT 1,
  unidade VARCHAR(20) NOT NULL DEFAULT 'un',
  valor_unitario NUMERIC(12,2) NOT NULL,
  desconto_tipo VARCHAR(10) CHECK (desconto_tipo IN ('percentual', 'fixo')),
  desconto_valor NUMERIC(12,2),
  total NUMERIC(12,2) NOT NULL,
  responsavel_id UUID REFERENCES responsaveis_tecnicos(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_itens_orcamento ON orcamento_itens(orcamento_id, ordem);

-- =====================================================
-- VERSÕES DO ORÇAMENTO (imutáveis)
-- =====================================================
CREATE TABLE IF NOT EXISTS orcamento_versoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  template_id UUID NOT NULL REFERENCES templates(id),
  pdf_path TEXT,
  pdf_hash CHAR(64),
  token_publico VARCHAR(128) NOT NULL UNIQUE,
  enviado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ,
  UNIQUE (orcamento_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_versoes_orcamento ON orcamento_versoes(orcamento_id);
CREATE INDEX IF NOT EXISTS idx_versoes_token ON orcamento_versoes(token_publico);

-- =====================================================
-- ACEITES
-- =====================================================
CREATE TABLE IF NOT EXISTS orcamento_aceites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  versao_id UUID NOT NULL REFERENCES orcamento_versoes(id) ON DELETE CASCADE,
  metodo VARCHAR(20) NOT NULL CHECK (metodo IN ('cliente', 'operador')),
  usuario_id UUID REFERENCES usuarios(id),
  ip VARCHAR(45),
  user_agent TEXT,
  hash_documento CHAR(64) NOT NULL,
  justificativa TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (versao_id)
);

CREATE INDEX IF NOT EXISTS idx_aceites_versao ON orcamento_aceites(versao_id);

-- =====================================================
-- EVENTOS DE AUDITORIA
-- =====================================================
CREATE TABLE IF NOT EXISTS eventos_auditoria (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  usuario_id UUID REFERENCES usuarios(id),
  acao VARCHAR(50) NOT NULL,
  entidade VARCHAR(50) NOT NULL,
  entidade_id UUID,
  estado_anterior JSONB,
  estado_novo JSONB,
  ip VARCHAR(45),
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_tenant ON eventos_auditoria(tenant_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_entidade ON eventos_auditoria(entidade, entidade_id);

-- =====================================================
-- ROW LEVEL SECURITY
-- A aplicação deve executar:
--   SET LOCAL app.current_tenant = '<uuid>'
-- no início de cada transação (feito no middleware tenant.ts).
--
-- Migration idempotente: PostgreSQL não suporta
-- `CREATE POLICY IF NOT EXISTS`, por isso cada policy é
-- precedida de `DROP POLICY IF EXISTS` para permitir
-- reaplicação segura (ex.: ambientes recriados).
-- `ENABLE/FORCE ROW LEVEL SECURITY` já são no-ops quando
-- a propriedade já está ativa.
-- =====================================================

-- USUÁRIOS
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuarios_tenant_isolation ON usuarios;
CREATE POLICY usuarios_tenant_isolation ON usuarios
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- CLIENTES
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clientes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clientes_tenant_isolation ON clientes;
CREATE POLICY clientes_tenant_isolation ON clientes
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- EMPRESAS
ALTER TABLE empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE empresas FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS empresas_tenant_isolation ON empresas;
CREATE POLICY empresas_tenant_isolation ON empresas
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- RESPONSÁVEIS TÉCNICOS
ALTER TABLE responsaveis_tecnicos ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsaveis_tecnicos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS responsaveis_tecnicos_tenant_isolation ON responsaveis_tecnicos;
CREATE POLICY responsaveis_tecnicos_tenant_isolation ON responsaveis_tecnicos
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- ORÇAMENTOS
ALTER TABLE orcamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamentos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamentos_tenant_isolation ON orcamentos;
CREATE POLICY orcamentos_tenant_isolation ON orcamentos
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- TEMPLATES
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS templates_tenant_isolation ON templates;
CREATE POLICY templates_tenant_isolation ON templates
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- EVENTOS DE AUDITORIA
ALTER TABLE eventos_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE eventos_auditoria FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS eventos_auditoria_tenant_isolation ON eventos_auditoria;
CREATE POLICY eventos_auditoria_tenant_isolation ON eventos_auditoria
  USING (tenant_id = current_setting('app.current_tenant', TRUE)::uuid);

-- ITENS DO ORÇAMENTO (sem tenant_id direta — via orcamentos)
ALTER TABLE orcamento_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_itens FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_itens_tenant_isolation ON orcamento_itens;
CREATE POLICY orcamento_itens_tenant_isolation ON orcamento_itens
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_itens.orcamento_id
      AND o.tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  ));

-- VERSÕES DO ORÇAMENTO (sem tenant_id direta — via orcamentos)
ALTER TABLE orcamento_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_versoes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_versoes_tenant_isolation ON orcamento_versoes;
CREATE POLICY orcamento_versoes_tenant_isolation ON orcamento_versoes
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_versoes.orcamento_id
      AND o.tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  ));

-- ACEITES (sem tenant_id direta — via orcamento_versoes via orcamentos)
ALTER TABLE orcamento_aceites ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_aceites FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_aceites_tenant_isolation ON orcamento_aceites;
CREATE POLICY orcamento_aceites_tenant_isolation ON orcamento_aceites
  USING (EXISTS (
    SELECT 1 FROM orcamento_versoes ov
    JOIN orcamentos o ON o.id = ov.orcamento_id
    WHERE ov.id = orcamento_aceites.versao_id
      AND o.tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  ));

-- SESSÕES (sem tenant_id direta — via usuarios)
ALTER TABLE sessoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessoes FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessoes_tenant_isolation ON sessoes;
CREATE POLICY sessoes_tenant_isolation ON sessoes
  USING (EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = sessoes.usuario_id
      AND u.tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  ));

-- TENANTS: cada tenant só enxerga a si mesmo
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_self_isolation ON tenants;
CREATE POLICY tenants_self_isolation ON tenants
  USING (id = current_setting('app.current_tenant', TRUE)::uuid);

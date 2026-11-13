-- Rollback da 025: recria os índices removidos (definições originais da 001).
-- Depois, apague '025_remove_indices_redundantes_2.sql' de _migrations.
CREATE INDEX IF NOT EXISTS idx_aceites_versao ON orcamento_aceites(versao_id);
CREATE INDEX IF NOT EXISTS idx_versoes_token ON orcamento_versoes(token_publico);
CREATE INDEX IF NOT EXISTS idx_versoes_orcamento ON orcamento_versoes(orcamento_id);
CREATE INDEX IF NOT EXISTS idx_clientes_tenant ON clientes(tenant_id);
CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates(tenant_id, versao DESC);
CREATE INDEX IF NOT EXISTS idx_usuarios_tenant ON usuarios(tenant_id);

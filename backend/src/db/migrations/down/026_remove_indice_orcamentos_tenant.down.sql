-- Rollback da 026: recria o índice removido (definição original da 001).
-- Depois, apague '026_remove_indice_orcamentos_tenant.sql' de _migrations.
CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant ON orcamentos(tenant_id);

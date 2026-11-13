-- Rollback da 021. Não altera dados. Depois, apague '021_consistencia_tenant.sql' de _migrations.
DROP TRIGGER IF EXISTS trg_orcamento_versoes_validar_template ON orcamento_versoes;
DROP FUNCTION IF EXISTS validar_template_versao_orcamento();
ALTER TABLE eventos_auditoria DROP CONSTRAINT IF EXISTS fk_eventos_auditoria_usuario_tenant;
ALTER TABLE tenants_template_ativo DROP CONSTRAINT IF EXISTS fk_tenants_template_ativo_tenant;
ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS fk_orcamentos_usuario_tenant;
ALTER TABLE templates DROP CONSTRAINT IF EXISTS uq_templates_tenant_id;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS uq_usuarios_tenant_id;

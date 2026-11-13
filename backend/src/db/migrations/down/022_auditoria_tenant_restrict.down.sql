-- Rollback da 022: volta ao ON DELETE CASCADE original (001). Não altera dados.
-- Depois, apague '022_auditoria_tenant_restrict.sql' de _migrations.
ALTER TABLE eventos_auditoria DROP CONSTRAINT IF EXISTS eventos_auditoria_tenant_id_fkey;
ALTER TABLE eventos_auditoria
  ADD CONSTRAINT eventos_auditoria_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE CASCADE;

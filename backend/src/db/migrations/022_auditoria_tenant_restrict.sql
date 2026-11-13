-- =====================================================
-- 022 — eventos_auditoria.tenant_id: ON DELETE CASCADE -> RESTRICT
-- Apagar um tenant não pode apagar em silêncio a trilha de auditoria dele
-- (a 011 já impede UPDATE/DELETE direto pelo papel da aplicação).
-- Efeito: DELETE de tenant que tenha eventos de auditoria passa a falhar (23503).
-- Nenhum dado é alterado.
-- Rollback: db/migrations/down/022_auditoria_tenant_restrict.down.sql
-- =====================================================

ALTER TABLE eventos_auditoria DROP CONSTRAINT IF EXISTS eventos_auditoria_tenant_id_fkey;
ALTER TABLE eventos_auditoria
  ADD CONSTRAINT eventos_auditoria_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants (id) ON DELETE RESTRICT;

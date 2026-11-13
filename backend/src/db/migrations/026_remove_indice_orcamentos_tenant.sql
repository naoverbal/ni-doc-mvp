-- =====================================================
-- 026 — Remove idx_orcamentos_tenant (tenant_id)
-- É prefixo de índices completos (sem WHERE) que já atendem as mesmas consultas e o FK com tenants:
--   idx_orcamentos_status          (tenant_id, status)
--   idx_orcamentos_tenant_criado_em (tenant_id, criado_em DESC)
--   orcamentos_tenant_id_numero_key (tenant_id, numero) UNIQUE
-- Nenhum dado é alterado.
-- Rollback: db/migrations/down/026_remove_indice_orcamentos_tenant.down.sql
-- =====================================================

DROP INDEX IF EXISTS idx_orcamentos_tenant;

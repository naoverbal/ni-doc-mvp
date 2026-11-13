-- =====================================================
-- 025 — Remove mais índices redundantes
-- Cada índice abaixo é duplicata ou prefixo de outro índice (UNIQUE/PK) que já atende as mesmas
-- consultas e as verificações de FK:
--   idx_aceites_versao        (versao_id)                 = orcamento_aceites_versao_id_key
--   idx_versoes_token         (token_publico)             = orcamento_versoes_token_publico_key
--   idx_versoes_orcamento     (orcamento_id)              prefixo de (orcamento_id, versao) UNIQUE
--   idx_clientes_tenant       (tenant_id)                 prefixo de (tenant_id, documento_hash) UNIQUE
--   idx_templates_tenant      (tenant_id, versao DESC)    = (tenant_id, versao) UNIQUE lido ao contrário
--   idx_usuarios_tenant       (tenant_id)                 prefixo de uq_usuarios_tenant_id (021)
-- Nenhum dado é alterado.
-- Rollback: db/migrations/down/025_remove_indices_redundantes_2.down.sql
-- =====================================================

DROP INDEX IF EXISTS idx_aceites_versao;
DROP INDEX IF EXISTS idx_versoes_token;
DROP INDEX IF EXISTS idx_versoes_orcamento;
DROP INDEX IF EXISTS idx_clientes_tenant;
DROP INDEX IF EXISTS idx_templates_tenant;
DROP INDEX IF EXISTS idx_usuarios_tenant;

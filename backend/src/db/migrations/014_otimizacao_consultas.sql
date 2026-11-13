-- =============================================================================
-- 014 — Otimização de consultas (auditoria de custo de banco)
--
-- Só índices e uma função de manutenção; nenhuma regra de negócio muda.
-- Idempotente (IF NOT EXISTS / DROP IF EXISTS), como as migrations anteriores.
-- =============================================================================

-- Listagem de orçamentos (GET /api/orcamentos): WHERE tenant_id = ? ORDER BY
-- criado_em DESC. O índice evita o sort por tenant a cada página.
CREATE INDEX IF NOT EXISTS idx_orcamentos_tenant_criado_em
  ON orcamentos (tenant_id, criado_em DESC);

-- Job horário de expiração (rls_expirar_orcamentos_vencidos) varre `enviado` de
-- todos os tenants, sem filtro de tenant_id. O índice parcial é pequeno e cobre
-- exatamente esse predicado.
CREATE INDEX IF NOT EXISTS idx_orcamentos_enviado
  ON orcamentos (id)
  WHERE status = 'enviado';

-- Limpeza de sessões expiradas. `sessoes` tem RLS forçado e o job roda fora de
-- escopo de tenant, então a função é SECURITY DEFINER (mesmo padrão da 004/012).
DROP FUNCTION IF EXISTS rls_limpar_sessoes_expiradas();
CREATE FUNCTION rls_limpar_sessoes_expiradas()
RETURNS BIGINT
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
SET search_path = public, pg_temp
AS $$
  WITH removidas AS (
    DELETE FROM sessoes WHERE expira_em < NOW() RETURNING 1
  )
  SELECT COUNT(*) FROM removidas
$$;

REVOKE ALL ON FUNCTION rls_limpar_sessoes_expiradas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls_limpar_sessoes_expiradas() TO ni_doc_app;

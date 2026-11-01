-- =====================================================
-- EXPIRAÇÃO AUTOMÁTICA DE ORÇAMENTOS (RF-009.5, tarefa 66)
--
-- O job de expiração varre orçamentos de TODOS os tenants, mas roda com o papel
-- de aplicação (sujeito ao RLS) e sem `app.current_tenant`. Como na migration
-- 004, o contorno fica restrito a uma função SECURITY DEFINER com uma única
-- operação estrita: marcar como `expirado` os orçamentos `enviado` cuja validade
-- foi atingida e registrar a auditoria na MESMA instrução (atômico).
--
-- Regra de validade: vence em `data_emissao + validade_dias` e vale o dia inteiro;
-- expira às 00:00 do dia seguinte no fuso America/Sao_Paulo. Também respeita o
-- `expira_em` gravado na versão vigente.
--
-- Idempotente e seguro sob concorrência: o UPDATE só atinge linhas ainda
-- `enviado`; uma segunda execução (ou instância simultânea) reavalia o filtro
-- após o lock da linha, não atualiza nada e, portanto, não audita de novo.
-- =====================================================
DROP FUNCTION IF EXISTS rls_expirar_orcamentos_vencidos(TIMESTAMPTZ);
CREATE FUNCTION rls_expirar_orcamentos_vencidos(p_agora TIMESTAMPTZ)
RETURNS TABLE (id_orcamento UUID, id_tenant UUID, numero_orcamento VARCHAR(50))
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  WITH atualizados AS (
    UPDATE orcamentos o
    SET status = 'expirado', atualizado_em = NOW()
    WHERE o.status = 'enviado'
      AND (
        ((o.data_emissao + o.validade_dias + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')
          <= p_agora
        OR EXISTS (
          SELECT 1 FROM orcamento_versoes v
          WHERE v.orcamento_id = o.id
            AND v.versao = o.versao_atual
            AND v.expira_em IS NOT NULL
            AND v.expira_em <= p_agora
        )
      )
    RETURNING o.id AS oid, o.tenant_id AS tid, o.numero AS num
  ),
  auditoria AS (
    INSERT INTO eventos_auditoria (tenant_id, acao, entidade, entidade_id, estado_anterior, estado_novo)
    SELECT a.tid, 'expirar', 'orcamentos', a.oid,
           '{"status": "enviado"}'::jsonb, '{"status": "expirado"}'::jsonb
    FROM atualizados a
  )
  SELECT a.oid, a.tid, a.num FROM atualizados a
$$;

REVOKE ALL ON FUNCTION rls_expirar_orcamentos_vencidos(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls_expirar_orcamentos_vencidos(TIMESTAMPTZ) TO ni_doc_app;

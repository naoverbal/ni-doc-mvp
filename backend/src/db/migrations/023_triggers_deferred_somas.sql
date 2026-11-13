-- =====================================================
-- 023 — Regras que dependem de várias linhas (CONSTRAINT TRIGGER deferred)
--   (1) Soma dos percentuais das condições de pagamento = 100 (lista vazia é permitida;
--       tolerância 0,01, a mesma do zod).
--   (2) orcamentos.subtotal = soma de orcamento_itens.total.
-- A verificação roda no COMMIT, porque o código apaga e reinsere itens/condições em bloco
-- dentro da mesma transação que atualiza o orçamento.
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Rollback: db/migrations/down/023_triggers_deferred_somas.down.sql
-- =====================================================

SET LOCAL row_security = off;

CREATE OR REPLACE FUNCTION pg_temp.exigir_zero(p_regra TEXT, p_consulta TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_qtd BIGINT;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_consulta || ') AS violacoes' INTO v_qtd;
  IF v_qtd > 0 THEN
    RAISE EXCEPTION 'Migration abortada: % linha(s) violam a regra "%". Nenhum dado foi alterado; corrija os dados e rode novamente.',
      v_qtd, p_regra USING ERRCODE = '23514';
  END IF;
END;
$$;

SELECT pg_temp.exigir_zero('condicoes de pagamento: soma dos percentuais por orcamento = 100',
  $q$SELECT 1 FROM orcamento_condicoes_pagamento
       GROUP BY orcamento_id HAVING abs(sum(percentual) - 100) > 0.01$q$);
SELECT pg_temp.exigir_zero('orcamentos.subtotal = soma dos itens',
  $q$SELECT 1 FROM orcamentos o
       WHERE o.subtotal <> COALESCE((SELECT sum(i.total) FROM orcamento_itens i WHERE i.orcamento_id = o.id), 0)$q$);

-- (1) Condições de pagamento ---------------------------------------------------
-- Sem SECURITY DEFINER (não amplia a superfície privilegiada auditada em security-definer.int.ts):
-- o GUC app.current_tenant é local à transação e continua válido quando o trigger deferred roda
-- no COMMIT, então o RLS enxerga as mesmas linhas da escrita.
CREATE OR REPLACE FUNCTION verificar_soma_condicoes_pagamento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
  v_id UUID;
  v_qtd BIGINT;
  v_soma NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.orcamento_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.orcamento_id];
  ELSE
    v_ids := ARRAY[OLD.orcamento_id, NEW.orcamento_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT count(*), COALESCE(sum(percentual), 0) INTO v_qtd, v_soma
    FROM orcamento_condicoes_pagamento WHERE orcamento_id = v_id;
    IF v_qtd > 0 AND abs(v_soma - 100) > 0.01 THEN
      RAISE EXCEPTION 'A soma dos percentuais das condições de pagamento do orçamento % deve ser 100 (atual: %)',
        v_id, v_soma USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ctrg_condicoes_pagamento_soma ON orcamento_condicoes_pagamento;
CREATE CONSTRAINT TRIGGER ctrg_condicoes_pagamento_soma
  AFTER INSERT OR UPDATE OR DELETE ON orcamento_condicoes_pagamento
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_soma_condicoes_pagamento();

-- (2) Subtotal = soma dos itens -----------------------------------------------
CREATE OR REPLACE FUNCTION verificar_subtotal_orcamento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
  v_id UUID;
  v_subtotal NUMERIC;
  v_soma NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'orcamentos' THEN
    v_ids := ARRAY[NEW.id];
  ELSIF TG_OP = 'INSERT' THEN
    v_ids := ARRAY[NEW.orcamento_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_ids := ARRAY[OLD.orcamento_id];
  ELSE
    v_ids := ARRAY[OLD.orcamento_id, NEW.orcamento_id];
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    SELECT subtotal INTO v_subtotal FROM orcamentos WHERE id = v_id;
    IF NOT FOUND THEN
      CONTINUE; -- orçamento removido na mesma transação (itens saem em cascata)
    END IF;
    SELECT COALESCE(sum(total), 0) INTO v_soma FROM orcamento_itens WHERE orcamento_id = v_id;
    IF v_subtotal <> v_soma THEN
      RAISE EXCEPTION 'O subtotal (%) do orçamento % difere da soma dos itens (%)',
        v_subtotal, v_id, v_soma USING ERRCODE = '23514';
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS ctrg_itens_subtotal ON orcamento_itens;
CREATE CONSTRAINT TRIGGER ctrg_itens_subtotal
  AFTER INSERT OR UPDATE OR DELETE ON orcamento_itens
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_subtotal_orcamento();

DROP TRIGGER IF EXISTS ctrg_orcamentos_subtotal ON orcamentos;
CREATE CONSTRAINT TRIGGER ctrg_orcamentos_subtotal
  AFTER INSERT OR UPDATE OF subtotal ON orcamentos
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verificar_subtotal_orcamento();

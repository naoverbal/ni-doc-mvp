-- =====================================================
-- 016 — CHECKs da tabela orcamentos
-- Leva para o banco as regras que hoje só existem no zod / lib de cálculo.
-- Segurança: NENHUM dado é alterado. Se alguma linha existente violar uma regra,
-- a migration aborta (e faz ROLLBACK) com a contagem de linhas ofensoras.
-- Rollback: db/migrations/down/016_checks_orcamentos.down.sql
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

-- Pré-checagens ------------------------------------------------------------
SELECT pg_temp.exigir_zero('orcamentos.validade_dias entre 1 e 3650',
  $q$SELECT 1 FROM orcamentos WHERE NOT (validade_dias BETWEEN 1 AND 3650)$q$);
SELECT pg_temp.exigir_zero('orcamentos.prazo_entrega_dias nulo ou entre 1 e 3650',
  $q$SELECT 1 FROM orcamentos WHERE prazo_entrega_dias IS NOT NULL AND NOT (prazo_entrega_dias BETWEEN 1 AND 3650)$q$);
SELECT pg_temp.exigir_zero('orcamentos.versao_atual >= 0',
  $q$SELECT 1 FROM orcamentos WHERE versao_atual < 0$q$);
SELECT pg_temp.exigir_zero('orcamentos.subtotal >= 0',
  $q$SELECT 1 FROM orcamentos WHERE subtotal < 0$q$);
SELECT pg_temp.exigir_zero('orcamentos.total entre 0 e subtotal',
  $q$SELECT 1 FROM orcamentos WHERE total < 0 OR total > subtotal$q$);
SELECT pg_temp.exigir_zero('orcamentos.desconto_global_valor >= 0 e percentual <= 100',
  $q$SELECT 1 FROM orcamentos WHERE desconto_global_valor < 0
       OR (desconto_global_tipo = 'percentual' AND desconto_global_valor > 100)$q$);
SELECT pg_temp.exigir_zero('orcamentos.titulo nao vazio',
  $q$SELECT 1 FROM orcamentos WHERE titulo = ''$q$);
SELECT pg_temp.exigir_zero('orcamentos: status enviado/aprovado/reprovado/expirado exige versao_atual >= 1',
  $q$SELECT 1 FROM orcamentos
       WHERE status IN ('enviado', 'aprovado', 'reprovado', 'expirado') AND versao_atual < 1$q$);

-- Constraints (NOT VALID + VALIDATE: lock curto, validação sem bloquear escrita) ----
ALTER TABLE orcamentos
  DROP CONSTRAINT IF EXISTS ck_orcamentos_validade_dias,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_prazo_entrega_dias,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_versao_atual,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_subtotal,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_total,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_desconto_global,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_titulo_nao_vazio,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_status_versao;

ALTER TABLE orcamentos
  ADD CONSTRAINT ck_orcamentos_validade_dias
    CHECK (validade_dias BETWEEN 1 AND 3650) NOT VALID,
  ADD CONSTRAINT ck_orcamentos_prazo_entrega_dias
    CHECK (prazo_entrega_dias IS NULL OR prazo_entrega_dias BETWEEN 1 AND 3650) NOT VALID,
  ADD CONSTRAINT ck_orcamentos_versao_atual
    CHECK (versao_atual >= 0) NOT VALID,
  ADD CONSTRAINT ck_orcamentos_subtotal
    CHECK (subtotal >= 0) NOT VALID,
  -- calcularTotal() nunca devolve negativo nem acima do subtotal.
  ADD CONSTRAINT ck_orcamentos_total
    CHECK (total >= 0 AND total <= subtotal) NOT VALID,
  -- Só valor e faixa: o par tipo/valor NÃO é obrigatório (a API aceita um sem o outro).
  ADD CONSTRAINT ck_orcamentos_desconto_global
    CHECK (
      desconto_global_valor IS NULL
      OR (
        desconto_global_valor >= 0
        AND (desconto_global_tipo IS DISTINCT FROM 'percentual' OR desconto_global_valor <= 100)
      )
    ) NOT VALID,
  -- Igual ao zod (min(1), sem trim).
  ADD CONSTRAINT ck_orcamentos_titulo_nao_vazio
    CHECK (titulo <> '') NOT VALID,
  ADD CONSTRAINT ck_orcamentos_status_versao
    CHECK (
      status NOT IN ('enviado', 'aprovado', 'reprovado', 'expirado')
      OR versao_atual >= 1
    ) NOT VALID;

ALTER TABLE orcamentos
  VALIDATE CONSTRAINT ck_orcamentos_validade_dias,
  VALIDATE CONSTRAINT ck_orcamentos_prazo_entrega_dias,
  VALIDATE CONSTRAINT ck_orcamentos_versao_atual,
  VALIDATE CONSTRAINT ck_orcamentos_subtotal,
  VALIDATE CONSTRAINT ck_orcamentos_total,
  VALIDATE CONSTRAINT ck_orcamentos_desconto_global,
  VALIDATE CONSTRAINT ck_orcamentos_titulo_nao_vazio,
  VALIDATE CONSTRAINT ck_orcamentos_status_versao;

-- =====================================================
-- 017 — CHECKs e UNIQUEs de orcamento_itens e orcamento_condicoes_pagamento
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Não há CHECK de itens.total = cálculo (arredondamento float x NUMERIC pode divergir).
-- Rollback: db/migrations/down/017_checks_itens_condicoes.down.sql
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
SELECT pg_temp.exigir_zero('orcamento_itens.quantidade > 0',
  $q$SELECT 1 FROM orcamento_itens WHERE quantidade <= 0$q$);
SELECT pg_temp.exigir_zero('orcamento_itens.valor_unitario >= 0',
  $q$SELECT 1 FROM orcamento_itens WHERE valor_unitario < 0$q$);
SELECT pg_temp.exigir_zero('orcamento_itens.desconto_valor >= 0 e percentual <= 100',
  $q$SELECT 1 FROM orcamento_itens WHERE desconto_valor < 0
       OR (desconto_tipo = 'percentual' AND desconto_valor > 100)$q$);
SELECT pg_temp.exigir_zero('orcamento_itens.total >= 0',
  $q$SELECT 1 FROM orcamento_itens WHERE total < 0$q$);
SELECT pg_temp.exigir_zero('orcamento_itens.nome nao vazio',
  $q$SELECT 1 FROM orcamento_itens WHERE nome = ''$q$);
SELECT pg_temp.exigir_zero('orcamento_itens (orcamento_id, ordem) unico',
  $q$SELECT 1 FROM orcamento_itens GROUP BY orcamento_id, ordem HAVING count(*) > 1$q$);
SELECT pg_temp.exigir_zero('orcamento_condicoes_pagamento.percentual entre 0 e 100',
  $q$SELECT 1 FROM orcamento_condicoes_pagamento WHERE percentual NOT BETWEEN 0 AND 100$q$);
SELECT pg_temp.exigir_zero('orcamento_condicoes_pagamento descricao/forma_pagamento nao vazias',
  $q$SELECT 1 FROM orcamento_condicoes_pagamento WHERE descricao = '' OR forma_pagamento = ''$q$);
SELECT pg_temp.exigir_zero('orcamento_condicoes_pagamento (orcamento_id, ordem) unico',
  $q$SELECT 1 FROM orcamento_condicoes_pagamento GROUP BY orcamento_id, ordem HAVING count(*) > 1$q$);

-- orcamento_itens ----------------------------------------------------------
ALTER TABLE orcamento_itens
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_quantidade,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_valor_unitario,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_desconto,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_total,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_nome_nao_vazio,
  DROP CONSTRAINT IF EXISTS uq_orcamento_itens_ordem;

ALTER TABLE orcamento_itens
  ADD CONSTRAINT ck_orcamento_itens_quantidade CHECK (quantidade > 0) NOT VALID,
  ADD CONSTRAINT ck_orcamento_itens_valor_unitario CHECK (valor_unitario >= 0) NOT VALID,
  -- Só valor e faixa: o par tipo/valor NÃO é obrigatório (a API aceita um sem o outro).
  ADD CONSTRAINT ck_orcamento_itens_desconto
    CHECK (
      desconto_valor IS NULL
      OR (
        desconto_valor >= 0
        AND (desconto_tipo IS DISTINCT FROM 'percentual' OR desconto_valor <= 100)
      )
    ) NOT VALID,
  ADD CONSTRAINT ck_orcamento_itens_total CHECK (total >= 0) NOT VALID,
  ADD CONSTRAINT ck_orcamento_itens_nome_nao_vazio CHECK (nome <> '') NOT VALID;

ALTER TABLE orcamento_itens
  VALIDATE CONSTRAINT ck_orcamento_itens_quantidade,
  VALIDATE CONSTRAINT ck_orcamento_itens_valor_unitario,
  VALIDATE CONSTRAINT ck_orcamento_itens_desconto,
  VALIDATE CONSTRAINT ck_orcamento_itens_total,
  VALIDATE CONSTRAINT ck_orcamento_itens_nome_nao_vazio;

-- Os itens são sempre apagados e reinseridos em bloco, então (orcamento_id, ordem) é único.
ALTER TABLE orcamento_itens
  ADD CONSTRAINT uq_orcamento_itens_ordem UNIQUE (orcamento_id, ordem);

-- orcamento_condicoes_pagamento -------------------------------------------
ALTER TABLE orcamento_condicoes_pagamento
  DROP CONSTRAINT IF EXISTS ck_condicoes_pagamento_percentual,
  DROP CONSTRAINT IF EXISTS ck_condicoes_pagamento_textos_nao_vazios,
  DROP CONSTRAINT IF EXISTS uq_condicoes_pagamento_ordem;

ALTER TABLE orcamento_condicoes_pagamento
  ADD CONSTRAINT ck_condicoes_pagamento_percentual
    CHECK (percentual BETWEEN 0 AND 100) NOT VALID,
  ADD CONSTRAINT ck_condicoes_pagamento_textos_nao_vazios
    CHECK (descricao <> '' AND forma_pagamento <> '') NOT VALID;

ALTER TABLE orcamento_condicoes_pagamento
  VALIDATE CONSTRAINT ck_condicoes_pagamento_percentual,
  VALIDATE CONSTRAINT ck_condicoes_pagamento_textos_nao_vazios;

ALTER TABLE orcamento_condicoes_pagamento
  ADD CONSTRAINT uq_condicoes_pagamento_ordem UNIQUE (orcamento_id, ordem);

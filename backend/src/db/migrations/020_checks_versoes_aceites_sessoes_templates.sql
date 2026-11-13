-- =====================================================
-- 020 — CHECKs de orcamento_versoes, orcamento_aceites, sessoes e templates
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Não há CHECK expira_em > enviado_em: enviado_em usa o relógio do banco e expira_em o do app,
-- então uma diferença de relógio geraria erro 500 em envio válido.
-- Rollback: db/migrations/down/020_checks_versoes_aceites_sessoes_templates.down.sql
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

SELECT pg_temp.exigir_zero('orcamento_versoes.versao >= 1',
  $q$SELECT 1 FROM orcamento_versoes WHERE versao < 1$q$);
SELECT pg_temp.exigir_zero('orcamento_versoes: pdf_path e pdf_hash juntos',
  $q$SELECT 1 FROM orcamento_versoes WHERE (pdf_path IS NULL) <> (pdf_hash IS NULL)$q$);
SELECT pg_temp.exigir_zero('orcamento_aceites: comprovante_pdf_path e comprovante_pdf_hash juntos',
  $q$SELECT 1 FROM orcamento_aceites WHERE (comprovante_pdf_path IS NULL) <> (comprovante_pdf_hash IS NULL)$q$);
SELECT pg_temp.exigir_zero('orcamento_aceites: metodo operador exige usuario_id e justificativa',
  $q$SELECT 1 FROM orcamento_aceites
       WHERE metodo = 'operador' AND (usuario_id IS NULL OR justificativa IS NULL OR btrim(justificativa) = '')$q$);
SELECT pg_temp.exigir_zero('orcamento_aceites: metodo cliente sem usuario_id',
  $q$SELECT 1 FROM orcamento_aceites WHERE metodo = 'cliente' AND usuario_id IS NOT NULL$q$);
SELECT pg_temp.exigir_zero('sessoes.expira_em > criado_em',
  $q$SELECT 1 FROM sessoes WHERE expira_em <= criado_em$q$);
SELECT pg_temp.exigir_zero('templates.versao >= 1',
  $q$SELECT 1 FROM templates WHERE versao < 1$q$);
SELECT pg_temp.exigir_zero('templates.layout_json e objeto JSON',
  $q$SELECT 1 FROM templates WHERE jsonb_typeof(layout_json) <> 'object'$q$);

ALTER TABLE orcamento_versoes
  DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_versao,
  DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_pdf_par;
ALTER TABLE orcamento_versoes
  ADD CONSTRAINT ck_orcamento_versoes_versao CHECK (versao >= 1) NOT VALID,
  -- inserção e limpeza (jobs/limpar-pdfs.ts) tratam caminho e hash sempre juntos.
  ADD CONSTRAINT ck_orcamento_versoes_pdf_par CHECK ((pdf_path IS NULL) = (pdf_hash IS NULL)) NOT VALID;
ALTER TABLE orcamento_versoes
  VALIDATE CONSTRAINT ck_orcamento_versoes_versao,
  VALIDATE CONSTRAINT ck_orcamento_versoes_pdf_par;

ALTER TABLE orcamento_aceites
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_comprovante_par,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_operador,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_cliente;
ALTER TABLE orcamento_aceites
  ADD CONSTRAINT ck_orcamento_aceites_comprovante_par
    CHECK ((comprovante_pdf_path IS NULL) = (comprovante_pdf_hash IS NULL)) NOT VALID,
  -- RF-020.1: aceite manual exige operador e justificativa preenchida.
  ADD CONSTRAINT ck_orcamento_aceites_operador
    CHECK (
      metodo <> 'operador'
      OR (usuario_id IS NOT NULL AND justificativa IS NOT NULL AND btrim(justificativa) <> '')
    ) NOT VALID,
  -- Aceite do cliente (link público) não tem usuário logado.
  ADD CONSTRAINT ck_orcamento_aceites_cliente
    CHECK (metodo <> 'cliente' OR usuario_id IS NULL) NOT VALID;
ALTER TABLE orcamento_aceites
  VALIDATE CONSTRAINT ck_orcamento_aceites_comprovante_par,
  VALIDATE CONSTRAINT ck_orcamento_aceites_operador,
  VALIDATE CONSTRAINT ck_orcamento_aceites_cliente;

ALTER TABLE sessoes DROP CONSTRAINT IF EXISTS ck_sessoes_expira_apos_criacao;
ALTER TABLE sessoes
  ADD CONSTRAINT ck_sessoes_expira_apos_criacao CHECK (expira_em > criado_em) NOT VALID;
ALTER TABLE sessoes VALIDATE CONSTRAINT ck_sessoes_expira_apos_criacao;

ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS ck_templates_versao,
  DROP CONSTRAINT IF EXISTS ck_templates_layout_objeto;
ALTER TABLE templates
  ADD CONSTRAINT ck_templates_versao CHECK (versao >= 1) NOT VALID,
  ADD CONSTRAINT ck_templates_layout_objeto CHECK (jsonb_typeof(layout_json) = 'object') NOT VALID;
ALTER TABLE templates
  VALIDATE CONSTRAINT ck_templates_versao,
  VALIDATE CONSTRAINT ck_templates_layout_objeto;

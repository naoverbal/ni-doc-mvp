-- Rollback da 020. Não altera dados.
-- Depois, apague '020_checks_versoes_aceites_sessoes_templates.sql' de _migrations.
ALTER TABLE orcamento_versoes
  DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_versao,
  DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_pdf_par;
ALTER TABLE orcamento_aceites
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_comprovante_par,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_operador,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_cliente;
ALTER TABLE sessoes DROP CONSTRAINT IF EXISTS ck_sessoes_expira_apos_criacao;
ALTER TABLE templates
  DROP CONSTRAINT IF EXISTS ck_templates_versao,
  DROP CONSTRAINT IF EXISTS ck_templates_layout_objeto;

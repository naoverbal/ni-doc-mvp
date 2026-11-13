-- Rollback da 019. Não altera dados. Depois, apague '019_checks_hashes.sql' de _migrations.
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_email_hash_formato;
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS ck_clientes_documento_hash_formato;
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS ck_empresas_cnpj_hash_formato;
ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS ck_orcamentos_conteudo_hash_formato;
ALTER TABLE orcamento_versoes DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_pdf_hash_formato;
ALTER TABLE orcamento_aceites
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_hash_documento_formato,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_comprovante_hash_formato;

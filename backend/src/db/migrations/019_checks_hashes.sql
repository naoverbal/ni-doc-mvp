-- =====================================================
-- 019 — Formato dos hashes SHA-256 (64 caracteres hex minúsculos)
-- O código gera todos com createHash('sha256').digest('hex').
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Rollback: db/migrations/down/019_checks_hashes.down.sql
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

SELECT pg_temp.exigir_zero('usuarios.email_hash hex64',
  $q$SELECT 1 FROM usuarios WHERE email_hash !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('clientes.documento_hash hex64',
  $q$SELECT 1 FROM clientes WHERE documento_hash !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('empresas.cnpj_hash hex64',
  $q$SELECT 1 FROM empresas WHERE cnpj_hash IS NOT NULL AND cnpj_hash !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('orcamentos.conteudo_hash hex64',
  $q$SELECT 1 FROM orcamentos WHERE conteudo_hash IS NOT NULL AND conteudo_hash !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('orcamento_versoes.pdf_hash hex64',
  $q$SELECT 1 FROM orcamento_versoes WHERE pdf_hash IS NOT NULL AND pdf_hash !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('orcamento_aceites.hash_documento hex64',
  $q$SELECT 1 FROM orcamento_aceites WHERE hash_documento !~ '^[0-9a-f]{64}$'$q$);
SELECT pg_temp.exigir_zero('orcamento_aceites.comprovante_pdf_hash hex64',
  $q$SELECT 1 FROM orcamento_aceites WHERE comprovante_pdf_hash IS NOT NULL AND comprovante_pdf_hash !~ '^[0-9a-f]{64}$'$q$);

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_email_hash_formato;
ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuarios_email_hash_formato CHECK (email_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE usuarios VALIDATE CONSTRAINT ck_usuarios_email_hash_formato;

ALTER TABLE clientes DROP CONSTRAINT IF EXISTS ck_clientes_documento_hash_formato;
ALTER TABLE clientes
  ADD CONSTRAINT ck_clientes_documento_hash_formato CHECK (documento_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE clientes VALIDATE CONSTRAINT ck_clientes_documento_hash_formato;

ALTER TABLE empresas DROP CONSTRAINT IF EXISTS ck_empresas_cnpj_hash_formato;
ALTER TABLE empresas
  ADD CONSTRAINT ck_empresas_cnpj_hash_formato
    CHECK (cnpj_hash IS NULL OR cnpj_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE empresas VALIDATE CONSTRAINT ck_empresas_cnpj_hash_formato;

ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS ck_orcamentos_conteudo_hash_formato;
ALTER TABLE orcamentos
  ADD CONSTRAINT ck_orcamentos_conteudo_hash_formato
    CHECK (conteudo_hash IS NULL OR conteudo_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE orcamentos VALIDATE CONSTRAINT ck_orcamentos_conteudo_hash_formato;

ALTER TABLE orcamento_versoes DROP CONSTRAINT IF EXISTS ck_orcamento_versoes_pdf_hash_formato;
ALTER TABLE orcamento_versoes
  ADD CONSTRAINT ck_orcamento_versoes_pdf_hash_formato
    CHECK (pdf_hash IS NULL OR pdf_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE orcamento_versoes VALIDATE CONSTRAINT ck_orcamento_versoes_pdf_hash_formato;

ALTER TABLE orcamento_aceites
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_hash_documento_formato,
  DROP CONSTRAINT IF EXISTS ck_orcamento_aceites_comprovante_hash_formato;
ALTER TABLE orcamento_aceites
  ADD CONSTRAINT ck_orcamento_aceites_hash_documento_formato
    CHECK (hash_documento ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT ck_orcamento_aceites_comprovante_hash_formato
    CHECK (comprovante_pdf_hash IS NULL OR comprovante_pdf_hash ~ '^[0-9a-f]{64}$') NOT VALID;
ALTER TABLE orcamento_aceites
  VALIDATE CONSTRAINT ck_orcamento_aceites_hash_documento_formato,
  VALIDATE CONSTRAINT ck_orcamento_aceites_comprovante_hash_formato;

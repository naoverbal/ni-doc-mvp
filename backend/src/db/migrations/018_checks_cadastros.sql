-- =====================================================
-- 018 — CHECKs dos cadastros (clientes, empresas, responsáveis, usuários)
-- Iguais ao zod: nome com min(1), sem trim (o banco não pode ser mais rígido que a API).
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Rollback: db/migrations/down/018_checks_cadastros.down.sql
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

SELECT pg_temp.exigir_zero('clientes.nome nao vazio',
  $q$SELECT 1 FROM clientes WHERE nome = ''$q$);
SELECT pg_temp.exigir_zero('empresas.razao_social nao vazia',
  $q$SELECT 1 FROM empresas WHERE razao_social = ''$q$);
SELECT pg_temp.exigir_zero('empresas: cnpj_hash e cnpj_encrypted juntos',
  $q$SELECT 1 FROM empresas WHERE (cnpj_hash IS NULL) <> (cnpj_encrypted IS NULL)$q$);
SELECT pg_temp.exigir_zero('responsaveis_tecnicos.nome nao vazio',
  $q$SELECT 1 FROM responsaveis_tecnicos WHERE nome = ''$q$);
SELECT pg_temp.exigir_zero('usuarios.nome nao vazio',
  $q$SELECT 1 FROM usuarios WHERE nome = ''$q$);

ALTER TABLE clientes DROP CONSTRAINT IF EXISTS ck_clientes_nome_nao_vazio;
ALTER TABLE clientes
  ADD CONSTRAINT ck_clientes_nome_nao_vazio CHECK (nome <> '') NOT VALID;
ALTER TABLE clientes VALIDATE CONSTRAINT ck_clientes_nome_nao_vazio;

ALTER TABLE empresas
  DROP CONSTRAINT IF EXISTS ck_empresas_razao_social_nao_vazia,
  DROP CONSTRAINT IF EXISTS ck_empresas_cnpj_par;
ALTER TABLE empresas
  ADD CONSTRAINT ck_empresas_razao_social_nao_vazia CHECK (razao_social <> '') NOT VALID,
  -- hash (busca/UNIQUE) e texto cifrado são gravados sempre juntos.
  ADD CONSTRAINT ck_empresas_cnpj_par CHECK ((cnpj_hash IS NULL) = (cnpj_encrypted IS NULL)) NOT VALID;
ALTER TABLE empresas
  VALIDATE CONSTRAINT ck_empresas_razao_social_nao_vazia,
  VALIDATE CONSTRAINT ck_empresas_cnpj_par;

ALTER TABLE responsaveis_tecnicos DROP CONSTRAINT IF EXISTS ck_responsaveis_nome_nao_vazio;
ALTER TABLE responsaveis_tecnicos
  ADD CONSTRAINT ck_responsaveis_nome_nao_vazio CHECK (nome <> '') NOT VALID;
ALTER TABLE responsaveis_tecnicos VALIDATE CONSTRAINT ck_responsaveis_nome_nao_vazio;

ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_nome_nao_vazio;
ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuarios_nome_nao_vazio CHECK (nome <> '') NOT VALID;
ALTER TABLE usuarios VALIDATE CONSTRAINT ck_usuarios_nome_nao_vazio;

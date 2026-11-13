-- Rollback da 018. Não altera dados. Depois, apague '018_checks_cadastros.sql' de _migrations.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS ck_clientes_nome_nao_vazio;
ALTER TABLE empresas
  DROP CONSTRAINT IF EXISTS ck_empresas_razao_social_nao_vazia,
  DROP CONSTRAINT IF EXISTS ck_empresas_cnpj_par;
ALTER TABLE responsaveis_tecnicos DROP CONSTRAINT IF EXISTS ck_responsaveis_nome_nao_vazio;
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS ck_usuarios_nome_nao_vazio;

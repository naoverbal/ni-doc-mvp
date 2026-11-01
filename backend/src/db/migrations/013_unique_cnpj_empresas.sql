-- =====================================================
-- CNPJ ÚNICO POR TENANT EM EMPRESAS
--
-- O serviço checava a duplicidade de CNPJ antes do INSERT, sem garantia no
-- banco: dois cadastros simultâneos com o mesmo CNPJ passavam juntos pela
-- checagem e criavam duas empresas. Este índice único impede o registro
-- duplicado, inclusive em requisições simultâneas; a aplicação traduz a
-- violação (23505) em 409. Empresas sem CNPJ ficam fora do índice.
--
-- Antes de aplicar em um banco existente, confira se há duplicatas (o índice
-- falha se houver):
--   SELECT tenant_id, cnpj_hash, COUNT(*), array_agg(id ORDER BY criado_em)
--   FROM empresas WHERE cnpj_hash IS NOT NULL
--   GROUP BY tenant_id, cnpj_hash HAVING COUNT(*) > 1;
--
-- Idempotente: DROP INDEX IF EXISTS antes de recriar.
-- =====================================================
DROP INDEX IF EXISTS uq_empresas_cnpj;
CREATE UNIQUE INDEX uq_empresas_cnpj
  ON empresas (tenant_id, cnpj_hash)
  WHERE cnpj_hash IS NOT NULL;

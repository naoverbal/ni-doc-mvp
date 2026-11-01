-- =====================================================
-- 003: (vazia de propósito) — seed de desenvolvimento movido para fora das migrations
--
-- Esta migration inseria tenants, responsáveis técnicos e templates de
-- DEMONSTRAÇÃO (Tenant Alpha/Beta, UUIDs fixos) em qualquer banco que recebesse
-- `npm run migrate`, inclusive produção (auditoria B-12). Esses dados agora vivem
-- em `src/db/seed-dev.sql`, executado apenas por `npm run seed` (bloqueado em
-- NODE_ENV=production).
--
-- O arquivo continua existindo, com o mesmo nome, porque o `migrate.ts` controla
-- as migrations aplicadas pelo NOME: bancos que já a executaram a veem como feita
-- e os novos a executam sem efeito. Não apaga nem altera dados já existentes.
-- =====================================================

SELECT 1;

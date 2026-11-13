-- Rollback da 016: remove os CHECKs de orcamentos. Não altera dados.
-- Não é executado pelo migrate.ts (que só lê a pasta migrations/, sem recursão).
-- Depois de rodar, apague a linha de '016_checks_orcamentos.sql' em _migrations.
ALTER TABLE orcamentos
  DROP CONSTRAINT IF EXISTS ck_orcamentos_validade_dias,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_prazo_entrega_dias,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_versao_atual,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_subtotal,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_total,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_desconto_global,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_titulo_nao_vazio,
  DROP CONSTRAINT IF EXISTS ck_orcamentos_status_versao;

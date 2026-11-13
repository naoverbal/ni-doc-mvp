-- =====================================================
-- 024 — Remove índices redundantes
-- idx_itens_orcamento e idx_condicoes_pagamento_orcamento indexam (orcamento_id, ordem),
-- as mesmas colunas e a mesma ordem dos UNIQUE criados na 017
-- (uq_orcamento_itens_ordem e uq_condicoes_pagamento_ordem), que já servem as mesmas consultas.
-- Manter os dois só custaria escrita e espaço. Nenhum dado é alterado.
-- Rollback: db/migrations/down/024_remove_indices_redundantes.down.sql
-- =====================================================

DROP INDEX IF EXISTS idx_itens_orcamento;
DROP INDEX IF EXISTS idx_condicoes_pagamento_orcamento;

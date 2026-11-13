-- Rollback da 024: recria os índices removidos (definições originais da 001 e da 005).
-- Depois, apague '024_remove_indices_redundantes.sql' de _migrations.
CREATE INDEX IF NOT EXISTS idx_itens_orcamento ON orcamento_itens(orcamento_id, ordem);
CREATE INDEX IF NOT EXISTS idx_condicoes_pagamento_orcamento
  ON orcamento_condicoes_pagamento(orcamento_id, ordem);

-- Rollback da 017. Não altera dados. Depois, apague '017_checks_itens_condicoes.sql' de _migrations.
ALTER TABLE orcamento_itens
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_quantidade,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_valor_unitario,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_desconto,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_total,
  DROP CONSTRAINT IF EXISTS ck_orcamento_itens_nome_nao_vazio,
  DROP CONSTRAINT IF EXISTS uq_orcamento_itens_ordem;

ALTER TABLE orcamento_condicoes_pagamento
  DROP CONSTRAINT IF EXISTS ck_condicoes_pagamento_percentual,
  DROP CONSTRAINT IF EXISTS ck_condicoes_pagamento_textos_nao_vazios,
  DROP CONSTRAINT IF EXISTS uq_condicoes_pagamento_ordem;

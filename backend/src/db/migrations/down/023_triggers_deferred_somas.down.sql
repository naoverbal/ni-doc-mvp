-- Rollback da 023. Não altera dados. Depois, apague '023_triggers_deferred_somas.sql' de _migrations.
DROP TRIGGER IF EXISTS ctrg_orcamentos_subtotal ON orcamentos;
DROP TRIGGER IF EXISTS ctrg_itens_subtotal ON orcamento_itens;
DROP TRIGGER IF EXISTS ctrg_condicoes_pagamento_soma ON orcamento_condicoes_pagamento;
DROP FUNCTION IF EXISTS verificar_subtotal_orcamento();
DROP FUNCTION IF EXISTS verificar_soma_condicoes_pagamento();

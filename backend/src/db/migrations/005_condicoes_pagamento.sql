-- =====================================================
-- CONDIÇÕES DE PAGAMENTO ESTRUTURADAS + PRAZO DE ENTREGA (RF-005, RF-006, RF-007)
--
-- Substitui o texto livre `orcamentos.condicoes_pagamento` por uma lista
-- estruturada de condições (percentual, marco, forma de pagamento) e adiciona
-- `prazo_entrega_dias` ao orçamento. A coluna de texto `condicoes_pagamento` é
-- MANTIDA: o pipeline de snapshot/PDF (tasks 36–40) ainda a consome como
-- placeholder {condicoes_pagamento}; descontinuá-la fica fora do escopo atômico
-- desta tarefa.
--
-- O nome do arquivo da tarefa era `004_condicoes_pagamento.sql`, mas já existe
-- `004_rls_app_role.sql`; como as migrations rodam em ordem alfabética e devem
-- ser aplicadas APÓS a 004, esta migration é numerada `005`.
--
-- Idempotente: `DROP ... IF EXISTS` / `ADD COLUMN IF NOT EXISTS` /
-- `CREATE TABLE IF NOT EXISTS` antes de criar; policies de RLS são precedidas de
-- `DROP POLICY IF EXISTS` (PostgreSQL não suporta `CREATE POLICY IF NOT EXISTS`).
-- =====================================================

-- Prazo de entrega (em dias) do orçamento — opcional.
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS prazo_entrega_dias INTEGER;

-- =====================================================
-- CONDIÇÕES DE PAGAMENTO (lista estruturada por orçamento)
-- Espelha `orcamento_itens`: sem `tenant_id` direta (via orcamentos),
-- ON DELETE CASCADE, `ordem` 1-based e índice por (orcamento_id, ordem).
-- =====================================================
CREATE TABLE IF NOT EXISTS orcamento_condicoes_pagamento (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  orcamento_id UUID NOT NULL REFERENCES orcamentos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL,
  descricao TEXT NOT NULL,
  percentual NUMERIC(5,2) NOT NULL,
  marco TEXT,
  forma_pagamento TEXT NOT NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_condicoes_pagamento_orcamento
  ON orcamento_condicoes_pagamento(orcamento_id, ordem);

-- =====================================================
-- RLS — isolamento via EXISTS contra orcamentos (espelha orcamento_itens).
-- =====================================================
ALTER TABLE orcamento_condicoes_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE orcamento_condicoes_pagamento FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS orcamento_condicoes_pagamento_tenant_isolation ON orcamento_condicoes_pagamento;
CREATE POLICY orcamento_condicoes_pagamento_tenant_isolation ON orcamento_condicoes_pagamento
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_condicoes_pagamento.orcamento_id
      AND o.tenant_id = current_setting('app.current_tenant', TRUE)::uuid
  ));

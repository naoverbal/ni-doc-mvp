-- =====================================================
-- REABERTURA DE ORÇAMENTOS (RF-008, RF-009, RF-019, tarefa 68)
--
-- 1. `orcamentos.status_reaberto_de`: guarda o status de ORIGEM (reprovado,
--    cancelado ou expirado) enquanto o orçamento reaberto está em `rascunho`.
--    É o que permite, ao excluir esse rascunho, devolver o orçamento ao último
--    status em vez de apagá-lo. Fica NULL em rascunhos que nunca foram enviados
--    e é limpo quando o rascunho reaberto é reenviado ou descartado.
--
-- 2. Defesa no banco contra perda de histórico: `orcamento_versoes` e
--    `orcamento_aceites` passam de ON DELETE CASCADE para RESTRICT. Nenhum
--    caminho (nem uma exclusão de orçamento) apaga versões, PDFs ou aceites em
--    cascata; o histórico só sai por uma remoção explícita e deliberada.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS e DROP CONSTRAINT IF EXISTS antes de
-- recriar cada constraint.
-- =====================================================

-- ---------- 1. Status de origem da reabertura ----------
ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS status_reaberto_de VARCHAR(20);

ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS ck_orcamentos_status_reaberto_de;
ALTER TABLE orcamentos ADD CONSTRAINT ck_orcamentos_status_reaberto_de
  CHECK (
    status_reaberto_de IS NULL
    OR (status = 'rascunho' AND status_reaberto_de IN ('reprovado', 'cancelado', 'expirado'))
  );

-- ---------- 2. Histórico protegido contra exclusão em cascata ----------
ALTER TABLE orcamento_versoes DROP CONSTRAINT IF EXISTS orcamento_versoes_orcamento_id_fkey;
ALTER TABLE orcamento_versoes ADD CONSTRAINT orcamento_versoes_orcamento_id_fkey
  FOREIGN KEY (orcamento_id) REFERENCES orcamentos(id) ON DELETE RESTRICT;

ALTER TABLE orcamento_aceites DROP CONSTRAINT IF EXISTS orcamento_aceites_versao_id_fkey;
ALTER TABLE orcamento_aceites ADD CONSTRAINT orcamento_aceites_versao_id_fkey
  FOREIGN KEY (versao_id) REFERENCES orcamento_versoes(id) ON DELETE RESTRICT;

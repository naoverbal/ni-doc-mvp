-- =====================================================
-- INTEGRIDADE DE ORÇAMENTOS (RF-002, RF-005, tarefa 65)
--
-- 1. Referência entre tenants. A FK do Postgres ignora o RLS: um orçamento do
--    tenant A conseguia apontar para cliente/empresa/responsável do tenant B.
--    A aplicação valida (409) antes de gravar; os triggers abaixo são a defesa
--    no banco. Optou-se por trigger em vez de FK composta (tenant_id, id)
--    porque `orcamento_itens` não tem `tenant_id` (o tenant vem do orçamento) e
--    a FK composta exigiria denormalizar a coluna e recriar as FKs existentes.
--
-- 2. Orçamento duplicado. `conteudo_hash` guarda o SHA-256 do conteúdo
--    (cliente + título + itens), calculado pela aplicação. O índice único
--    parcial (tenant, usuário, hash) impede o mesmo usuário de criar o mesmo
--    orçamento duas vezes, inclusive em requisições simultâneas. Linhas
--    anteriores a esta migration ficam com hash NULL e fora do índice;
--    orçamentos cancelados também saem dele (podem ser recriados).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION e
-- DROP ... IF EXISTS antes de recriar triggers e índice.
-- =====================================================

-- ---------- 1. Referências do mesmo tenant ----------

CREATE OR REPLACE FUNCTION validar_referencias_orcamento() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = NEW.cliente_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'cliente % pertence a outro tenant ou não existe', NEW.cliente_id
      USING ERRCODE = '23503';
  END IF;

  IF NEW.empresa_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM empresas WHERE id = NEW.empresa_cliente_id AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'empresa % pertence a outro tenant ou não existe', NEW.empresa_cliente_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orcamentos_validar_referencias ON orcamentos;
CREATE TRIGGER trg_orcamentos_validar_referencias
  BEFORE INSERT OR UPDATE OF tenant_id, cliente_id, empresa_cliente_id ON orcamentos
  FOR EACH ROW EXECUTE FUNCTION validar_referencias_orcamento();

CREATE OR REPLACE FUNCTION validar_responsavel_item_orcamento() RETURNS trigger AS $$
BEGIN
  IF NEW.responsavel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM responsaveis_tecnicos r
    JOIN orcamentos o ON o.tenant_id = r.tenant_id
    WHERE r.id = NEW.responsavel_id AND o.id = NEW.orcamento_id
  ) THEN
    RAISE EXCEPTION 'responsável % pertence a outro tenant ou não existe', NEW.responsavel_id
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orcamento_itens_validar_responsavel ON orcamento_itens;
CREATE TRIGGER trg_orcamento_itens_validar_responsavel
  BEFORE INSERT OR UPDATE OF orcamento_id, responsavel_id ON orcamento_itens
  FOR EACH ROW EXECUTE FUNCTION validar_responsavel_item_orcamento();

-- ---------- 2. Orçamento duplicado ----------

ALTER TABLE orcamentos ADD COLUMN IF NOT EXISTS conteudo_hash CHAR(64);

DROP INDEX IF EXISTS uq_orcamentos_conteudo;
CREATE UNIQUE INDEX uq_orcamentos_conteudo
  ON orcamentos (tenant_id, usuario_id, conteudo_hash)
  WHERE conteudo_hash IS NOT NULL AND status <> 'cancelado';

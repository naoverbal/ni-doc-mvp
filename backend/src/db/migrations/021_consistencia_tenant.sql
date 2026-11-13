-- =====================================================
-- 021 — Consistência de tenant entre tabelas
-- O FK simples só garante que a linha referenciada existe, não que é do mesmo tenant.
-- Aqui: FKs compostos (tenant_id, id) onde a tabela filha já tem tenant_id, e um
-- trigger (mesmo padrão da 007) para orcamento_versoes.template_id, que não tem tenant_id.
-- Nenhum dado é alterado: violação existente aborta a migration (ROLLBACK).
-- Rollback: db/migrations/down/021_consistencia_tenant.down.sql
-- =====================================================

SET LOCAL row_security = off;

CREATE OR REPLACE FUNCTION pg_temp.exigir_zero(p_regra TEXT, p_consulta TEXT)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_qtd BIGINT;
BEGIN
  EXECUTE 'SELECT count(*) FROM (' || p_consulta || ') AS violacoes' INTO v_qtd;
  IF v_qtd > 0 THEN
    RAISE EXCEPTION 'Migration abortada: % linha(s) violam a regra "%". Nenhum dado foi alterado; corrija os dados e rode novamente.',
      v_qtd, p_regra USING ERRCODE = '23514';
  END IF;
END;
$$;

SELECT pg_temp.exigir_zero('orcamentos.usuario_id deve ser do mesmo tenant',
  $q$SELECT 1 FROM orcamentos o JOIN usuarios u ON u.id = o.usuario_id WHERE u.tenant_id <> o.tenant_id$q$);
SELECT pg_temp.exigir_zero('tenants_template_ativo.template_id deve ser do mesmo tenant',
  $q$SELECT 1 FROM tenants_template_ativo a JOIN templates t ON t.id = a.template_id WHERE t.tenant_id <> a.tenant_id$q$);
SELECT pg_temp.exigir_zero('eventos_auditoria.usuario_id deve ser do mesmo tenant',
  $q$SELECT 1 FROM eventos_auditoria e JOIN usuarios u ON u.id = e.usuario_id WHERE u.tenant_id <> e.tenant_id$q$);
SELECT pg_temp.exigir_zero('orcamento_versoes.template_id deve ser do mesmo tenant do orcamento',
  $q$SELECT 1 FROM orcamento_versoes v
       JOIN orcamentos o ON o.id = v.orcamento_id
       JOIN templates t ON t.id = v.template_id
       WHERE t.tenant_id <> o.tenant_id$q$);

-- Alvos dos FKs compostos (redundantes com a PK, mas exigidos pelo Postgres) ------
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS uq_usuarios_tenant_id;
ALTER TABLE usuarios ADD CONSTRAINT uq_usuarios_tenant_id UNIQUE (tenant_id, id);
ALTER TABLE templates DROP CONSTRAINT IF EXISTS uq_templates_tenant_id;
ALTER TABLE templates ADD CONSTRAINT uq_templates_tenant_id UNIQUE (tenant_id, id);

-- FKs compostos (os FKs simples existentes continuam) ----------------------------
ALTER TABLE orcamentos DROP CONSTRAINT IF EXISTS fk_orcamentos_usuario_tenant;
ALTER TABLE orcamentos
  ADD CONSTRAINT fk_orcamentos_usuario_tenant
    FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE orcamentos VALIDATE CONSTRAINT fk_orcamentos_usuario_tenant;

ALTER TABLE tenants_template_ativo DROP CONSTRAINT IF EXISTS fk_tenants_template_ativo_tenant;
ALTER TABLE tenants_template_ativo
  ADD CONSTRAINT fk_tenants_template_ativo_tenant
    FOREIGN KEY (tenant_id, template_id) REFERENCES templates (tenant_id, id) NOT VALID;
ALTER TABLE tenants_template_ativo VALIDATE CONSTRAINT fk_tenants_template_ativo_tenant;

-- usuario_id é opcional na auditoria (ex.: expiração automática): com MATCH SIMPLE
-- (padrão) o FK não é verificado quando usuario_id é NULL.
ALTER TABLE eventos_auditoria DROP CONSTRAINT IF EXISTS fk_eventos_auditoria_usuario_tenant;
ALTER TABLE eventos_auditoria
  ADD CONSTRAINT fk_eventos_auditoria_usuario_tenant
    FOREIGN KEY (tenant_id, usuario_id) REFERENCES usuarios (tenant_id, id) NOT VALID;
ALTER TABLE eventos_auditoria VALIDATE CONSTRAINT fk_eventos_auditoria_usuario_tenant;

-- orcamento_versoes não tem tenant_id: valida via trigger, como a 007 faz com cliente/empresa.
CREATE OR REPLACE FUNCTION validar_template_versao_orcamento() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM templates t
    JOIN orcamentos o ON o.tenant_id = t.tenant_id
    WHERE t.id = NEW.template_id AND o.id = NEW.orcamento_id
  ) THEN
    RAISE EXCEPTION 'template % pertence a outro tenant ou não existe', NEW.template_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_orcamento_versoes_validar_template ON orcamento_versoes;
CREATE TRIGGER trg_orcamento_versoes_validar_template
  BEFORE INSERT ON orcamento_versoes
  FOR EACH ROW EXECUTE FUNCTION validar_template_versao_orcamento();

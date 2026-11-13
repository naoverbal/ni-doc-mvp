-- =============================================================================
-- 015 — Comprovante do aceite persistido + suporte aos jobs de manutenção de PDFs
--
-- 1) O comprovante PDF do aceite (RF-021) era gerado e devolvido na resposta, mas
--    o caminho e o hash não eram gravados em nenhuma tabela. Sem referência no
--    banco, nada sabia que o arquivo existe (impossível reconciliar ou aplicar
--    retenção). As colunas abaixo guardam essa referência. Ficam NULL para aceites
--    anteriores a esta migration e para reprovações (que não geram comprovante).
--
-- 2) `orcamento_aceites` é imutável para o papel de aplicação (migration 011: sem
--    UPDATE). O comprovante é gerado DEPOIS do commit do aceite (PDF é chamada
--    externa e fica fora da transação), então a aplicação precisa preencher essas
--    duas colunas — e só elas. Um trigger garante "grava uma vez": depois de
--    preenchido, o comprovante não pode ser trocado nem apagado.
--
-- 3) O job de limpeza de PDFs varre versões de TODOS os tenants, mas roda com o
--    papel de aplicação (sem BYPASSRLS) e fora de escopo de tenant: o RLS
--    escondia todas as linhas. A listagem passa a ser feita por uma função
--    SECURITY DEFINER somente-leitura (mesmo padrão da 004/008/014). A escrita
--    (zerar a referência + auditoria) continua sob o escopo do tenant da versão.
--
-- Idempotente, como as migrations anteriores.
-- =============================================================================

ALTER TABLE orcamento_aceites ADD COLUMN IF NOT EXISTS comprovante_pdf_path TEXT;
ALTER TABLE orcamento_aceites ADD COLUMN IF NOT EXISTS comprovante_pdf_hash CHAR(64);

GRANT UPDATE (comprovante_pdf_path, comprovante_pdf_hash) ON orcamento_aceites TO ni_doc_app;

DROP FUNCTION IF EXISTS orcamento_aceites_comprovante_grava_uma_vez();
CREATE FUNCTION orcamento_aceites_comprovante_grava_uma_vez()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.comprovante_pdf_path IS NOT NULL
     AND (NEW.comprovante_pdf_path IS DISTINCT FROM OLD.comprovante_pdf_path
          OR NEW.comprovante_pdf_hash IS DISTINCT FROM OLD.comprovante_pdf_hash) THEN
    RAISE EXCEPTION 'O comprovante do aceite já foi gravado e é imutável';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_orcamento_aceites_comprovante ON orcamento_aceites;
CREATE TRIGGER trg_orcamento_aceites_comprovante
  BEFORE UPDATE ON orcamento_aceites
  FOR EACH ROW EXECUTE FUNCTION orcamento_aceites_comprovante_grava_uma_vez();

-- Versões cujo PDF passou da retenção (enviado_em < p_limite) e ainda têm arquivo
-- referenciado. Somente leitura; devolve o tenant de cada versão para que o job
-- grave a limpeza e a auditoria sob o escopo correto.
DROP FUNCTION IF EXISTS rls_listar_pdfs_expirados(TIMESTAMPTZ);
CREATE FUNCTION rls_listar_pdfs_expirados(p_limite TIMESTAMPTZ)
RETURNS TABLE (
  versao_id UUID,
  orcamento_id UUID,
  tenant_id UUID,
  numero VARCHAR,
  versao INTEGER,
  pdf_path TEXT,
  enviado_em TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET row_security = off
SET search_path = public, pg_temp
AS $$
  SELECT v.id, v.orcamento_id, o.tenant_id, o.numero, v.versao, v.pdf_path, v.enviado_em
  FROM orcamento_versoes v
  JOIN orcamentos o ON o.id = v.orcamento_id
  WHERE v.pdf_path IS NOT NULL AND v.enviado_em < p_limite
  ORDER BY v.enviado_em ASC
$$;

REVOKE ALL ON FUNCTION rls_listar_pdfs_expirados(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rls_listar_pdfs_expirados(TIMESTAMPTZ) TO ni_doc_app;

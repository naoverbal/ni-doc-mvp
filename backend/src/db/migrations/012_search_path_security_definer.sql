-- =====================================================
-- search_path FIXO NAS FUNÇÕES SECURITY DEFINER (auditoria — achado B-7)
--
-- As funções de bootstrap da migration 004 (login, sessão, rota pública) e a de
-- expiração da 008 executam com os privilégios do DONO (privilegiado) e com
-- `row_security = off`. Sem `search_path` fixo, elas resolvem nomes de tabelas e
-- funções pelo `search_path` de QUEM CHAMA. Um chamador que consiga criar objetos
-- em um schema anterior no caminho (ex.: tabela temporária em `pg_temp`, que é
-- pesquisada primeiro para relações) poderia fazer a função privilegiada ler ou
-- escrever em um objeto falso. É o hardening recomendado pela documentação do
-- PostgreSQL para SECURITY DEFINER.
--
-- Correção: fixa `search_path = public, pg_temp` em cada função. `pg_temp` fica por
-- último (nunca precede `public`) e `pg_catalog` continua implícito e primeiro.
-- Nenhuma função usa objetos fora de `public`. O `SET row_security = off` existente
-- é preservado (ALTER FUNCTION ... SET apenas acrescenta a configuração).
--
-- Idempotente: reaplicar o mesmo SET não tem efeito colateral.
-- =====================================================

ALTER FUNCTION rls_usuario_por_email_hash(CHAR(64)) SET search_path = public, pg_temp;
ALTER FUNCTION rls_sessao_por_id(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION rls_usuario_por_id(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION rls_versao_por_token(VARCHAR(128)) SET search_path = public, pg_temp;
ALTER FUNCTION rls_criar_sessao(UUID, VARCHAR(45), TEXT, TIMESTAMPTZ)
  SET search_path = public, pg_temp;
ALTER FUNCTION rls_invalidar_sessao(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION rls_tocar_sessao(UUID) SET search_path = public, pg_temp;
ALTER FUNCTION rls_expirar_orcamentos_vencidos(TIMESTAMPTZ) SET search_path = public, pg_temp;

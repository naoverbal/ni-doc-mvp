-- =====================================================
-- ATIVAÇÃO DO RLS POR REQUEST (RF-002) — papel de aplicação + bootstrap
--
-- Esta migration cria o papel que o BACKEND usa em runtime, SEM `BYPASSRLS` e
-- SEM ser superusuário/owner das tabelas — de modo que as policies da migration
-- 002 passem a filtrar de fato por `app.current_tenant`. O papel privilegiado
-- (quem roda `migrate`/`seed`, tipicamente `postgres`) continua reservado para
-- manutenção do schema e carga de dados multi-tenant.
--
-- Problema de bootstrap: três leituras acontecem ANTES de haver um tenant no
-- contexto e, portanto, seriam barradas pelo RLS para o papel não-privilegiado:
--   1. login            — localizar o usuário por hash de e-mail;
--   2. validar sessão   — localizar a sessão (e o usuário) pelo id do cookie;
--   3. rota pública     — localizar a versão do orçamento pelo token público.
-- Para esses pontos usamos funções `SECURITY DEFINER` de dono privilegiado
-- (executam com `row_security = off`), que fazem uma busca ESTRITA por chave e
-- devolvem apenas o necessário. O RLS permanece forte em todo o resto; o
-- contorno existe só nesses três lookups de credencial.
--
-- Idempotente: `DROP ... IF EXISTS` antes de `CREATE`; a criação do papel usa
-- um bloco `DO` que ignora o papel já existente.
-- =====================================================

-- -----------------------------------------------------
-- Papel de aplicação (runtime). Cluster-wide: criar só se não existir.
-- A senha padrão serve a desenvolvimento/compose; em produção, defina uma senha
-- forte via `ALTER ROLE ni_doc_app PASSWORD '...'` após aplicar a migration.
-- -----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ni_doc_app') THEN
    CREATE ROLE ni_doc_app LOGIN PASSWORD 'ni_doc_app';
  END IF;
END
$$;

-- Garante que o papel NÃO ignora RLS nem é superusuário (idempotente).
ALTER ROLE ni_doc_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;

-- Permissões de DML no schema público. O papel NÃO é owner das tabelas, então o
-- `FORCE ROW LEVEL SECURITY` da migration 002 se aplica a ele normalmente.
GRANT USAGE ON SCHEMA public TO ni_doc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ni_doc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ni_doc_app;

-- Tabelas/sequências criadas por migrations FUTURAS também recebem as permissões
-- (default privileges aplicam-se ao que o papel privilegiado corrente criar).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ni_doc_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO ni_doc_app;

-- -----------------------------------------------------
-- Funções de bootstrap (SECURITY DEFINER). O dono é o papel que aplica a
-- migration (privilegiado), e `SET row_security = off` desliga o RLS apenas
-- durante a execução da função. Busca estrita por chave única.
-- -----------------------------------------------------

-- 1) LOGIN: usuário por hash de e-mail (coluna UNIQUE email_hash).
DROP FUNCTION IF EXISTS rls_usuario_por_email_hash(CHAR(64));
CREATE FUNCTION rls_usuario_por_email_hash(p_email_hash CHAR(64))
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  nome VARCHAR(255),
  email_encrypted TEXT,
  senha_hash TEXT,
  papel VARCHAR(20),
  ativo BOOLEAN,
  criado_em TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT u.id, u.tenant_id, u.nome, u.email_encrypted, u.senha_hash,
         u.papel, u.ativo, u.criado_em
  FROM usuarios u
  WHERE u.email_hash = p_email_hash
$$;

-- 2a) SESSÃO: por id do cookie.
DROP FUNCTION IF EXISTS rls_sessao_por_id(UUID);
CREATE FUNCTION rls_sessao_por_id(p_id UUID)
RETURNS TABLE (
  id UUID,
  usuario_id UUID,
  expira_em TIMESTAMPTZ,
  ultima_atividade TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT s.id, s.usuario_id, s.expira_em, s.ultima_atividade
  FROM sessoes s
  WHERE s.id = p_id
$$;

-- 2b) USUÁRIO por id (usado na validação de sessão, antes de haver tenant).
DROP FUNCTION IF EXISTS rls_usuario_por_id(UUID);
CREATE FUNCTION rls_usuario_por_id(p_id UUID)
RETURNS TABLE (
  id UUID,
  tenant_id UUID,
  nome VARCHAR(255),
  email_encrypted TEXT,
  papel VARCHAR(20),
  ativo BOOLEAN,
  criado_em TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT u.id, u.tenant_id, u.nome, u.email_encrypted, u.papel, u.ativo, u.criado_em
  FROM usuarios u
  WHERE u.id = p_id
$$;

-- 3) ROTA PÚBLICA: versão do orçamento (join com orcamentos) pelo token público.
--    O token é a credencial do cliente final; resolve o tenant da versão para
--    que o restante do fluxo público rode já escopado por `app.current_tenant`.
DROP FUNCTION IF EXISTS rls_versao_por_token(VARCHAR(128));
CREATE FUNCTION rls_versao_por_token(p_token VARCHAR(128))
RETURNS TABLE (
  versao_id UUID,
  orcamento_id UUID,
  tenant_id UUID,
  numero VARCHAR(50),
  versao INTEGER,
  pdf_hash CHAR(64),
  pdf_path TEXT,
  token_publico VARCHAR(128),
  expira_em TIMESTAMPTZ,
  status_orcamento VARCHAR(20),
  snapshot JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  SELECT v.id AS versao_id, v.orcamento_id, o.tenant_id, o.numero, v.versao,
         v.pdf_hash, v.pdf_path, v.token_publico, v.expira_em,
         o.status AS status_orcamento, v.snapshot
  FROM orcamento_versoes v
  JOIN orcamentos o ON o.id = v.orcamento_id
  WHERE v.token_publico = p_token
$$;

-- -----------------------------------------------------
-- Operações de SESSÃO (bootstrap). O ciclo de vida da sessão (criar no login,
-- invalidar no logout, tocar `ultima_atividade` na validação) acontece FORA de
-- um escopo de tenant — as rotas `/api/auth/*` não registram `setTenant`, e a
-- validação roda ANTES dele. Como `sessoes` tem RLS forçado, essas escritas são
-- barradas para o papel não-privilegiado sem `app.current_tenant`. Encapsulamos
-- cada operação numa função SECURITY DEFINER de escrita estrita por chave.
-- -----------------------------------------------------

-- Cria uma sessão e devolve id + expiração (equivalente ao INSERT ... RETURNING).
DROP FUNCTION IF EXISTS rls_criar_sessao(UUID, VARCHAR(45), TEXT, TIMESTAMPTZ);
CREATE FUNCTION rls_criar_sessao(
  p_usuario_id UUID,
  p_ip VARCHAR(45),
  p_user_agent TEXT,
  p_expira_em TIMESTAMPTZ
)
RETURNS TABLE (id UUID, expira_em TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  INSERT INTO sessoes (usuario_id, ip, user_agent, expira_em)
  VALUES (p_usuario_id, p_ip, p_user_agent, p_expira_em)
  RETURNING id, expira_em
$$;

-- Invalida (remove) a sessão pelo id.
DROP FUNCTION IF EXISTS rls_invalidar_sessao(UUID);
CREATE FUNCTION rls_invalidar_sessao(p_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  DELETE FROM sessoes WHERE id = p_id
$$;

-- Atualiza o carimbo de última atividade da sessão.
DROP FUNCTION IF EXISTS rls_tocar_sessao(UUID);
CREATE FUNCTION rls_tocar_sessao(p_id UUID)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET row_security = off
AS $$
  UPDATE sessoes SET ultima_atividade = NOW() WHERE id = p_id
$$;

-- O papel de aplicação só pode EXECUTAR as funções (não acessa as tabelas por
-- fora do RLS). REVOKE de PUBLIC evita exposição indevida.
REVOKE ALL ON FUNCTION rls_usuario_por_email_hash(CHAR(64)) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_sessao_por_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_usuario_por_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_versao_por_token(VARCHAR(128)) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_criar_sessao(UUID, VARCHAR(45), TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_invalidar_sessao(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION rls_tocar_sessao(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION rls_usuario_por_email_hash(CHAR(64)) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_sessao_por_id(UUID) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_usuario_por_id(UUID) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_versao_por_token(VARCHAR(128)) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_criar_sessao(UUID, VARCHAR(45), TEXT, TIMESTAMPTZ) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_invalidar_sessao(UUID) TO ni_doc_app;
GRANT EXECUTE ON FUNCTION rls_tocar_sessao(UUID) TO ni_doc_app;

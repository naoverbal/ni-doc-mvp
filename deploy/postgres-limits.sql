-- =============================================================================
-- Limites no papel de aplicação (ni_doc_app) — rodar UMA vez em produção, com o
-- usuário administrador (postgres), por exemplo:
--   docker compose exec -T postgres psql -U postgres -d nidoc < deploy/postgres-limits.sql
--
-- Não é migration de propósito: são parâmetros de operação do servidor, não
-- schema. Os valores valem para NOVAS conexões; reinicie o backend depois.
-- Para desfazer: ALTER ROLE ni_doc_app RESET statement_timeout; (idem p/ os demais)
-- =============================================================================

-- Mata qualquer consulta que passe de 15 s (as do app levam milissegundos).
-- O tempo de geração do PDF no envio NÃO conta: é código Node, não um statement.
ALTER ROLE ni_doc_app SET statement_timeout = '15s';

-- O envio de orçamento gera o PDF DENTRO da transação (Puppeteer pode levar
-- alguns segundos, com a transação "ociosa" para o Postgres). 60 s casa com o
-- proxy_read_timeout do nginx; valores menores (ex.: 10 s) quebrariam o envio.
ALTER ROLE ni_doc_app SET idle_in_transaction_session_timeout = '60s';

-- Espera máxima por lock (ex.: pg_advisory_xact_lock do envio/aceite).
ALTER ROLE ni_doc_app SET lock_timeout = '10s';

-- Teto de conexões simultâneas do papel: pool do app (10) + folga.
ALTER ROLE ni_doc_app CONNECTION LIMIT 15;

-- =====================================================
-- IMUTABILIDADE DE REGISTROS PROBATÓRIOS (auditoria de segurança — achado B-3)
--
-- O produto promete trilha de auditoria completa, aceites e versões imutáveis. A
-- migration 004 concedeu `SELECT, INSERT, UPDATE, DELETE` em TODAS as tabelas ao
-- papel de aplicação (`ni_doc_app`), então a imutabilidade dependia só do código:
-- um bug de SQL ou uma injeção poderia reescrever a auditoria, apagar um aceite
-- ou trocar o snapshot de uma versão já enviada.
--
-- Mapeamento feito antes desta migration (nenhum código de runtime usa o que é
-- revogado aqui):
--   • eventos_auditoria  — o app só faz INSERT e SELECT (auditoria.repository).
--   • orcamento_aceites  — o app só faz INSERT e SELECT.
--   • orcamento_versoes  — o app faz INSERT e SELECT; o único UPDATE é o job de
--     limpeza de PDFs (jobs/limpar-pdfs.ts), que zera `pdf_path` e `pdf_hash`
--     de PDFs expirados. Nenhum DELETE.
--
-- Correção (privilégios, não triggers: o papel privilegiado de migrate/seed e os
-- ON DELETE do schema continuam funcionando):
--   • eventos_auditoria: sem UPDATE e sem DELETE.
--   • orcamento_aceites: sem UPDATE e sem DELETE.
--   • orcamento_versoes: sem DELETE; UPDATE só nas colunas `pdf_path` e
--     `pdf_hash` (snapshot, token público, validade etc. ficam imutáveis).
--
-- Idempotente: REVOKE/GRANT podem ser reaplicados sem efeito colateral.
-- =====================================================

REVOKE UPDATE, DELETE ON eventos_auditoria FROM ni_doc_app;
REVOKE UPDATE, DELETE ON orcamento_aceites FROM ni_doc_app;

REVOKE DELETE ON orcamento_versoes FROM ni_doc_app;
REVOKE UPDATE ON orcamento_versoes FROM ni_doc_app;
GRANT UPDATE (pdf_path, pdf_hash) ON orcamento_versoes TO ni_doc_app;

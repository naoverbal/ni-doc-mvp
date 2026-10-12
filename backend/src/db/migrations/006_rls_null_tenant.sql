-- =====================================================
-- RLS: TRATAR `app.current_tenant` VAZIO COMO AUSENTE (RF-002 — tarefa 56)
--
-- A ativação do RLS por request (migration 004 + conexão-por-request) revelou um
-- caso de borda nas policies da migration 002/005: elas comparam
-- `tenant_id = current_setting('app.current_tenant', TRUE)::uuid`.
--
-- `current_setting(..., TRUE)` retorna:
--   • NULL quando o GUC NUNCA foi definido na sessão; mas
--   • STRING VAZIA ('') quando o GUC foi definido e depois resetado (`RESET`),
--     que é exatamente o estado de uma conexão do pool reaproveitada entre
--     requests (o escopo-por-request reseta o GUC ao devolver a conexão).
--
-- Com a string vazia, `''::uuid` lança `invalid input syntax for type uuid` em
-- vez de simplesmente não casar nenhuma linha. Resultado: uma query SEM escopo
-- de tenant (fora de `executarComTenant`) numa conexão reaproveitada ERRA, em
-- vez de retornar zero linhas — contrariando a garantia "sem tenant setado,
-- nenhuma linha retorna".
--
-- Correção: envolver o GUC em `NULLIF(..., '')`, de modo que tanto o NULL
-- (nunca definido) quanto a string vazia (resetado) virem NULL. Como
-- `tenant_id = NULL` é NULL (não verdadeiro), a linha é negada — zero linhas,
-- sem erro. Isso endurece TODAS as policies de isolamento (002 e 005) de forma
-- uniforme.
--
-- Idempotente: `DROP POLICY IF EXISTS` antes de recriar.
-- =====================================================

-- Tabelas com `tenant_id` direta.
DROP POLICY IF EXISTS usuarios_tenant_isolation ON usuarios;
CREATE POLICY usuarios_tenant_isolation ON usuarios
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS clientes_tenant_isolation ON clientes;
CREATE POLICY clientes_tenant_isolation ON clientes
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS empresas_tenant_isolation ON empresas;
CREATE POLICY empresas_tenant_isolation ON empresas
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS responsaveis_tecnicos_tenant_isolation ON responsaveis_tecnicos;
CREATE POLICY responsaveis_tecnicos_tenant_isolation ON responsaveis_tecnicos
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS orcamentos_tenant_isolation ON orcamentos;
CREATE POLICY orcamentos_tenant_isolation ON orcamentos
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS templates_tenant_isolation ON templates;
CREATE POLICY templates_tenant_isolation ON templates
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS eventos_auditoria_tenant_isolation ON eventos_auditoria;
CREATE POLICY eventos_auditoria_tenant_isolation ON eventos_auditoria
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

DROP POLICY IF EXISTS tenants_self_isolation ON tenants;
CREATE POLICY tenants_self_isolation ON tenants
  USING (id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

-- Tabelas-filhas (sem `tenant_id` direta) — isolamento via EXISTS.
DROP POLICY IF EXISTS orcamento_itens_tenant_isolation ON orcamento_itens;
CREATE POLICY orcamento_itens_tenant_isolation ON orcamento_itens
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_itens.orcamento_id
      AND o.tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid
  ));

DROP POLICY IF EXISTS orcamento_versoes_tenant_isolation ON orcamento_versoes;
CREATE POLICY orcamento_versoes_tenant_isolation ON orcamento_versoes
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_versoes.orcamento_id
      AND o.tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid
  ));

DROP POLICY IF EXISTS orcamento_aceites_tenant_isolation ON orcamento_aceites;
CREATE POLICY orcamento_aceites_tenant_isolation ON orcamento_aceites
  USING (EXISTS (
    SELECT 1 FROM orcamento_versoes ov
    JOIN orcamentos o ON o.id = ov.orcamento_id
    WHERE ov.id = orcamento_aceites.versao_id
      AND o.tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid
  ));

DROP POLICY IF EXISTS sessoes_tenant_isolation ON sessoes;
CREATE POLICY sessoes_tenant_isolation ON sessoes
  USING (EXISTS (
    SELECT 1 FROM usuarios u
    WHERE u.id = sessoes.usuario_id
      AND u.tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid
  ));

DROP POLICY IF EXISTS orcamento_condicoes_pagamento_tenant_isolation ON orcamento_condicoes_pagamento;
CREATE POLICY orcamento_condicoes_pagamento_tenant_isolation ON orcamento_condicoes_pagamento
  USING (EXISTS (
    SELECT 1 FROM orcamentos o
    WHERE o.id = orcamento_condicoes_pagamento.orcamento_id
      AND o.tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid
  ));

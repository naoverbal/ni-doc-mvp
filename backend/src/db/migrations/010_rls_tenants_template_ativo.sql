-- =====================================================
-- RLS EM tenants_template_ativo (auditoria de segurança — achado B-2)
--
-- A tabela aponta qual versão do template é a "atual" de cada tenant, mas foi
-- criada na migration 001 SEM Row Level Security e nunca recebeu policy (a 002
-- cobre as demais tabelas). Como o papel de aplicação (`ni_doc_app`) tem DML em
-- todas as tabelas do schema (migration 004), qualquer query sem o filtro
-- aplicacional `WHERE tenant_id` conseguiria LER ou REAPONTAR o template ativo de
-- outro tenant. O isolamento ficava só na aplicação, contrariando o RF-002
-- (isolamento no banco).
--
-- Correção: habilita e FORÇA o RLS e aplica a mesma policy das demais tabelas com
-- `tenant_id` direta (migration 006: GUC vazio tratado como ausente). `WITH CHECK`
-- explícito impede inserir/atualizar uma linha apontando para outro tenant.
--
-- Os acessos de runtime (template.repository e orcamento-versao.repository) já
-- rodam dentro de `executarComTenant`, portanto não são afetados. O papel
-- privilegiado de `migrate`/`seed` é superusuário e ignora RLS, como já ocorre
-- nas demais tabelas com FORCE (a 003 insere nesta tabela antes desta migration).
--
-- Idempotente: `DROP POLICY IF EXISTS` antes de `CREATE`; `ENABLE/FORCE` são no-ops
-- quando já ativos.
-- =====================================================

ALTER TABLE tenants_template_ativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants_template_ativo FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_template_ativo_tenant_isolation ON tenants_template_ativo;
CREATE POLICY tenants_template_ativo_tenant_isolation ON tenants_template_ativo
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', TRUE), '')::uuid);

-- =====================================================
-- SEED DE DESENVOLVIMENTO (parte declarativa / não-sensível)
-- =====================================================
-- Este arquivo cobre apenas os dados DETERMINÍSTICOS e NÃO SENSÍVEIS
-- (tenants, responsáveis técnicos, templates e template ativo).
--
-- Dados sensíveis (usuários e clientes) NÃO são inseridos aqui porque
-- dependem de criptografia AES-256-GCM (lib/crypto.ts) e hash Argon2id
-- (lib/senha.ts), que só existem em runtime no Node. Esses registros são
-- criados pelo seed.ts, que também executa este SQL.
--
-- IDEMPOTÊNCIA: todo INSERT usa ON CONFLICT DO NOTHING, portanto reexecutar
-- o seed não duplica dados.
--
-- RLS: as tabelas abaixo têm RLS com FORCE habilitado e as policies de
-- isolamento usam apenas USING (que o PostgreSQL também aplica como WITH CHECK
-- em INSERT). Como este arquivo insere linhas de MÚLTIPLOS tenants de uma só
-- vez, o seed.ts executa `SET LOCAL row_security = off` na transação antes de
-- rodar este SQL. Isso exige que o papel conectado seja superusuário ou tenha
-- BYPASSRLS — o caso padrão em desenvolvimento (usuário `postgres`, conforme
-- .env.example). As migrations 001/002 já criaram as tabelas e as policies.
-- =====================================================

-- -----------------------------------------------------
-- TENANTS
-- -----------------------------------------------------
INSERT INTO tenants (id, nome)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tenant Alpha'),
  ('b0000000-0000-0000-0000-000000000002', 'Tenant Beta')
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------
-- RESPONSÁVEIS TÉCNICOS (2 por tenant)
-- -----------------------------------------------------
INSERT INTO responsaveis_tecnicos (id, tenant_id, nome, registro_profissional, ativo)
VALUES
  ('a0000000-0000-0000-0004-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Eng. Ana Beatriz Lima', 'CREA 123456/D-SP', TRUE),
  ('a0000000-0000-0000-0004-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Arq. Carlos Mendes', 'CAU A123456-7', TRUE),
  ('b0000000-0000-0000-0004-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Eng. Fernanda Costa', 'CREA 654321/D-RJ', TRUE),
  ('b0000000-0000-0000-0004-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Arq. Rafael Souza', 'CAU A654321-0', TRUE)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------
-- TEMPLATES (1 por tenant, versão 1)
-- -----------------------------------------------------
INSERT INTO templates (id, tenant_id, versao, layout_json)
VALUES
  (
    'a0000000-0000-0000-0003-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    1,
    '{
      "formato": "A4",
      "orientacao": "retrato",
      "margens": { "topo": 20, "direita": 20, "baixo": 20, "esquerda": 20 },
      "secoes": [
        { "tipo": "cabecalho", "altura": 80 },
        { "tipo": "dados_cliente", "altura": 60 },
        { "tipo": "itens", "altura_linha": 30 },
        { "tipo": "totais", "altura": 80 },
        { "tipo": "rodape", "altura": 40 }
      ]
    }'::jsonb
  ),
  (
    'b0000000-0000-0000-0003-000000000001',
    'b0000000-0000-0000-0000-000000000002',
    1,
    '{
      "formato": "A4",
      "orientacao": "retrato",
      "margens": { "topo": 20, "direita": 20, "baixo": 20, "esquerda": 20 },
      "secoes": [
        { "tipo": "cabecalho", "altura": 80 },
        { "tipo": "dados_cliente", "altura": 60 },
        { "tipo": "itens", "altura_linha": 30 },
        { "tipo": "totais", "altura": 80 },
        { "tipo": "rodape", "altura": 40 }
      ]
    }'::jsonb
  )
ON CONFLICT (tenant_id, versao) DO NOTHING;

-- -----------------------------------------------------
-- TENANTS_TEMPLATE_ATIVO (template padrão ativo por tenant)
-- -----------------------------------------------------
INSERT INTO tenants_template_ativo (tenant_id, template_id)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0003-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0003-000000000001')
ON CONFLICT (tenant_id) DO NOTHING;

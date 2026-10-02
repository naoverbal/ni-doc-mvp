-- =====================================================
-- SEED DE DESENVOLVIMENTO
-- Idempotente: ON CONFLICT DO NOTHING em tudo.
-- Senhas marcadas como HASH_PENDENTE — o seed.ts
-- usa hashSenha() para gerar os hashes reais via Argon2.
-- =====================================================

-- TENANTS
INSERT INTO tenants (id, nome)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tenant Alpha'),
  ('b0000000-0000-0000-0000-000000000002', 'Tenant Beta')
ON CONFLICT DO NOTHING;

-- USUÁRIOS (sem RLS — seed roda como superuser)
-- email_hash: encode(digest('<email_normalizado>', 'sha256'), 'hex') via pgcrypto
-- email_encrypted: placeholder (aplicação vai criptografar em runtime)
-- senha_hash: HASH_PENDENTE — substituído pelo seed.ts

INSERT INTO usuarios (id, tenant_id, nome, email_hash, email_encrypted, senha_hash, papel)
VALUES
  (
    'a0000000-0000-0000-0001-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Admin Alpha',
    encode(digest('admin@alpha.dev', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED',
    'HASH_PENDENTE',
    'admin'
  ),
  (
    'a0000000-0000-0000-0001-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Operador Alpha',
    encode(digest('operador@alpha.dev', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED',
    'HASH_PENDENTE',
    'operador'
  ),
  (
    'b0000000-0000-0000-0001-000000000001',
    'b0000000-0000-0000-0000-000000000002',
    'Admin Beta',
    encode(digest('admin@beta.dev', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED',
    'HASH_PENDENTE',
    'admin'
  ),
  (
    'b0000000-0000-0000-0001-000000000002',
    'b0000000-0000-0000-0000-000000000002',
    'Operador Beta',
    encode(digest('operador@beta.dev', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED',
    'HASH_PENDENTE',
    'operador'
  )
ON CONFLICT DO NOTHING;

-- CLIENTES
INSERT INTO clientes (id, tenant_id, tipo_pessoa, nome, documento_hash, documento_encrypted)
VALUES
  (
    gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'PF',
    'João Silva Alpha',
    encode(digest('00000000001', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  ),
  (
    gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'PJ',
    'Empresa Alpha Ltda',
    encode(digest('00000000000001', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  ),
  (
    gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'PF',
    'Maria Souza Alpha',
    encode(digest('00000000002', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  ),
  (
    gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'PF',
    'Carlos Lima Beta',
    encode(digest('00000000003', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  ),
  (
    gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'PJ',
    'Empresa Beta S/A',
    encode(digest('00000000000002', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  ),
  (
    gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'PF',
    'Ana Costa Beta',
    encode(digest('00000000004', 'sha256'), 'hex'),
    'PLACEHOLDER_ENCRYPTED'
  )
ON CONFLICT (tenant_id, documento_hash) DO NOTHING;

-- RESPONSÁVEIS TÉCNICOS
INSERT INTO responsaveis_tecnicos (id, tenant_id, nome, registro_profissional)
VALUES
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'Eng. Ana Beatriz Lima', 'CREA 123456/D-SP'),
  (gen_random_uuid(), 'a0000000-0000-0000-0000-000000000001', 'Arq. Carlos Eduardo Neto', 'CAU A123456-7'),
  (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'Eng. Mariana Ferreira', 'CREA 654321/D-SP'),
  (gen_random_uuid(), 'b0000000-0000-0000-0000-000000000002', 'Arq. Roberto Santos', 'CAU A654321-0')
ON CONFLICT DO NOTHING;

-- TEMPLATES (versão 1 para cada tenant)
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

-- TENANTS_TEMPLATE_ATIVO
INSERT INTO tenants_template_ativo (tenant_id, template_id)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0003-000000000001'),
  ('b0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0003-000000000001')
ON CONFLICT (tenant_id) DO NOTHING;

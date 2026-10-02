# Migrações SQL, RLS e seed de desenvolvimento — Fase 2 ni-doc

As seis entregas desta fase estabelecem o schema completo do banco, o isolamento multi-tenant por RLS e um seed de desenvolvimento idempotente. O approach é convencional e bem executado: migration runner próprio com tabela `_migrations`, seed em duas etapas (SQL idempotente + hash Argon2 via TypeScript), e tipos Kysely cobrindo todas as 13 tabelas. Watch for: **`responsaveis_tecnicos` sem `ON CONFLICT` no seed** — reexecutar o seed insere registros duplicados, quebrando idempotência; e **`tenants` sem RLS** — tabela acessível cross-tenant via `SELECT` direto, o que pode expor nomes de outros tenants.

**Verdict**: NEEDS_CHANGES

---

## High-level view

O schema em `001` cobre as 13 tabelas exigidas pelo design, com índices e CHECKs correspondentes. A única divergência em relação ao design é o uso de `CREATE TABLE IF NOT EXISTS` em vez de `CREATE TABLE` simples — comportamento inofensivo já que o migration runner garante execução única por arquivo.

O RLS em `002` está correto para as tabelas com `tenant_id` direto. As tabelas sem `tenant_id` (`orcamento_itens`, `orcamento_versoes`, `orcamento_aceites`, `sessoes`) usam `EXISTS` com o join apropriado. A tabela `tenants` em si não tem RLS — um `SELECT * FROM tenants` fora de contexto de tenant expõe todos os nomes. Se o design pretende que superusers façam queries administrativas sem RLS, isso é aceitável, mas deve ser declarado explicitamente; dentro do contexto da aplicação (onde `app.current_tenant` estará sempre definido) o risco é mínimo.

O seed em `003` é parcialmente idempotente: `tenants`, `usuarios`, `clientes` e `templates` têm `ON CONFLICT DO NOTHING` correto. Já `responsaveis_tecnicos` usa `ON CONFLICT DO NOTHING` sem uma constraint que o suporte — a tabela não tem `UNIQUE` em nenhuma coluna além de `id`, então `ON CONFLICT` resolve sobre o PK, mas o `id` é gerado com `gen_random_uuid()` a cada execução. Na prática, cada re-execução insere 4 novos registros, acumulando duplicatas.

O `migrate.ts` é robusto: executa cada arquivo em transação própria, faz rollback em caso de erro, e registra o filename na tabela `_migrations` para garantir execução única. Sem `any`, compatível com `strict` e `noUncheckedIndexedAccess`. O `seed.ts` importa `hashSenha` com `.js` (correto para Node16 ESM) e só atualiza `senha_hash` quando o valor ainda é `'HASH_PENDENTE'`, o que torna a etapa de hash idempotente mesmo que o seed SQL já tenha rodado antes.

Os tipos Kysely cobrem todas as 13 tabelas com fidelidade ao schema SQL. O uso de `Generated<T>` para colunas com DEFAULT e `ColumnType<Select, Insert, Update>` para colunas de data que aceitam string no INSERT está correto.

---

<details>
<summary>Issues (2)</summary>

1. **`responsaveis_tecnicos` não é idempotente no seed** — `ON CONFLICT DO NOTHING` resolve sobre o PK (`id`), que é `gen_random_uuid()` a cada execução. Cada re-execução do seed insere 4 novos responsáveis duplicados. Adicionar uma constraint `UNIQUE (tenant_id, registro_profissional)` em `001` e usar `ON CONFLICT (tenant_id, registro_profissional) DO NOTHING` em `003`, ou usar UUIDs fixos para esses registros como é feito para tenants e usuários.

2. **`tenants` sem RLS** — a tabela não tem `ENABLE ROW LEVEL SECURITY`, então qualquer query sem `WHERE` retorna todos os tenants. Dentro do fluxo normal da aplicação isso não ocorre, mas uma falha no middleware `tenant.ts` ou uma query de repositório sem filtro exporia dados de outros tenants. Adicionar `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` e uma policy que isole por `id = current_setting('app.current_tenant', TRUE)::uuid` em `002`.

</details>

<details>
<summary>Details</summary>

### Idempotência do seed para `responsaveis_tecnicos`

confirmed — `003_seed_dev.sql` usa `gen_random_uuid()` para o `id` dos responsáveis e finaliza com `ON CONFLICT DO NOTHING`. Como a tabela `responsaveis_tecnicos` em `001` não define nenhuma constraint `UNIQUE` além do PK, o `ON CONFLICT` apena nunca dispara (cada UUID gerado é novo). Cada chamada a `seed.ts` acumula 4 registros extras por execução. Isso diverge do comportamento dos outros segmentos do seed, onde `ON CONFLICT` resolve sobre constraints reais (`(tenant_id, documento_hash)` para clientes, `(tenant_id, versao)` para templates).

A correção mais limpa é usar UUIDs fixos como já é feito para tenants, usuários e templates:

```sql
INSERT INTO responsaveis_tecnicos (id, tenant_id, nome, registro_profissional)
VALUES
  ('a0000000-0000-0000-0004-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Eng. Ana Beatriz Lima', 'CREA 123456/D-SP'),
  ...
ON CONFLICT (id) DO NOTHING;
```

Ou, para não usar IDs fixos, adicionar `UNIQUE (tenant_id, registro_profissional)` na tabela e trocar o `ON CONFLICT DO NOTHING` por `ON CONFLICT (tenant_id, registro_profissional) DO NOTHING`.

### Ausência de RLS em `tenants`

confirmed — `002_rls_policies.sql` não menciona a tabela `tenants`. O design declara "RLS habilitado em todas as tabelas com tenant_id" e `tenants` não tem `tenant_id` (ela é a raiz), mas isso não a exclui de precisar de isolamento. Um `SELECT * FROM tenants` dentro de uma transação com `app.current_tenant` definido retornaria todos os tenants sem restrição. A policy adequada seria:

```sql
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;

CREATE POLICY tenants_self_isolation ON tenants
  USING (id = current_setting('app.current_tenant', TRUE)::uuid);
```

Isso garante que um tenant só enxerga a si mesmo, mesmo em queries que não filtrem explicitamente por `id`.

</details>

---

<details>
<summary>File map</summary>

| Arquivo | O que mudou |
|---------|-------------|
| `backend/src/db/migrations/001_initial_schema.sql` | Schema completo com 13 tabelas, índices e CHECKs |
| `backend/src/db/migrations/002_rls_policies.sql` | RLS para 12 tabelas (falta `tenants`) |
| `backend/src/db/migrations/003_seed_dev.sql` | Seed dev com 2 tenants, 4 usuários, 6 clientes, 4 responsáveis, 2 templates |
| `backend/src/db/migrate.ts` | Runner de migrations com tabela `_migrations`, transação por arquivo |
| `backend/src/db/seed.ts` | Seed runner: executa SQL + gera hashes Argon2 reais |
| `backend/src/types/database.ts` | Interface `Database` Kysely cobrindo todas as 13 tabelas |

</details>

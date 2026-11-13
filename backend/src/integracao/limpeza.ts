// Limpeza dos dados de teste, compartilhada entre os helpers e o global-setup
// (módulo leve: não importa o app nem o vitest).

/** Qualquer cliente/pool do `pg`. */
export interface Consultavel {
  query(sql: string, params?: unknown[]): Promise<unknown>
}

/**
 * Remove tenants de teste. Aceites e versões saem primeiro, de forma explícita
 * (a FK deles para o orçamento é RESTRICT desde a migration 009, de propósito);
 * depois os orçamentos (levam itens em cascata). `orcamento_versoes.template_id`
 * não tem cascade, então os templates só podem sair depois das versões.
 */
export async function removerTenants(pool: Consultavel, ids: string[]): Promise<void> {
  await pool.query(
    `DELETE FROM orcamento_aceites WHERE versao_id IN (
       SELECT v.id FROM orcamento_versoes v JOIN orcamentos o ON o.id = v.orcamento_id
       WHERE o.tenant_id = ANY($1::uuid[]))`,
    [ids],
  )
  await pool.query(
    `DELETE FROM orcamento_versoes WHERE orcamento_id IN (
       SELECT id FROM orcamentos WHERE tenant_id = ANY($1::uuid[]))`,
    [ids],
  )
  await pool.query('DELETE FROM orcamentos WHERE tenant_id = ANY($1::uuid[])', [ids])
  // `eventos_auditoria.tenant_id` é RESTRICT (migration 022): apagar o tenant não leva a
  // auditoria junto. Em banco de teste (pool admin) removemos a dos tenants de teste antes.
  await pool.query('DELETE FROM eventos_auditoria WHERE tenant_id = ANY($1::uuid[])', [ids])
  await pool.query('DELETE FROM tenants WHERE id = ANY($1::uuid[])', [ids])
}

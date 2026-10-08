# Tarefa 33 — Rota de envio (POST /:id/enviar) — Evidência de verificação

Primeira iteração (não existia `task33-review.json`). Implementação do zero
seguindo ciclo TDD: testes escritos antes, vistos falhar, implementação, vistos passar.

## Escopo entregue

- `backend/src/routes/orcamentos.routes.ts`: novo endpoint `POST /:id/enviar`
  que delega ao `versionamentoService.enviar(ctx, id)` e responde `201` com a
  versão criada. A rota só delega — mapeamento de erros (400/404/409) vem do
  service via `AppError`, tratado pelo `errorHandler` central (sem duplicar
  validação). Autenticação herdada do `router.use(autenticar)` já existente.
- Assinatura da factory `criarOrcamentosRouter` estendida para receber
  `versionamentoService` como dependência (DI por argumento), consistente com o
  estilo do projeto.
- `backend/src/app.ts`: wiring do `criarVersionamentoService` (com
  `orcamentoRepo`, `orcamentoVersaoRepo`, `clienteRepo`, `empresaRepo`,
  `responsavelRepo`, `snapshotService`, `auditoriaService`) e passagem ao router.
- Testes em `backend/src/routes/__tests__/orcamentos.routes.test.ts`.

PDF fora do escopo: `pdf_path`/`pdf_hash` permanecem nulos (confirmado em
`versaoEnviadaMock` e asserção `res.body.pdfPath` null no teste de sucesso).

## Casos cobertos por teste (bloco `POST /api/orcamentos/:id/enviar`)

1. Sucesso -> **201** com a versão criada (id, versao, tokenPublico, pdfPath null);
   verifica que `enviar` foi chamado com o contexto (tenantId/usuarioId) e o id.
2. Rascunho sem itens -> **400** (service lança `AppError(400, ...)`).
3. Orçamento não-rascunho / já aprovado -> **409** (service lança `AppError(409, ...)`).
4. Orçamento inexistente -> **404** (propagação de `AppError(404, ...)`).
5. Autenticação exigida -> **401** sem cookie `session`, e `enviar` não é chamado.

## Comandos executados (em `backend/`) e resultados

- `npx vitest run src/routes/__tests__/orcamentos.routes.test.ts` (fase RED, antes da impl):
  **22 failed | 6 passed** — confirmou que os testes falhavam primeiro.
- `npm test` (fase GREEN, suíte completa): **30 arquivos / 334 testes passando**.
- `npx vitest run src/routes/__tests__/orcamentos.routes.test.ts`: **28 passed**.
- `npm run build` (tsc): **compilou sem erros** (exit 0).
- `npm run lint` (eslint src): **limpo** (exit 0).
- `npx prettier --write` no arquivo de teste + `--check` nos 3 arquivos:
  **"All matched files use Prettier code style!"**.
- Reexecução pós-format: testes do arquivo **28 passed** e lint **limpo**.

Todos os comandos retornaram exit code 0. Os casos 201/400/409/404 e 401
(autenticação) estão cobertos por testes que passam.

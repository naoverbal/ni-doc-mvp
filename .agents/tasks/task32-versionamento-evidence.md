# Evidência final — Tarefa 32: Serviço de versionamento

Finalização após review aprovado (`task32-review.md` → **APPROVED**). Esta etapa
cobre verificação, commit atômico e registro de evidências.

## Commit

- **Hash:** `32485adce05e197516203c8a25cb581e723112a7`
- **Mensagem:** `feat(orcamento): adiciona serviço de versionamento`
- Corpo: versionamento sequencial (v1 / v(N+1)) protegido por advisory lock,
  token público único por versão e invalidação do aceite anterior na mesma
  transação; auditoria após a persistência.
- Rodapé: `Refs: RF-008, RF-009`
- Hooks preservados (sem `--no-verify`). Sem push.

## Arquivos no commit (5)

- `backend/src/services/versionamento.service.ts` (novo) — serviço `enviar`.
- `backend/src/services/__tests__/versionamento.service.test.ts` (novo) — 11 testes.
- `backend/src/repositories/orcamento-versao.repository.ts` (novo) — repositório
  `criarVersaoEnviar` (transação atômica).
- `backend/src/repositories/__tests__/orcamento-versao.repository.test.ts` (novo)
  — 9 testes.
- `backend/src/routes/__tests__/orcamentos.routes.test.ts` (modificado) — apenas
  reformatação do Prettier (import colapsado), sem mudança de comportamento.

Artefatos em `.agents/` deliberadamente fora do commit. `app.ts`/`types` não
tocados (wiring da rota é a tarefa 33).

## Verificação (rodada a partir de `backend/`)

| Passo | Comando | Resultado |
|-------|---------|-----------|
| Build | `npm run build` (tsc) | sem erros (exit 0) |
| Lint  | `npm run lint` (eslint src) | limpo (exit 0) |
| Testes | `npm run test` (vitest run) | **30 arquivos, 329 testes passando** (exit 0) |
| Cobertura | `npm run test:coverage` | All files 98.4% stmts / 91.36% branch / 99.27% funcs |

Suites da tarefa 32:
- `services/__tests__/versionamento.service.test.ts` → 11 testes passando.
- `repositories/__tests__/orcamento-versao.repository.test.ts` → 9 testes passando.

Cobertura por arquivo (confirmada no review / evidência inicial):
- `services/versionamento.service.ts` → **100% de statements (80/80)**.
- `repositories/orcamento-versao.repository.ts` → **95.6% de statements (87/91)**.

Ambos ≥ 80% (DoD atendido). Thresholds globais de 80% do projeto verdes.

## DoD

- [x] `versionamento.service.ts` + testes criados.
- [x] `enviar` só rascunho com itens; cria v1 e v(N+1); gera token; status
  `enviado`; invalida aceite anterior; auditoria.
- [x] Versionamento sequencial e token único por versão.
- [x] Build/lint/testes limpos; cobertura do serviço ≥ 80%.
- [x] Commit atômico (`32485ad`) seguindo Conventional Commits.

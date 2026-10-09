# Tarefa 40 — Evidência de verificação (iteração de review)

Comandos executados a partir de `/Users/nilson/Dev/ni-doc/backend`.

## 1. `npm run build` (tsc)

Compila sem erros. Exit code 0.

```
> @ni-doc/backend@1.0.0 build
> tsc
```

## 2. `npm run lint` (eslint src)

Sem erros nem warnings. Exit code 0.

```
> @ni-doc/backend@1.0.0 lint
> eslint src
```

## 3. `npm run test:coverage` (vitest run --coverage)

Exit code 0. Todos os testes passando, incluindo os novos/ajustados de
versionamento e do repositório de versões.

```
 Test Files  38 passed (38)
      Tests  421 passed (421)
   Duration  3.70s
```

### Cobertura dos arquivos alterados (meta ≥ 80%)

Extraída de `coverage/coverage-final.json`:

| Arquivo                                        | Statements | %      |
| ---------------------------------------------- | ---------- | ------ |
| `src/services/versionamento.service.ts`        | 103/104    | 99.04% |
| `src/repositories/orcamento-versao.repository.ts` | 99/103  | 96.12% |

Cobertura global do backend: 98.48% stmts / 91.42% branch / 99.45% funcs.

Ambos os arquivos alterados estão bem acima do mínimo de 80%.

## Findings do review anterior (task40-review.json)

1. **Evidência de verificação ausente (bloqueante)** — RESOLVIDO: os três
   comandos (build, lint, test:coverage) foram executados e seus resultados
   estão registrados acima. Cobertura do serviço ajustado ≥ 80% confirmada.
2. **`templateId` resolvido por duas fontes (não bloqueante)** — ACEITE
   EXPLÍCITO como tradeoff de MVP. O código já documenta a janela de divergência
   no comentário do `enviar` (um único template ativo por tenant no MVP faz as
   duas leituras convergirem). Nenhuma mudança de comportamento aplicada; a
   unificação (passar o `templateId`/layout resolvido do serviço ao repositório)
   fica para tarefa futura, conforme a opção oferecida pelo próprio review.
3. **Rollback end-to-end sem cobertura de integração (não bloqueante)** —
   ACEITE EXPLÍCITO da cobertura por mocks, consistente com a estratégia de
   testes unitários de serviço do projeto (serviços testados com mocks; a
   semântica transacional real do Postgres é responsabilidade de teste de
   integração/repositório futuro). Nenhuma mudança de comportamento aplicada.

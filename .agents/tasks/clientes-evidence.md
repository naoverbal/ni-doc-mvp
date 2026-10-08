# Task 23 — Rotas de clientes — quality-gate evidence

Commit under review: `77db5d4` (feat: adiciona rotas de clientes com schemas Zod e testes).

All commands run from `/Users/nilson/Dev/ni-doc/backend`.

## 1. Tests — `npm run test -- --run src/routes/__tests__/clientes.routes.test.ts`

Exit code: 0. Result: **16 passed (16)**, 1 test file passed.

```
 ✓ src/routes/__tests__/clientes.routes.test.ts (16)
   ✓ GET /api/clientes (3)
     ✓ retorna 200 e o array de buscar quando q está presente
     ✓ retorna 200 e lista vazia quando q está ausente (buscar não é chamado)
     ✓ retorna 401 sem cookie session
   ✓ POST /api/clientes (7)
     ✓ retorna 201 e o cliente criado com body válido
     ✓ retorna 400 com body inválido (sem nome)
     ✓ retorna 400 com tipoPessoa fora do enum
     ✓ retorna 400 com email inválido
     ✓ propaga AppError 409 do service (documento duplicado)
     ✓ propaga AppError 400 do service (CPF inválido)
     ✓ retorna 401 sem cookie session
   ✓ PUT /api/clientes/:id (3)
     ✓ retorna 200 e o cliente atualizado com body parcial válido
     ✓ propaga AppError 404 do service
     ✓ retorna 401 sem cookie session
   ✓ GET /api/clientes/:id (3)
     ✓ retorna 200 e o cliente
     ✓ propaga AppError 404 do service
     ✓ retorna 401 sem cookie session

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

## 2. Build — `npm run build` (tsc, strict mode)

Exit code: 0. No TypeScript errors.

## 3. Lint — `npm run lint` (eslint src)

Exit code: 0. Zero errors, zero warnings.

## 4. Format — `npm run format` (prettier --write src)

Exit code: 0. All task-23 files reported `(unchanged)` — already Prettier-compliant:
`src/routes/clientes.routes.ts`, `src/schemas/cliente.schema.ts`,
`src/routes/__tests__/clientes.routes.test.ts`, `src/app.ts`.

## Notes

- Addresses the sole review finding (MEDIUM: "Missing quality-gate evidence").
- No code changes were needed; the implementation in `77db5d4` passed all gates as-is.
- The already-implemented cliente service/repository were not modified.

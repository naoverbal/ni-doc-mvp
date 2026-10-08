# Evidência — Task 26: Repositório e serviço de responsáveis técnicos

Implementado via TDD (testes primeiro → falha → implementação → verde). Espelha o padrão
cliente/empresa, mas sem documento/CPF/CNPJ (domínio mais simples): `nome` obrigatório em texto
plano, `registro_profissional` opcional em texto plano, `email`/`telefone` opcionais e cifrados.

## Arquivos criados (apenas estes 4)

- `backend/src/repositories/responsavel.repository.ts`
- `backend/src/repositories/__tests__/responsavel.repository.test.ts`
- `backend/src/services/responsavel.service.ts`
- `backend/src/services/__tests__/responsavel.service.test.ts`

Não foram tocados `app.ts`, nem arquivos `empresa*`/`cliente*`.

## Gates executados (de `backend/`)

### 1. Testes dos arquivos novos

```
npm run test -- --run src/repositories/__tests__/responsavel.repository.test.ts src/services/__tests__/responsavel.service.test.ts
```

Resultado: **2 arquivos, 19 testes passando** (repo: 9, service: 10).

### 2. Build (tsc strict)

```
npm run build
```

Resultado: **limpo, exit 0** (strict, noUncheckedIndexedAccess, noImplicitOverride).

### 3. Lint (ESLint @typescript-eslint)

```
npx eslint src/repositories/responsavel.repository.ts src/repositories/__tests__/responsavel.repository.test.ts src/services/responsavel.service.ts src/services/__tests__/responsavel.service.test.ts
```

Resultado: **zero erros/avisos, exit 0**.

### 4. Format (Prettier)

```
npx prettier --write <4 arquivos>
```

Resultado: **todos "unchanged"** (já conformes: aspas simples, sem ponto e vírgula, indent 2, trailing
commas all, print width 100).

### 5. Cobertura dos arquivos novos

```
npx vitest run --coverage.enabled \
  --coverage.include='src/repositories/responsavel.repository.ts' \
  --coverage.include='src/services/responsavel.service.ts' \
  src/repositories/__tests__/responsavel.repository.test.ts \
  src/services/__tests__/responsavel.service.test.ts
```

Resultado:

| File      | % Stmts | % Branch | % Funcs | % Lines |
| --------- | ------- | -------- | ------- | ------- |
| All files | 100     | 90.32    | 100     | 100     |

Acima do mínimo de 80%.

### 6. Suíte completa (regressão)

```
npm run test
```

Resultado: **23 arquivos, 231 testes passando**. Nenhuma falha.

## Cobertura funcional

- Repository: `criar` (cifra email/telefone, grava `registro_profissional` em texto plano,
  retorna `ResponsavelPublico` decifrado, opcionais ausentes → null), `buscarPorId` (null quando
  ausente; decifra), `buscarPorNome` (ILIKE `%termo%` em `nome`, `ativo = true`, order by nome,
  limit 20), `atualizar` (set condicional por campo, `updateTable('responsaveis_tecnicos')`, null
  quando ausente), `desativar` (soft delete `ativo:false`).
- Service: `criar` (delega + auditoria `entidade:'responsaveis_tecnicos'`), `buscar` (delega a
  `buscarPorNome`), `buscarPorId` (found + 404), `atualizar` (updates + 404 + auditoria),
  `desativar` (soft delete + auditoria + 404 quando ausente).

Rotas/schemas são da task 27 (fora de escopo neste run).

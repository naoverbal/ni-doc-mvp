# Implementation Plan — Tarefa 30: Rotas de orçamentos

Spec: `.kiro/specs/ni-doc-mvp/tasks.md` item 30 (Requirements RF-005, RF-006, RF-007).
Backend: `/Users/nilson/Dev/ni-doc/backend`. TDD, Vitest + supertest.

## Decisões de design (fundamentadas no código lido)

- **Assinatura do router:** seguir exatamente o padrão de `clientes.routes.ts` /
  `empresas.routes.ts`: factory `criarOrcamentosRouter(orcamentoService, authService)`,
  um `const autenticar = criarMiddlewareAuth(authService)` e `router.use(autenticar)`
  no topo. Os routers existentes **não** montam `setTenant` dentro do router — o
  `tenantId` vem de `req.usuario.tenantId` via `construirContexto(req)`, e o RLS é
  responsabilidade de outra camada. Por isso **não** vou injetar `db`/`setTenant` no
  router; isso manteria divergência do padrão. (O enunciado menciona `setTenant`, mas
  o padrão real do código — autoridade sobre a paráfrase — não o usa nos routers.)
- **Status codes:** POST → `201` (`res.status(201).json(...)`); GET lista e GET `:id`
  → `200` (`res.json(...)`); PUT → `200` (`res.json(...)`); DELETE → `204` sem corpo
  (`res.status(204).end()`), pois `orcamentoService.deletar` retorna `void`.
- **Regra 409 (não-rascunho):** já é imposta pelo `orcamento.service.ts`
  (`atualizar`/`deletar` lançam `AppError(409, ...)`). A rota apenas repassa o erro via
  `next(err)`; **não** duplicar a regra na rota.
- **Validação Zod:** apenas forma (shape), espelhando `cliente.schema.ts`/`empresa.schema.ts`
  (que validam forma e deixam regra de negócio no service). Usar o middleware `validate`.
- **PUT substitui itens:** `AtualizarOrcamentoInput` exige `itens` (array). O schema de
  atualização portanto também exige `itens` (RF-005.5: edição substitui itens).

## Assinaturas reais do service (de `services/orcamento.service.ts`)

```ts
interface OrcamentoContexto { tenantId: string; usuarioId: string; ip?: string; userAgent?: string }

interface CriarOrcamentoDados {
  clienteId: string
  empresaClienteId?: string
  titulo: string
  descricao?: string
  validadeDias?: number
  descontoGlobalTipo?: 'percentual' | 'fixo'
  descontoGlobalValor?: number
  observacoes?: string
  condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]
}

interface OrcamentoService {
  criar(ctx, dados: CriarOrcamentoDados): Promise<OrcamentoComItens>
  buscarPorId(ctx, id: string): Promise<OrcamentoComItens>
  listar(ctx, filtro?: ListarOrcamentosFiltro): Promise<ListaOrcamentos>
  atualizar(ctx, id: string, dados: AtualizarOrcamentoInput): Promise<OrcamentoComItens>
  deletar(ctx, id: string): Promise<void>
}
```

Tipos de `repositories/orcamento.repository.ts`:

```ts
CriarOrcamentoItemInput = {
  nome: string
  descricao?: string
  quantidade: number
  unidade?: string
  valorUnitario: number
  descontoTipo?: 'percentual' | 'fixo'
  descontoValor?: number
  responsavelId?: string
}
AtualizarOrcamentoInput = {  // itens é obrigatório; demais opcionais
  clienteId?: string; empresaClienteId?: string; titulo?: string; descricao?: string
  validadeDias?: number; descontoGlobalTipo?; descontoGlobalValor?
  observacoes?: string; condicoesPagamento?: string
  itens: CriarOrcamentoItemInput[]
}
ListarOrcamentosFiltro = { status?: OrcamentoStatus; pagina?: number; tamanhoPagina?: number }
OrcamentoStatus = 'rascunho'|'enviado'|'aprovado'|'reprovado'|'expirado'|'cancelado'
```

## Shapes dos schemas Zod (`schemas/orcamento.schema.ts`)

```ts
import { z } from 'zod'

const descontoTipoSchema = z.enum(['percentual', 'fixo'])

const itemSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().optional(),
  quantidade: z.number().positive(),
  unidade: z.string().optional(),
  valorUnitario: z.number().nonnegative(),
  descontoTipo: descontoTipoSchema.optional(),
  descontoValor: z.number().nonnegative().optional(),
  responsavelId: z.string().uuid().optional(),
})

export const criarOrcamentoSchema = z.object({
  clienteId: z.string().uuid(),
  empresaClienteId: z.string().uuid().optional(),
  titulo: z.string().min(1),
  descricao: z.string().optional(),
  validadeDias: z.number().int().positive().optional(),
  descontoGlobalTipo: descontoTipoSchema.optional(),
  descontoGlobalValor: z.number().nonnegative().optional(),
  observacoes: z.string().optional(),
  condicoesPagamento: z.string().optional(),
  itens: z.array(itemSchema).min(1),   // RF-005.4: >= 1 item
})
export type CriarOrcamentoPayload = z.infer<typeof criarOrcamentoSchema>

// Atualização: itens obrigatório (substitui todos); demais campos opcionais.
export const atualizarOrcamentoSchema = z.object({
  clienteId: z.string().uuid().optional(),
  empresaClienteId: z.string().uuid().optional(),
  titulo: z.string().min(1).optional(),
  descricao: z.string().optional(),
  validadeDias: z.number().int().positive().optional(),
  descontoGlobalTipo: descontoTipoSchema.optional(),
  descontoGlobalValor: z.number().nonnegative().optional(),
  observacoes: z.string().optional(),
  condicoesPagamento: z.string().optional(),
  itens: z.array(itemSchema).min(1),
})
export type AtualizarOrcamentoPayload = z.infer<typeof atualizarOrcamentoSchema>
```

Nota sobre `clienteId.uuid()`: os mocks de teste usam ids como `'cliente-1'`, que
**não** são UUID. Para o POST válido do teste passar na validação Zod, usar UUIDs reais
nos payloads de teste (ex.: `'11111111-1111-1111-1111-111111111111'`) OU relaxar para
`z.string().min(1)`. **Decisão:** usar `z.string().uuid()` (mais correto) e usar UUIDs
válidos nos payloads dos testes. O id do orçamento retornado pelo mock pode continuar
sendo `'orcamento-1'` (não passa por validação de entrada).

## Endpoints (RESTful) com status codes

| Método | Rota | Validação | Service | Sucesso |
|--------|------|-----------|---------|---------|
| POST | `/api/orcamentos` | `validate(criarOrcamentoSchema)` | `criar(ctx, dados)` | 201 + orçamento |
| GET | `/api/orcamentos` | query `status?`, `pagina?`, `tamanhoPagina?` | `listar(ctx, filtro)` | 200 + `ListaOrcamentos` |
| GET | `/api/orcamentos/:id` | — | `buscarPorId(ctx, id)` | 200 + `OrcamentoComItens` |
| PUT | `/api/orcamentos/:id` | `validate(atualizarOrcamentoSchema)` | `atualizar(ctx, id, dados)` | 200 + orçamento |
| DELETE | `/api/orcamentos/:id` | — | `deletar(ctx, id)` | 204 sem corpo |

GET lista — parse da query string (sem Zod, inline como em `empresas.routes.ts`):
- `status`: se presente, validar contra o conjunto de `OrcamentoStatus`; se inválido →
  `next(new AppError(400, 'status inválido'))`.
- `pagina` / `tamanhoPagina`: se presentes, `Number(...)`; se `NaN` ou `< 1` →
  `AppError(400, ...)`. Montar `ListarOrcamentosFiltro` só com os campos presentes.

Todas as rotas: `router.use(autenticar)` garante 401 sem cookie `session`.
Erros do service propagados via `try/catch` → `next(err)` → `errorHandler`.

## Casos de teste (`routes/__tests__/orcamentos.routes.test.ts`)

Padrão idêntico a `empresas.routes.test.ts`: `makeAuthService`, `makeOrcamentoService`
(mock de todos os métodos de `OrcamentoService`), `makeApp(orcamentoService, authService)`
com `express.json()`, `cookieParser()`, router montado em `/api/orcamentos`, `errorHandler`.
Mocks: `usuarioPublicoMock` (tenant-1/user-1), `sessaoMock`, e um `orcamentoComItensMock`
(status `'rascunho'`, com 1 item) e `listaOrcamentosMock` (`{ itens: [...], total, pagina, tamanhoPagina }`).

POST `/api/orcamentos`:
- 201 + orçamento com body válido; `criar` chamado com `ctx` (tenant-1/user-1) e os dados.
- 400 sem `titulo` (Zod) — `criar` não chamado.
- 400 com `itens` vazio (`[]`).
- 400 com `clienteId` ausente.
- propaga `AppError(400)` do service (ex.: "Cliente é obrigatório").
- 401 sem cookie `session`.

GET `/api/orcamentos`:
- 200 + `ListaOrcamentos` sem filtros; `listar` chamado com ctx e `filtro` vazio/`undefined`.
- 200 com `?status=enviado`; `listar` chamado com `{ status: 'enviado' }`.
- 200 com `?pagina=2&tamanhoPagina=10`; `listar` recebe esses valores numéricos.
- 400 com `?status=xpto` (status fora do enum) — `listar` não chamado.
- 401 sem cookie.

GET `/api/orcamentos/:id`:
- 200 + orçamento com itens; `buscarPorId` chamado com ctx e id.
- propaga `AppError(404)` do service.
- 401 sem cookie.

PUT `/api/orcamentos/:id`:
- 200 + orçamento atualizado com body válido (inclui `itens`); `atualizar` chamado com ctx, id, dados.
- 400 com body inválido (`itens` vazio).
- **409** quando o service lança `AppError(409, 'Só é possível editar orçamentos em rascunho')`.
- propaga `AppError(404)` do service.
- 401 sem cookie.

DELETE `/api/orcamentos/:id`:
- 204 sem corpo em rascunho; `deletar` chamado com ctx e id.
- **409** quando o service lança `AppError(409, 'Só é possível excluir orçamentos em rascunho')`.
- propaga `AppError(404)` do service.
- 401 sem cookie.

## Registro em `app.ts`

Seguir o padrão dos demais blocos. Imports no topo:
```ts
import { criarOrcamentosRouter } from './routes/orcamentos.routes.js'
import { criarOrcamentoService } from './services/orcamento.service.js'
import { criarOrcamentoRepository } from './repositories/orcamento.repository.js'
```
Dentro de `criarApp`, após o bloco de responsáveis e antes do `errorHandler`:
```ts
// Orçamento routes
const orcamentoRepo = criarOrcamentoRepository({ db }) // NB: factory recebe objeto { db }
const orcamentoService = criarOrcamentoService({ orcamentoRepo, auditoriaService })
app.use('/api/orcamentos', criarOrcamentosRouter(orcamentoService, authService))
```
Atenção: `criarOrcamentoRepository` usa parâmetro-objeto `({ db })`, diferente dos
vizinhos posicionais `criarXRepository(db)`. Reusar o `auditoriaService` já criado acima.

## Convenções obrigatórias

- ESM: todos os imports relativos com extensão `.js` (ex.: `'../services/orcamento.service.js'`).
- Prettier: aspas simples, sem ponto e vírgula, indent 2, trailing comma `all`, width 100.
- Nomes de domínio em português.

---

## Itens de implementação (ordenados por dependência)

- [ ] 1. Criar os schemas Zod de input dos orçamentos.
      Definir `criarOrcamentoSchema`, `atualizarOrcamentoSchema`, `itemSchema` e os
      tipos inferidos `CriarOrcamentoPayload` / `AtualizarOrcamentoPayload`, conforme a
      seção "Shapes dos schemas Zod" acima.
      Files: `backend/src/schemas/orcamento.schema.ts`
      Verify: `cd backend && npx tsc --noEmit` compila sem erros.

- [ ] 2. Criar o router de orçamentos com os 5 endpoints.
      Factory `criarOrcamentosRouter(orcamentoService, authService)` espelhando
      `empresas.routes.ts`: `router.use(autenticar)`, helper `construirContexto(req)`,
      POST (201), GET lista (parse de `status`/`pagina`/`tamanhoPagina` com `AppError(400)`
      para status inválido), GET `:id` (200), PUT `:id` (200, `validate(atualizarOrcamentoSchema)`),
      DELETE `:id` (204). Todos com `try/catch` → `next(err)`. Não duplicar a regra 409
      (vem do service).
      Files: `backend/src/routes/orcamentos.routes.ts`
      Verify: `cd backend && npx tsc --noEmit` compila sem erros.

- [ ] 3. Registrar o router no app Express.
      Adicionar imports de `criarOrcamentosRouter`, `criarOrcamentoService`,
      `criarOrcamentorepository` e o bloco "Orçamento routes" (`criarOrcamentoRepository({ db })`,
      reuso de `auditoriaService`) antes do `app.use(errorHandler)`.
      Files: `backend/src/app.ts`
      Verify: `cd backend && npx tsc --noEmit` compila sem erros.

- [ ] 4. Escrever os testes de rota cobrindo o DoD.
      Seguir o padrão de `empresas.routes.test.ts` (mocks de service + authService, supertest,
      `errorHandler` montado, cookie `session=sessao-id-1`). Cobrir todos os casos listados
      na seção "Casos de teste", incluindo os dois cenários 409 (PUT e DELETE em não-rascunho)
      e os 401 sem cookie. Usar UUIDs válidos nos payloads de entrada por causa de `.uuid()`.
      Files: `backend/src/routes/__tests__/orcamentos.routes.test.ts`
      Verify: `cd backend && npx vitest run src/routes/__tests__/orcamentos.routes.test.ts` — todos os testes passam.

- [ ] 5. Verificação final: lint, build e suíte completa.
      Rodar formatação/lint e a suíte inteira para garantir que nada regrediu e a
      cobertura das rotas novas atende o mínimo (80%).
      Files: — (sem alterações além de eventuais correções de lint/format)
      Verify: `cd backend && npm run lint && npm run build && npm test` — tudo verde;
      opcionalmente `npm run test:coverage` para confirmar >= 80% nas rotas.

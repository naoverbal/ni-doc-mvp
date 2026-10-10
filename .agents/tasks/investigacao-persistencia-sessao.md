# Investigação: persistência de sessão ao reiniciar o Vite

**Modo:** somente leitura. Nenhum arquivo foi alterado.

## Resposta resumida (veredito)

**Caso A — ESPERADO E SEGURO**, com **uma ressalva leve** (não é o caso B clássico).

O comportamento observado — fazer login, reiniciar o servidor de desenvolvimento
do frontend (Vite) e, ao subir de novo, entrar direto no `/dashboard` — **é normal
e esperado**. Isso acontece porque:

1. A sessão vive num **cookie `HttpOnly` chamado `session`** emitido pelo backend,
   não em `localStorage` nem em estado persistido do cliente.
2. Reiniciar o Vite **não apaga cookies do navegador** — o backend (Express) e o
   Postgres continuam de pé, e a sessão (válida por 8 horas) permanece ativa no
   servidor. O cookie é reenviado na próxima visita.
3. O guard de rota **revalida contra o backend** via `GET /api/auth/me`
   (`useSessao`), então o front não confia apenas num booleano do cliente — ele
   confirma a sessão com o servidor a cada montagem da área logada.

Não há token em `localStorage`, não há `persist` do Zustand e não há `autenticado`
gravado no cliente de forma desacoplada do servidor. Portanto **não é o caso C**, e
o risco de XSS por token em storage **não existe aqui**.

A **ressalva** (abaixo, no veredito detalhado) é apenas de robustez de UX/estado,
não de segurança: o booleano `autenticado` do store pode, por um instante, estar
dessincronizado numa aba recém-aberta, mas o `PrivateRoute` cobre esse caso com o
estado de carregamento + revalidação. É seguro.

---

## Evidência (com arquivos e símbolos)

### 1. Onde e como a sessão é armazenada (backend emite cookie HttpOnly)

No login, o backend seta um cookie `session` com o **ID da sessão** (não um JWT, não
dados do usuário) e devolve só dados públicos do usuário no corpo JSON.

`backend/src/routes/auth.routes.ts` — handler de `POST /login`:

```ts
const maxAge = result.expiraEm.getTime() - Date.now()
res.cookie('session', result.sessaoId, {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge,
})

res.json({
  usuario: { id: result.usuario.id, nome: result.usuario.nome, papel: result.usuario.papel },
})
```

- Nome do cookie: **`session`**.
- Flags: **`httpOnly: true`** (JS do browser não lê — mitiga XSS exfiltrando a
  sessão); **`secure`** apenas em produção (em dev fica `false`, correto para
  `http://localhost`); **`sameSite: 'lax'`** (mitiga CSRF em requisições
  cross-site de navegação).
- **`maxAge`** = tempo até `expiraEm`, ou seja, alinhado à expiração da sessão no
  servidor (8h — ver item 4). O corpo JSON **não** contém token nem a sessão; só
  `id`, `nome`, `papel`.

A app registra `cookie-parser`, `helmet` e `cors` com credenciais em
`backend/src/app.ts`:

```ts
app.use(helmet())
app.use(cors({ origin: env.NODE_ENV === 'development' ? true : false, credentials: true }))
app.use(cookieParser())
```

- `credentials: true` + `origin: true` em dev permite que o browser envie o cookie
  nas chamadas do frontend (ver item 2, `credentials: 'include'`).

### 2. Como o frontend guarda o estado de autenticação (em memória, não persistido)

O store Zustand mantém **apenas o usuário em memória** e um booleano derivado. Há um
comentário explícito dizendo que a fonte de verdade é o cookie HttpOnly do backend.

`frontend/src/stores/auth.store.ts`:

```ts
export const useAuthStore = create<AuthState>((set) => ({
  usuario: null,
  autenticado: false,
  definirUsuario: (usuario) => set({ usuario, autenticado: usuario !== null }),
  limpar: () => set({ usuario: null, autenticado: false }),
}))
```

- **Sem `persist`** middleware do Zustand. Confirmado por busca em `frontend/src`:
  os termos `persist` / `localStorage` / `sessionStorage` **não aparecem** no
  código de autenticação (a única ocorrência é um comentário não relacionado em
  `OrcamentoEditor.tsx`). Ou seja: ao recarregar a página, `autenticado` **volta a
  `false`** até a revalidação via `/auth/me`.

O cliente HTTP envia o cookie automaticamente:

`frontend/src/services/api.ts`:

```ts
const resposta = await fetch(`${BASE_URL}${caminho}`, {
  credentials: 'include',
  ...
})
```

- **`credentials: 'include'`** faz o browser anexar o cookie `session` em toda
  chamada. O frontend **nunca lê nem manuseia o token** — ele só confia que o
  cookie é enviado.

O hook de sessão consulta o backend e hidrata o store:

`frontend/src/hooks/useAuth.ts` — `useSessao()`:

```ts
return useQuery<Usuario | null>({
  queryKey: CHAVE_SESSAO,
  queryFn: async () => {
    try {
      const { usuario } = await api.get<RespostaUsuario>('/auth/me')
      definirUsuario(usuario)
      return usuario
    } catch (erro) {
      if (erro instanceof ApiError && erro.status === 401) {
        definirUsuario(null)
        return null
      }
      throw erro
    }
  },
  retry: false,
  staleTime: 5 * 60_000,
})
```

- O estado "autenticado" do cliente é **sempre derivado de uma chamada real** ao
  backend (`GET /auth/me`). Em `401`, o store é limpo.

### 3. Como o guard de rota decide "logado" (revalida com o backend)

`frontend/src/routes/PrivateRoute.tsx`:

```ts
export function PrivateRoute({ children }: { children: ReactElement }): ReactElement {
  const location = useLocation()
  const autenticado = useAuthStore((estado) => estado.autenticado)
  const sessao = useSessao()

  if (sessao.isLoading) {
    return <p role="status" aria-live="polite">Verificando sessão…</p>
  }
  if (!autenticado) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  return children
}
```

- Ao montar, dispara `useSessao()` (`GET /auth/me`). Enquanto carrega, mostra um
  status acessível ("Verificando sessão…", com `role="status"` / `aria-live`).
- Só libera o conteúdo quando `autenticado` é `true`, e esse valor foi definido
  pelo resultado do `/auth/me`. **Não é um booleano "cru" do cliente** — depende da
  resposta do servidor na montagem.
- `PublicRoute` (`frontend/src/routes/PublicRoute.tsx`) é um passthrough simples
  (usado para rotas públicas via token), sem lógica de auth.

Isso é o que explica o comportamento observado: ao reabrir o app, o cookie ainda
existe, `/auth/me` responde `200` com o usuário, o store é hidratado e o
`/dashboard` abre direto. Correto e esperado.

### 4. Validade da sessão no backend (server-side, com expiração)

Há tabela de sessões **server-side** com expiração explícita.

`backend/src/db/migrations/001_initial_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS sessoes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  ip VARCHAR(45),
  user_agent TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expira_em TIMESTAMPTZ NOT NULL,
  ultima_atividade TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sessoes_expira ON sessoes(expira_em);
```

- `sessoes` tem RLS habilitado (`002_rls_policies.sql`,
  `sessoes_tenant_isolation` via `usuarios.tenant_id`).

Expiração de 8 horas e validação no `AuthService`:

`backend/src/services/auth.service.ts`:

```ts
const OITO_HORAS_MS = 8 * 60 * 60 * 1000
// ...
const expiraEm = new Date(Date.now() + OITO_HORAS_MS)
const sessao = await sessaoRepo.criar({ usuarioId: usuario.id, ip, userAgent, expiraEm })
```

```ts
async validarSessao(sessaoId) {
  const sessao = await sessaoRepo.buscarPorId(sessaoId)
  if (!sessao) return null
  if (sessao.expiraEm < new Date()) {
    return null            // sessão expirada → inválida
  }
  const usuario = await usuarioRepo.buscarPorId(sessao.usuarioId)
  if (!usuario) return null
  await sessaoRepo.atualizarAtividade(sessaoId)
  return { usuario, sessao }
}
```

Endpoints de auth (`backend/src/routes/auth.routes.ts`):

- **`POST /api/auth/login`** — cria sessão + seta cookie (item 1).
- **`POST /api/auth/logout`** — invalida a sessão no banco e limpa o cookie:
  ```ts
  const sessionId = req.cookies['session'] as string | undefined
  if (sessionId) { await authService.logout(sessionId) }
  res.clearCookie('session')
  ```
  `authService.logout` chama `sessaoRepo.invalidar(id)` que faz
  `DELETE FROM sessoes WHERE id = ...` (`backend/src/repositories/sessao.repository.ts`).
- **`GET /api/auth/me`** — protegido por `criarMiddlewareAuth`, devolve
  `req.usuario`.

Middleware de autenticação (`backend/src/middlewares/auth.ts`):

```ts
const sessionId = req.cookies['session'] as string | undefined
if (!sessionId) { res.status(401).json({ erro: 'Não autenticado' }); return }
const resultado = await authService.validarSessao(sessionId)
if (!resultado) {
  res.clearCookie('session')
  res.status(401).json({ erro: 'Sessão expirada' })
  return
}
```

- Cada request autenticada **revalida a sessão no banco** e checa expiração. Se a
  sessão sumiu/expirou, o cookie é limpo e retorna `401` — o que, no front,
  dispara a limpeza do store via `useSessao` (item 2). **Não há `refresh token`**;
  o modelo é sessão opaca server-side de 8h, sem renovação de janela além do
  `atualizarAtividade` (que atualiza `ultima_atividade`, mas **não** estende
  `expira_em`).

---

## Conclusões

- **O comportamento é normal e seguro (caso A).** Reiniciar o Vite reinicia apenas
  o servidor de assets do frontend; não toca no cookie do navegador nem na sessão
  no Postgres. A sessão continua válida por até 8h, e o guard revalida via
  `/auth/me`. Entrar direto no `/dashboard` é o esperado.
- **Não é caso C:** não há token/estado de auth em `localStorage`/`sessionStorage`,
  não há `persist` do Zustand. A superfície de XSS para roubo de sessão é mínima
  porque o cookie é `HttpOnly`.
- **Não é caso B clássico:** o `PrivateRoute` **não** confia só no booleano do
  cliente — ele revalida com o backend a cada montagem.

### Ressalva leve (robustez, não segurança)

No `PrivateRoute`, `autenticado` é lido do store **e** `useSessao()` é disparado.
Como `useQuery` tem `staleTime: 5min`, numa navegação dentro da mesma sessão de
app o `isLoading` pode não reaparecer (dados em cache), então o gate efetivo é o
booleano do store já hidratado — o que é correto, pois ele veio do `/auth/me`.
O ponto fino: se a sessão expirar no servidor **durante** o uso, o front só
perceberá no próximo request que receba `401` (as queries de dados), não
instantaneamente no guard. Isso é aceitável e comum, mas se quiser endurecer:

### Opções de melhoria (NÃO implementadas — sugestões)

1. **Tratamento global de `401` no `api.ts`:** interceptar respostas `401` e
   limpar o store + invalidar a query de sessão, para expulsar o usuário na hora
   em que a sessão expira server-side (hoje cada tela trata seu próprio erro).
2. **Rotação/sliding expiration explícita:** se quiser que a atividade estenda a
   validade, atualizar `expira_em` em `validarSessao` (hoje só
   `ultima_atividade` é atualizada; `expira_em` é fixo em 8h a partir do login).
3. **Flag `secure` também fora de produção quando servir por HTTPS**, e considerar
   `sameSite: 'strict'` para a sessão principal se o fluxo não exigir navegação
   cross-site (há páginas públicas por token, mas essas não dependem do cookie
   `session`).
4. **Limpeza de sessões expiradas:** há índice em `expira_em`, mas não encontrei
   job de expurgo; um `DELETE FROM sessoes WHERE expira_em < NOW()` periódico
   evitaria acúmulo (higiene, não segurança imediata).

Nenhuma dessas é necessária para corrigir o comportamento relatado — ele já está
correto. São endurecimentos opcionais.
